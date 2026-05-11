use anyhow::{Context, Result};
use parking_lot::RwLock;
use portable_pty::{
    ChildKiller, CommandBuilder, MasterPty, PtySize, PtySystem, NativePtySystem,
};
use std::{
    collections::HashMap,
    io::Write,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
};
use tauri::{AppHandle, Emitter};
use tracing::{error, info, warn};

use crate::block::{self, ShellType};
use crate::stream::core::UnifiedStreamCore;
use crate::stream::event;

/// Wrapper to make non-Send/Sync PTY types safe behind a lock.
/// Safety: All access to inner values is guarded by RwLock on the sessions HashMap.
struct SendSync<T>(T);
unsafe impl<T> Send for SendSync<T> {}
unsafe impl<T> Sync for SendSync<T> {}

/// Terminal session holding a PTY instance
pub struct TerminalSession {
    pub session_id: String,
    pub shell: String,
    pub cwd: String,
    master: SendSync<Box<dyn MasterPty>>,
    writer: Mutex<Box<dyn Write + Send>>,
    child_killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
}

/// PTY Manager manages multiple terminal sessions
pub struct PtyManager {
    sessions: Arc<RwLock<HashMap<String, TerminalSession>>>,
    next_id: AtomicUsize,
    app_handle: Arc<RwLock<Option<AppHandle>>>,
    /// Per-session unified stream cores (replaces separate MarkerScanner + StreamCleaner maps).
    stream_cores: Arc<std::sync::Mutex<HashMap<String, UnifiedStreamCore>>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            next_id: AtomicUsize::new(1),
            app_handle: Arc::new(RwLock::new(None)),
            stream_cores: Arc::new(std::sync::Mutex::new(HashMap::new())),
        }
    }

    /// Set app handle for event emission
    pub fn set_app_handle(&self, app: AppHandle) {
        let mut handle = self.app_handle.write();
        *handle = Some(app);
    }

    /// Create a new PTY session
    pub fn create_session(&self, shell: Option<String>, cwd: Option<String>) -> Result<String> {
        let pty_system: Box<dyn PtySystem> = Box::new(NativePtySystem::default());

        let shell_path = shell.unwrap_or_else(|| Self::default_shell());
        let working_dir = cwd.unwrap_or_else(|| Self::default_cwd());

        let mut cmd = CommandBuilder::new(&shell_path);
        cmd.cwd(&working_dir);

        #[cfg(not(target_os = "windows"))]
        {
            cmd.arg("-l");
        }

        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .context("Failed to open PTY")?;

        let child = pair
            .slave
            .spawn_command(cmd)
            .context("Failed to spawn shell")?;

        let session_id = format!("session-{}", self.next_id.fetch_add(1, Ordering::SeqCst));
        let reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;

        info!("Created session {} with shell: {}", session_id, shell_path);

        // Initialize the unified stream core for this session
        if let Ok(mut cores) = self.stream_cores.lock() {
            cores.insert(session_id.clone(), UnifiedStreamCore::new());
        }

        // Spawn reader task
        if let Some(app) = self.app_handle.read().clone() {
            let sid = session_id.clone();
            let cores = Arc::clone(&self.stream_cores);
            std::thread::spawn(move || {
                Self::read_pty_output(reader, &sid, &app, cores);
            });
        }

        let session = TerminalSession {
            session_id: session_id.clone(),
            shell: shell_path.clone(),
            cwd: working_dir.clone(),
            master: SendSync(pair.master),
            writer: Mutex::new(writer),
            child_killer: Mutex::new(child),
        };

        self.sessions
            .write()
            .insert(session_id.clone(), session);

        // Emit session created event
        if let Some(app) = self.app_handle.read().clone() {
            let _ = app.emit("session-created", &serde_json::json!({
                "session_id": session_id,
                "shell": shell_path,
                "cwd": working_dir,
            }));
        }

        Ok(session_id)
    }

    /// Write input to PTY
    pub fn write_input(&self, session_id: &str, data: &[u8]) -> Result<()> {
        tracing::debug!(
            session_id = %session_id,
            bytes = data.len(),
            "PtyManager::write_input"
        );
        let sessions = self.sessions.read();
        if let Some(session) = sessions.get(session_id) {
            let mut writer = session.writer.lock()
                .map_err(|e| anyhow::anyhow!("Writer lock poisoned: {}", e))?;
            writer.write_all(data)?;
            writer.flush()?;
            Ok(())
        } else {
            Err(anyhow::anyhow!("Session not found: {}", session_id))
        }
    }

    /// Resize PTY terminal
    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<()> {
        let sessions = self.sessions.read();
        if let Some(session) = sessions.get(session_id) {
            session.master.0.resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })?;
            info!("Resized session {} to {}x{}", session_id, cols, rows);
            Ok(())
        } else {
            Err(anyhow::anyhow!("Session not found: {}", session_id))
        }
    }

    /// Destroy a PTY session
    pub fn destroy_session(&self, session_id: &str) -> Result<()> {
        if let Ok(mut cores) = self.stream_cores.lock() {
            cores.remove(session_id);
        }

        let mut sessions = self.sessions.write();
        if let Some(session) = sessions.remove(session_id) {
            let mut killer = session.child_killer.lock()
                .map_err(|e| anyhow::anyhow!("Killer lock poisoned: {}", e))?;
            if let Err(e) = killer.kill() {
                warn!("Failed to kill child process: {}", e);
            }
            info!("Destroyed session: {}", session_id);
        }
        Ok(())
    }

    /// Execute a command in block mode: wraps user command with OSC 7701 markers,
    /// writes it to the PTY, and returns the generated command_id.
    pub fn execute_block_command(&self, session_id: &str, command: &str) -> Result<String> {
        let sessions = self.sessions.read();
        let session = sessions
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found: {}", session_id))?;

        let shell_type = ShellType::from_path(&session.shell);
        let command_id = block::generate_command_id();
        let wrapped = block::wrap_command(shell_type, &command_id, command);

        info!(
            "Executing block command: session={} cmd_id={} shell={:?}",
            session_id, command_id, shell_type
        );

        let mut writer = session
            .writer
            .lock()
            .map_err(|e| anyhow::anyhow!("Writer lock poisoned: {}", e))?;
        writer.write_all(wrapped.as_bytes())?;
        writer.flush()?;

        Ok(command_id)
    }

    /// Read PTY output and emit unified session events via UnifiedStreamCore.
    ///
    /// In 3.0, all output goes through a single `session-event` channel.
    /// The UnifiedStreamCore internally runs the three-stage pipeline
    /// (MarkerScanner → StreamCleaner → sanitize_output) and emits typed
    /// SessionEvent variants.
    fn read_pty_output<R: std::io::Read + Send + 'static>(
        mut reader: R,
        session_id: &str,
        app: &AppHandle,
        stream_cores: Arc<std::sync::Mutex<HashMap<String, UnifiedStreamCore>>>,
    ) {
        let session_id = session_id.to_string();
        let app = app.clone();

        let mut buffer = [0u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    info!("PTY EOF for session: {}", session_id);
                    event::session_ended(&session_id).emit(&app);
                    break;
                }
                Ok(n) => {
                    let chunk = &buffer[..n];

                    if let Ok(mut cores) = stream_cores.lock() {
                        if let Some(core) = cores.get_mut(&session_id) {
                            core.process_chunk(chunk, &session_id, &app);
                        }
                    }
                }
                Err(e) => {
                    error!("Error reading PTY output: {}", e);
                    event::session_error(&session_id, e.to_string()).emit(&app);
                    break;
                }
            }
        }
    }

    /// Get default shell for current platform
    fn default_shell() -> String {
        #[cfg(target_os = "windows")]
        {
            if let Ok(path) = std::env::var("POWERSHELL_PATH") {
                return path;
            }
            "pwsh".to_string()
        }

        #[cfg(target_os = "macos")]
        {
            "/bin/zsh".to_string()
        }

        #[cfg(target_os = "linux")]
        {
            "/bin/bash".to_string()
        }

        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        {
            "/bin/sh".to_string()
        }
    }

    /// Get default working directory
    fn default_cwd() -> String {
        std::env::current_dir()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string()
    }
}
