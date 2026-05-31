//! Shell command execution — streaming + cancellable.
//!
//! `exec_shell_stream` spawns a child process and emits Tauri events for each
//! output chunk as it arrives, so the frontend can show real-time progress.
//! `kill_shell_task` kills a running task by task_id.
//!
//! A global registry tracks active child processes for cancellation.

use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tracing::warn;

// ─── Task registry ────────────────────────────────────────────────

type TaskMap = Arc<Mutex<HashMap<String, Arc<Mutex<Child>>>>>;

fn task_registry() -> TaskMap {
    static REGISTRY: std::sync::OnceLock<TaskMap> = std::sync::OnceLock::new();
    REGISTRY.get_or_init(|| Arc::new(Mutex::new(HashMap::new()))).clone()
}

fn task_id() -> String {
    format!(
        "sh-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    )
}

// ─── Event payloads ───────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
struct ShellChunk {
    task_id: String,
    data: String,
}

#[derive(Debug, Clone, Serialize)]
struct ShellDone {
    task_id: String,
    exit_code: i32,
}

// ─── Tauri commands ───────────────────────────────────────────────

/// Spawn a shell command and stream output via Tauri events.
/// Returns a task_id that can be used with `kill_shell_task`.
#[tauri::command]
pub fn exec_shell_stream(
    app: AppHandle,
    command: String,
    timeout_secs: Option<u64>,
) -> String {
    let id = task_id();
    let timeout = Duration::from_secs(timeout_secs.unwrap_or(60).min(600));
    let registry = task_registry();

    // Leak the command to get 'static lifetime for the thread
    #[cfg(target_os = "windows")]
    let wrapped = Box::leak(
        format!(
            "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;$OutputEncoding=[System.Text.UTF8Encoding]::new();{}",
            command
        ).into_boxed_str()
    ) as &'static str;
    #[cfg(not(target_os = "windows"))]
    let wrapped = Box::leak(command.into_boxed_str()) as &'static str;

    let (shell, shell_args): (&str, Vec<&str>) = if cfg!(target_os = "windows") {
        ("powershell.exe", vec!["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", wrapped])
    } else {
        ("sh", vec!["-c", wrapped])
    };

    let app_handle = app.clone();
    let tid = id.clone();

    std::thread::spawn(move || {
        let child = match Command::new(shell)
            .args(&shell_args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                let _ = app_handle.emit("shell-output", ShellChunk { task_id: tid.clone(), data: format!("spawn error: {}", e) });
                let _ = app_handle.emit("shell-complete", ShellDone { task_id: tid, exit_code: -1 });
                return;
            }
        };

        let child_arc = Arc::new(Mutex::new(child));
        registry.lock().unwrap().insert(tid.clone(), child_arc.clone());

        let mut child_lock = child_arc.lock().unwrap();
        let stdout = child_lock.stdout.take();
        let stderr = child_lock.stderr.take();
        drop(child_lock);

        // Read stdout in a separate thread, stderr in another
        let app_stdout = app_handle.clone();
        let tid_stdout = tid.clone();
        let stdout_handle = std::thread::spawn(move || {
            if let Some(out) = stdout {
                let reader = BufReader::new(out);
                for line in reader.lines() {
                    if let Ok(text) = line {
                        let _ = app_stdout.emit("shell-output", ShellChunk { task_id: tid_stdout.clone(), data: format!("{}\n", text) });
                    }
                }
            }
        });

        let app_stderr = app_handle.clone();
        let tid_stderr = tid.clone();
        let stderr_handle = std::thread::spawn(move || {
            if let Some(err) = stderr {
                let reader = BufReader::new(err);
                for line in reader.lines() {
                    if let Ok(text) = line {
                        let _ = app_stderr.emit("shell-output", ShellChunk { task_id: tid_stderr.clone(), data: format!("{}\n", text) });
                    }
                }
            }
        });

        // Wait for both readers to finish or timeout
        let _ = stdout_handle.join();
        let _ = stderr_handle.join();

        // Get exit code
        let exit_code = {
            let mut guard = child_arc.lock().unwrap();
            match wait_timeout(&mut *guard, timeout) {
                Ok(Some(s)) => s.code().unwrap_or(-1),
                _ => { let _ = guard.kill(); -1 }
            }
        };

        { let mut map = registry.lock().unwrap(); map.remove(&tid); }
        let _ = app_handle.emit("shell-complete", ShellDone { task_id: tid, exit_code });
    });

    id
}

/// Kill a running shell task by task_id.
#[tauri::command]
pub fn kill_shell_task(task_id: String) -> bool {
    let registry = task_registry();
    let child = {
        let mut map = registry.lock().unwrap();
        map.remove(&task_id)
    };
    if let Some(ca) = child {
        if let Ok(mut c) = ca.lock() {
            let _ = c.kill();
            let _ = c.wait();
        }
        true
    } else {
        false
    }
}

// ─── Existing sync command (kept for backward compat) ─────────────

#[derive(serde::Serialize)]
pub struct ExecShellResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

#[tauri::command]
pub fn exec_shell_cmd(command: String, timeout_secs: Option<u64>) -> ExecShellResult {
    let timeout = Duration::from_secs(timeout_secs.unwrap_or(60).min(600));
    let shell: &str;
    let shell_args: Vec<String>;
    #[cfg(target_os = "windows")]
    {
        shell = "powershell.exe";
        shell_args = vec![
            "-NoProfile".into(), "-NonInteractive".into(), "-ExecutionPolicy".into(), "Bypass".into(), "-Command".into(),
            format!("[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;$OutputEncoding=[System.Text.UTF8Encoding]::new();{}", command),
        ];
    }
    #[cfg(not(target_os = "windows"))]
    {
        shell = "sh";
        shell_args = vec!["-c".into(), command];
    }

    match Command::new(shell).args(&shell_args).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn() {
        Ok(mut child) => {
            let exit_code = match wait_timeout(&mut child, timeout) {
                Ok(Some(s)) => s.code().unwrap_or(-1),
                Ok(None) => { let _ = child.kill(); let _ = child.wait(); -1 }
                Err(e) => { warn!("exec_shell_cmd wait error: {}", e); let _ = child.kill(); let _ = child.wait(); -1 }
            };
            let mut out_buf = Vec::new();
            let mut err_buf = Vec::new();
            if let Some(mut out) = child.stdout.take() { let _ = out.read_to_end(&mut out_buf); }
            if let Some(mut err) = child.stderr.take() { let _ = err.read_to_end(&mut err_buf); }
            ExecShellResult {
                exit_code,
                stdout: String::from_utf8_lossy(&out_buf).to_string(),
                stderr: String::from_utf8_lossy(&err_buf).to_string(),
            }
        }
        Err(e) => {
            warn!("exec_shell_cmd spawn error: {}", e);
            ExecShellResult { exit_code: -1, stdout: String::new(), stderr: format!("spawn error: {}", e) }
        }
    }
}

fn wait_timeout(child: &mut std::process::Child, timeout: Duration) -> std::io::Result<Option<std::process::ExitStatus>> {
    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(s)) => return Ok(Some(s)),
            Ok(None) => { if start.elapsed() >= timeout { return Ok(None); } std::thread::sleep(Duration::from_millis(100)); }
            Err(e) => return Err(e),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_echo() {
        let r = exec_shell_cmd("echo hello".into(), Some(10));
        assert!(r.stdout.contains("hello"));
    }
    #[test]
    fn test_task_id_unique() {
        let a = task_id(); std::thread::sleep(Duration::from_millis(2));
        let b = task_id();
        assert_ne!(a, b);
    }
}
