use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tracing::{info, warn};

use crate::block::{self, ShellType};
use crate::stream::core::UnifiedStreamCore;
use crate::stream::event;

// ─── Types ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "protocol", rename_all = "camelCase")]
pub enum ConnectionConfig {
    #[serde(rename_all = "camelCase")]
    Ssh {
        host: String,
        port: u16,
        username: String,
        password: String,
    },
    #[serde(rename_all = "camelCase")]
    Telnet {
        host: String,
        port: u16,
    },
    #[serde(rename_all = "camelCase")]
    Serial {
        port_name: String,
        baud_rate: u32,
        data_bits: u8,
        stop_bits: u8,
        parity: String,
    },
    #[serde(rename_all = "camelCase")]
    Local {
        shell: String,
        cwd: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize)]
pub struct PortInfo {
    pub name: String,
    pub port_type: String,
}

// ─── Internal session ────────────────────────────────────────

struct TokioMpscWriter(tokio::sync::mpsc::UnboundedSender<Vec<u8>>);

impl Write for TokioMpscWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0
            .send(buf.to_vec())
            .map_err(|_| std::io::Error::new(std::io::ErrorKind::BrokenPipe, "channel closed"))?;
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

struct ConnectionSession {
    _session_id: String,
    _protocol: String,
    writer: Mutex<Box<dyn Write + Send>>,
    /// Channel to send resize events into the SSH I/O task.
    /// `None` for non-SSH protocols where resize is unsupported.
    resize_tx: Mutex<Option<tokio::sync::mpsc::UnboundedSender<(u16, u16)>>>,
    shutdown_flag: Arc<AtomicBool>,
    /// Preserved SSH handle for SFTP operations.  Only set for SSH sessions.
    /// Wrapped in Arc so it can be shared with SFTP channel operations
    /// without cloning `Handle` (which doesn't implement Clone).
    ssh_handle: Mutex<Option<Arc<russh::client::Handle<SshHandler>>>>,
}

// ─── SSH client handler (russh) ──────────────────────────────

pub struct SshHandler;

impl russh::client::Handler for SshHandler {
    type Error = anyhow::Error;

    fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::PublicKey,
    ) -> impl std::future::Future<Output = std::result::Result<bool, Self::Error>> + Send {
        async { Ok(true) }
    }
}

// ─── ConnectionManager ──────────────────────────────────────

pub struct ConnectionManager {
    sessions: Arc<RwLock<HashMap<String, ConnectionSession>>>,
    next_ids: Mutex<HashMap<String, AtomicUsize>>,
    app_handle: Arc<RwLock<Option<AppHandle>>>,
    /// Per-session unified stream cores (3.0: replaces separate MarkerScanner + StreamCleaner maps).
    stream_cores: Arc<std::sync::Mutex<HashMap<String, UnifiedStreamCore>>>,
    /// Pending SSH CWD queries: session_id → (marker_token, response_sender)
    cwd_queries: Arc<std::sync::Mutex<HashMap<String, (String, std::sync::mpsc::Sender<String>)>>>,
}

impl ConnectionManager {
    pub fn new() -> Self {
        let mut ids = HashMap::new();
        ids.insert("ssh".to_string(), AtomicUsize::new(1));
        ids.insert("telnet".to_string(), AtomicUsize::new(1));
        ids.insert("serial".to_string(), AtomicUsize::new(1));
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            next_ids: Mutex::new(ids),
            app_handle: Arc::new(RwLock::new(None)),
            stream_cores: Arc::new(std::sync::Mutex::new(HashMap::new())),
            cwd_queries: Arc::new(std::sync::Mutex::new(HashMap::new())),
        }
    }

    pub fn set_app_handle(&self, app: AppHandle) {
        *self.app_handle.write().unwrap() = Some(app);
    }

    fn next_session_id(&self, protocol: &str) -> String {
        let ids = self.next_ids.lock().unwrap();
        let counter = ids.get(protocol).expect("unknown protocol");
        let n = counter.fetch_add(1, Ordering::Relaxed);
        format!("{}-{}", protocol, n)
    }

    fn get_app_handle(&self) -> Option<AppHandle> {
        self.app_handle.read().unwrap().clone()
    }

    /// Retrieve a clone of the Arc-wrapped SSH handle for SFTP operations.
    ///
    /// `Handle::channel_open_session()` takes `&self`, so we can share
    /// the handle via Arc without consuming it.
    pub fn get_ssh_handle(
        &self,
        session_id: &str,
    ) -> Option<Arc<russh::client::Handle<SshHandler>>> {
        let sessions = self.sessions.read().unwrap();
        let session = sessions.get(session_id)?;
        let guard = session.ssh_handle.lock().unwrap();
        guard.as_ref().map(Arc::clone)
    }

    /// Query the remote shell's current working directory via SSH.
    /// Writes a single `echo` command and captures the response.
    /// The user sees one line of output which scrolls away naturally.
    pub async fn query_cwd(&self, session_id: &str) -> Result<String> {
        let token = format!("{:x}", std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos());
        let marker = format!("__CWD_{}__", token);

        let (tx, rx) = std::sync::mpsc::channel();

        {
            let mut queries = self.cwd_queries.lock().unwrap();
            queries.insert(session_id.to_string(), (marker.clone(), tx));
        }

        {
            let sessions = self.sessions.read().unwrap();
            let session = sessions
                .get(session_id)
                .ok_or_else(|| anyhow::anyhow!("SSH session not found: {}", session_id))?;
            let mut writer = session.writer.lock()
                .map_err(|e| anyhow::anyhow!("Writer lock poisoned: {}", e))?;
            let cmd = format!(
                "echo \"{} $(pwd -P 2>/dev/null || echo UNKNOWN)\"\n",
                marker
            );
            writer.write_all(cmd.as_bytes())?;
            writer.flush()?;
        }

        match rx.recv_timeout(std::time::Duration::from_secs(5)) {
            Ok(path) => Ok(path.trim().to_string()),
            Err(_) => {
                self.cwd_queries.lock().unwrap().remove(session_id);
                Err(anyhow::anyhow!("CWD query timed out for SSH session: {}", session_id))
            }
        }
    }

    /// Query remote server statistics via a SEPARATE SSH exec channel.
    /// Does NOT touch the user's interactive PTY — output is invisible to the terminal.
    pub async fn query_server_stats(&self, session_id: &str) -> Result<String> {
        let handle = self
            .get_ssh_handle(session_id)
            .ok_or_else(|| anyhow::anyhow!("SSH handle not found for: {}", session_id))?;

        // Pure-shell stats command — no python3 dependency.
        // Collects CPU / memory / disk / users / network bytes with rich detail.
        // Single-line format for maximum SSH server compatibility.
        let cmd = r#"cpu=$(cat /proc/stat 2>/dev/null|head -1|awk '{t=$2+$3+$4+$5+$6+$7+$8;if(t>0)printf "%.1f",100-($5*100/t);else print "0"}');cpu=${cpu:-0};cpu_user=$(cat /proc/stat 2>/dev/null|head -1|awk '{t=$2+$3+$4+$5+$6+$7+$8;if(t>0)printf "%.1f",($2+$3)*100/t;else print "0"}');cpu_user=${cpu_user:-0};cpu_sys=$(cat /proc/stat 2>/dev/null|head -1|awk '{t=$2+$3+$4+$5+$6+$7+$8;if(t>0)printf "%.1f",($4+$7+$8)*100/t;else print "0"}');cpu_sys=${cpu_sys:-0};cpu_idle=$(cat /proc/stat 2>/dev/null|head -1|awk '{t=$2+$3+$4+$5+$6+$7+$8;if(t>0)printf "%.1f",$5*100/t;else print "0"}');cpu_idle=${cpu_idle:-0};cpu_count=$(nproc 2>/dev/null||echo 0);load_avg=$(cat /proc/loadavg 2>/dev/null|awk '{printf "%s,%s,%s",$1,$2,$3}');load_avg=${load_avg:-0,0,0};uptime_sec=$(cat /proc/uptime 2>/dev/null|awk '{print int($1)}');uptime_sec=${uptime_sec:-0};mem_t=$(free -m 2>/dev/null|awk '/Mem:/{print $2}');mem_t=${mem_t:-0};mem_u=$(free -m 2>/dev/null|awk '/Mem:/{print $3}');mem_u=${mem_u:-0};mem_free=$(free -m 2>/dev/null|awk '/Mem:/{print $4}');mem_free=${mem_free:-0};mem_buf=$(free -m 2>/dev/null|awk '/Mem:/{print $5}');mem_buf=${mem_buf:-0};mem_cache=$(free -m 2>/dev/null|awk '/Mem:/{print $6}');mem_cache=${mem_cache:-0};dr_dev=$(df -h / 2>/dev/null|tail -1|awk '{print $1}');dr_dev=${dr_dev:-};dr_t=$(df -h / 2>/dev/null|tail -1|awk '{print $2}');dr_t=${dr_t:-0};dr_u=$(df -h / 2>/dev/null|tail -1|awk '{print $3}');dr_u=${dr_u:-0};dr_avail=$(df -h / 2>/dev/null|tail -1|awk '{print $4}');dr_avail=${dr_avail:-0};dr_pct=$(df -h / 2>/dev/null|tail -1|awk '{print $5}');dr_pct=${dr_pct:-0};disk_parts="[$(df -h 2>/dev/null|awk 'NR>1&&/^\/dev\//{gsub(/%/,"",$5);printf "%s|%s|%s|%s|%s|%s\n",$5,$1,$2,$3,$4,$6}'|sort -t'|' -k1 -rn|head -3|awk -F'|' '{if(NR>1)printf ",";printf "{\"mount\":\"%s\",\"dev\":\"%s\",\"total\":\"%s\",\"used\":\"%s\",\"avail\":\"%s\",\"pct\":\"%s%%\"}",$6,$2,$3,$4,$5,$1}')]";ifaces=$(ls /sys/class/net/ 2>/dev/null|grep -v lo|paste -sd, -);ifaces=${ifaces:-};rx_total=0;tx_total=0;for f in /sys/class/net/*/statistics/rx_bytes;do [ -f "$f" ]&&rx_total=$((rx_total+$(cat "$f" 2>/dev/null||echo 0)));done 2>/dev/null;for f in /sys/class/net/*/statistics/tx_bytes;do [ -f "$f" ]&&tx_total=$((tx_total+$(cat "$f" 2>/dev/null||echo 0)));done 2>/dev/null;user_json="[$(who 2>/dev/null|awk '{gsub(/\\/,"\\\\");gsub(/"/,"\\\"");if(NR>1)printf ",";printf "{\"name\":\"%s\",\"tty\":\"%s\",\"time\":\"%s %s\"}",$1,$2,$3,$4}')]";user_count=$(who 2>/dev/null|awk '{print $1}'|sort -u|wc -l);user_count=${user_count:-0};echo "{\"cpu\":{\"total\":$cpu,\"user\":$cpu_user,\"system\":$cpu_sys,\"idle\":$cpu_idle},\"cpu_count\":$cpu_count,\"load_avg\":\"$load_avg\",\"uptime\":$uptime_sec,\"mem\":{\"total\":\"$mem_t\",\"used\":\"$mem_u\",\"free\":\"$mem_free\",\"buffers\":\"$mem_buf\",\"cached\":\"$mem_cache\"},\"disk_root\":{\"dev\":\"$dr_dev\",\"total\":\"$dr_t\",\"used\":\"$dr_u\",\"avail\":\"$dr_avail\",\"pct\":\"$dr_pct\"},\"disk_parts\":$disk_parts,\"net\":{\"ifaces\":\"$ifaces\",\"rx\":$rx_total,\"tx\":$tx_total},\"users\":{\"count\":$user_count,\"list\":$user_json}}""#;

        // Open a fresh exec channel — completely isolated from the user's PTY.
        let mut channel = handle
            .channel_open_session()
            .await
            .context("Failed to open stats exec channel")?;

        channel
            .exec(true, cmd)
            .await
            .context("Failed to exec stats command")?;

        // Read output with timeout.
        let mut output = String::new();
        let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_secs(8);

        loop {
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            if remaining.is_zero() {
                break;
            }

            match tokio::time::timeout(remaining, channel.wait()).await {
                Ok(Some(russh::ChannelMsg::Data { data })) => {
                    output.push_str(&String::from_utf8_lossy(&data));
                }
                Ok(Some(russh::ChannelMsg::Eof)) | Ok(None) => break,
                Ok(Some(russh::ChannelMsg::ExitStatus { .. })) => {
                    // Drain any remaining data after exit status
                    continue;
                }
                Ok(Some(_)) => continue, // skip other message types
                Err(_) => break, // timeout
            }
        }

        let _ = channel.close().await;

        // Extract the last complete JSON line from output
        let json = output
            .lines()
            .filter(|l| l.starts_with('{') && l.contains("\"cpu\""))
            .last()
            .ok_or_else(|| {
                tracing::warn!(
                    session_id = %session_id,
                    output_len = output.len(),
                    output_preview = %if output.len() > 500 { &output[..500] } else { &output },
                    "No valid stats JSON in exec output"
                );
                anyhow::anyhow!("No valid stats JSON in exec output")
            })?;

        Ok(json.trim().to_string())
    }

    /// Remove a session from the manager (called on disconnect or SFTP cleanup).
    pub fn remove_session(&self, session_id: &str) {
        self.sessions.write().unwrap().remove(session_id);
    }

    // ─── Unified connect (async — SSH requires async) ────────

    pub async fn connect(&self, config: ConnectionConfig) -> Result<String> {
        match config {
            ConnectionConfig::Ssh { host, port, username, password } => {
                self.connect_ssh(&host, port, &username, &password).await
            }
            ConnectionConfig::Telnet { host, port } => {
                self.connect_telnet(&host, port)
            }
            ConnectionConfig::Serial { port_name, baud_rate, data_bits, stop_bits, parity } => {
                self.connect_serial(&port_name, baud_rate, data_bits, stop_bits, &parity)
            }
            ConnectionConfig::Local { .. } => {
                anyhow::bail!("Local config must be dispatched to PtyManager, not ConnectionManager")
            }
        }
    }

    // ─── SSH (async, pure Rust via russh) ────────────────────

    async fn connect_ssh(&self, host: &str, port: u16, username: &str, password: &str) -> Result<String> {
        let session_id = self.next_session_id("ssh");
        info!(session_id = %session_id, host = %host, port = %port, "Connecting SSH");

        let config = Arc::new(russh::client::Config {
            ..Default::default()
        });
        let handler = SshHandler;

        let mut handle = russh::client::connect(config, (host, port), handler)
            .await
            .context("SSH connect failed")?;

        let auth_result = handle
            .authenticate_password(username, password)
            .await
            .context("SSH authentication failed")?;

        if !auth_result.success() {
            anyhow::bail!("SSH authentication failed: invalid credentials");
        }

        let channel = handle
            .channel_open_session()
            .await
            .context("Failed to open SSH channel")?;

        channel
            .request_pty(false, "xterm-256color", 80, 24, 0, 0, &[])
            .await
            .context("Failed to request PTY")?;

        channel
            .request_shell(false)
            .await
            .context("Failed to start shell")?;

        let shutdown_flag = Arc::new(AtomicBool::new(false));
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
        let (resize_tx, mut resize_rx) = tokio::sync::mpsc::unbounded_channel::<(u16, u16)>();

        let sid = session_id.clone();
        let flag = shutdown_flag.clone();
        let app = self.get_app_handle();

        // Register a UnifiedStreamCore for this session.
        if let Ok(mut cores) = self.stream_cores.lock() {
            cores.insert(session_id.clone(), UnifiedStreamCore::new());
        }
        let stream_cores = Arc::clone(&self.stream_cores);
        let cwd_queries = Arc::clone(&self.cwd_queries);

        // Spawn async reader/writer task.
        // The handle is NOT moved into the task — Channel holds its own
        // reference to the underlying connection.  Handle stays in
        // ConnectionSession for SFTP use and is dropped on session removal.
        tokio::spawn(async move {
            let mut channel = channel;
            loop {
                if flag.load(Ordering::Relaxed) {
                    break;
                }

                tokio::select! {
                    msg = channel.wait() => {
                        match msg {
                            Some(russh::ChannelMsg::Data { data }) => {
                                let bytes: &[u8] = &data;
                                let len = bytes.len();
                                
                                if let Some(ref app) = app {
                                    // 3.0: single pipeline through UnifiedStreamCore
                                    {
                                        if let Ok(mut guard) = stream_cores.lock() {
                                            if let Some(core) = guard.get_mut(&sid) {
                                                core.process_chunk(bytes, &sid, app);
                                            }
                                        }
                                    }

                                    // Scan for CWD query markers (zero-overhead when no pending queries)
                                    {
                                        let mut queries = cwd_queries.lock().unwrap();
                                        if let Some((marker, tx)) = queries.remove(&sid) {
                                            if let Ok(text) = std::str::from_utf8(bytes) {
                                                let prefix = format!("{} ", marker);
                                                if let Some(pos) = text.find(&prefix) {
                                                    let after = &text[pos + prefix.len()..];
                                                    let path = after.lines().next().unwrap_or("").trim().to_string();
                                                    if !path.is_empty() && path != "UNKNOWN" {
                                                        let _ = tx.send(path);
                                                    }
                                                } else if text.contains(&marker) {
                                                    queries.insert(sid.clone(), (marker, tx));
                                                }
                                            }
                                        }
                                    }

                                    // Now apply throttle AFTER releasing the lock
                                    // This doesn't block rx.recv() in the select! loop
                                    if len >= 2048 {
                                        tokio::time::sleep(tokio::time::Duration::from_millis(8)).await;
                                    } else if len >= 512 {
                                        tokio::time::sleep(tokio::time::Duration::from_millis(4)).await;
                                    } else if len >= 128 {
                                        tokio::time::sleep(tokio::time::Duration::from_millis(2)).await;
                                    } else {
                                        tokio::time::sleep(tokio::time::Duration::from_millis(1)).await;
                                    }
                                }
                            }
                            Some(russh::ChannelMsg::Eof) | None => {
                                if let Some(ref app) = app {
                                    event::session_ended(&sid).emit(app);
                                }
                                break;
                            }
                            _ => {}
                        }
                    }
                    Some(data) = rx.recv() => {
                        if channel.data(&data[..]).await.is_err() {
                            break;
                        }
                    }
                    Some((cols, rows)) = resize_rx.recv() => {
                        let _ = channel.window_change(cols as u32, rows as u32, 0, 0).await;
                    }
                }
            }
            let _ = channel.close().await;
            // handle is dropped when ConnectionSession is removed from the manager
        });

        let session = ConnectionSession {
            _session_id: session_id.clone(),
            _protocol: "ssh".to_string(),
            writer: Mutex::new(Box::new(TokioMpscWriter(tx))),
            resize_tx: Mutex::new(Some(resize_tx)),
            shutdown_flag,
            ssh_handle: Mutex::new(Some(Arc::new(handle))),
        };

        self.sessions.write().unwrap().insert(session_id.clone(), session);
        //info!(session_id = %session_id, "SSH connected");
        Ok(session_id)
    }

    // ─── Telnet ──────────────────────────────────────────────

    fn connect_telnet(&self, host: &str, port: u16) -> Result<String> {
        let session_id = self.next_session_id("telnet");
        info!(session_id = %session_id, host = %host, port = %port, "Connecting Telnet");

        let stream = TcpStream::connect_timeout(
            &format!("{}:{}", host, port).parse().context("Invalid address")?,
            Duration::from_secs(10),
        ).context("Telnet TCP connect failed")?;

        let reader_stream = stream.try_clone().context("Failed to clone TCP stream")?;
        let writer_stream = stream;

        let shutdown_flag = Arc::new(AtomicBool::new(false));
        let sid = session_id.clone();
        let flag = shutdown_flag.clone();
        let app = self.get_app_handle();

        std::thread::spawn(move || {
            let mut reader = reader_stream;
            reader.set_read_timeout(Some(Duration::from_millis(100))).ok();
            let mut buf = [0u8; 4096];

            loop {
                if flag.load(Ordering::Relaxed) {
                    break;
                }

                match reader.read(&mut buf) {
                    Ok(0) => {
                        if let Some(ref app) = app {
                            event::session_ended(&sid).emit(app);
                        }
                        break;
                    }
                    Ok(n) => {
                        let chunk = &buf[..n];
                        let (clean_data, responses) = telnet_process_chunk(chunk);

                        for resp in responses {
                            let mut w: &TcpStream = &reader;
                            let _ = w.write_all(&resp);
                        }

                        if !clean_data.is_empty() {
                            if let Some(ref app) = app {
                                event::output(&sid, String::from_utf8_lossy(&clean_data)).emit(app);
                            }
                        }
                        
                        // Smart throttle: aggressively limit high-frequency small chunks
                        if n >= 2048 {
                            std::thread::sleep(std::time::Duration::from_millis(8));
                        } else if n >= 512 {
                            std::thread::sleep(std::time::Duration::from_millis(4));
                        } else if n >= 128 {
                            std::thread::sleep(std::time::Duration::from_millis(2));
                        } else {
                            std::thread::sleep(std::time::Duration::from_millis(1));
                        }
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut
                        || e.kind() == std::io::ErrorKind::WouldBlock => {
                        continue;
                    }
                    Err(e) => {
                        if !flag.load(Ordering::Relaxed) {
                            warn!(session_id = %sid, error = %e, "Telnet read error");
                            if let Some(ref app) = app {
                                event::session_error(&sid, e.to_string()).emit(app);
                                event::session_ended(&sid).emit(app);
                            }
                        }
                        break;
                    }
                }
            }
        });

        let session = ConnectionSession {
            _session_id: session_id.clone(),
            _protocol: "telnet".to_string(),
            writer: Mutex::new(Box::new(writer_stream)),
            resize_tx: Mutex::new(None),
            shutdown_flag,
            ssh_handle: Mutex::new(None),
        };

        self.sessions.write().unwrap().insert(session_id.clone(), session);
        info!(session_id = %session_id, "Telnet connected");
        Ok(session_id)
    }

    // ─── Serial ──────────────────────────────────────────────

    fn connect_serial(
        &self,
        port_name: &str,
        baud_rate: u32,
        data_bits: u8,
        stop_bits: u8,
        parity: &str,
    ) -> Result<String> {
        let session_id = self.next_session_id("serial");
        info!(session_id = %session_id, port = %port_name, baud = %baud_rate, "Connecting Serial");

        let db = match data_bits {
            5 => serialport::DataBits::Five,
            6 => serialport::DataBits::Six,
            7 => serialport::DataBits::Seven,
            _ => serialport::DataBits::Eight,
        };
        let sb = match stop_bits {
            2 => serialport::StopBits::Two,
            _ => serialport::StopBits::One,
        };
        let p = match parity {
            "odd" => serialport::Parity::Odd,
            "even" => serialport::Parity::Even,
            _ => serialport::Parity::None,
        };

        let port = serialport::new(port_name, baud_rate)
            .data_bits(db)
            .stop_bits(sb)
            .parity(p)
            .timeout(Duration::from_millis(100))
            .open()
            .context("Failed to open serial port")?;

        let reader_port = port.try_clone().context("Failed to clone serial port")?;
        let writer_port = port;

        let shutdown_flag = Arc::new(AtomicBool::new(false));
        let sid = session_id.clone();
        let flag = shutdown_flag.clone();
        let app = self.get_app_handle();

        std::thread::spawn(move || {
            let mut reader = reader_port;
            let mut buf = [0u8; 4096];

            loop {
                if flag.load(Ordering::Relaxed) {
                    break;
                }

                match reader.read(&mut buf) {
                    Ok(0) => {
                        if let Some(ref app) = app {
                            event::session_ended(&sid).emit(app);
                        }
                        break;
                    }
                    Ok(n) => {
                        if let Some(ref app) = app {
                            event::output(&sid, String::from_utf8_lossy(&buf[..n])).emit(app);
                        }
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut
                        || e.kind() == std::io::ErrorKind::WouldBlock => {
                        continue;
                    }
                    Err(e) => {
                        if !flag.load(Ordering::Relaxed) {
                            warn!(session_id = %sid, error = %e, "Serial read error");
                            if let Some(ref app) = app {
                                event::session_error(&sid, e.to_string()).emit(app);
                                event::session_ended(&sid).emit(app);
                            }
                        }
                        break;
                    }
                }
            }
        });

        let session = ConnectionSession {
            _session_id: session_id.clone(),
            _protocol: "serial".to_string(),
            writer: Mutex::new(Box::new(writer_port)),
            resize_tx: Mutex::new(None),
            shutdown_flag,
            ssh_handle: Mutex::new(None),
        };

        self.sessions.write().unwrap().insert(session_id.clone(), session);
        info!(session_id = %session_id, "Serial connected");
        Ok(session_id)
    }

    // ─── Write / Resize / Disconnect ────────────────────────

    pub fn write_input(&self, session_id: &str, data: &[u8]) -> Result<()> {
        tracing::debug!(
            session_id = %session_id,
            bytes = data.len(),
            "ConnectionManager::write_input"
        );
        let sessions = self.sessions.read().unwrap();
        let session = sessions.get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Connection session not found: {}", session_id))?;
        let mut writer = session.writer.lock().unwrap();
        writer.write_all(data).context("Failed to write to connection")?;
        writer.flush().context("Failed to flush connection writer")?;
        Ok(())
    }

    pub fn execute_block_command(&self, session_id: &str, command: &str) -> Result<String> {
        if !session_id.starts_with("ssh-") {
            anyhow::bail!("Blocks mode is only supported for SSH connection sessions");
        }
        let sessions = self.sessions.read().unwrap();
        let session = sessions.get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Connection session not found: {}", session_id))?;

        let shell_type = ShellType::Bash;
        let command_id = block::generate_command_id();
        let wrapped = block::wrap_command(shell_type, &command_id, command);

        info!(
            session_id = %session_id,
            command_id = %command_id,
            "ConnectionManager: executing block command"
        );

        let mut writer = session.writer.lock().unwrap();
        writer.write_all(wrapped.as_bytes()).context("Failed to write block command")?;
        writer.flush().context("Failed to flush block command")?;

        Ok(command_id)
    }

    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<()> {
        let sessions = self.sessions.read().unwrap();
        let session = sessions
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Connection session not found: {}", session_id))?;

        let tx_guard = session.resize_tx.lock().unwrap();
        match &*tx_guard {
            Some(tx) => {
                tx.send((cols, rows))
                    .map_err(|e| anyhow::anyhow!("Failed to send resize to SSH task: {}", e))?;
            }
            None => {
                // Telnet / serial — resize not yet implemented.
            }
        }
        Ok(())
    }

    pub fn disconnect(&self, session_id: &str) -> Result<()> {
        let mut sessions = self.sessions.write().unwrap();
        if let Some(session) = sessions.remove(session_id) {
            session.shutdown_flag.store(true, Ordering::Relaxed);
            info!(session_id = %session_id, "Connection disconnected");
        } else {
            warn!(session_id = %session_id, "Disconnect: session not found");
        }
        if let Ok(mut cores) = self.stream_cores.lock() {
            cores.remove(session_id);
        }
        Ok(())
    }

    pub fn list_serial_ports() -> Vec<PortInfo> {
        match serialport::available_ports() {
            Ok(ports) => ports.iter().map(|p| PortInfo {
                name: p.port_name.clone(),
                port_type: format!("{:?}", p.port_type),
            }).collect(),
            Err(e) => {
                warn!(error = %e, "Failed to list serial ports");
                Vec::new()
            }
        }
    }
}

// ─── Telnet IAC negotiation ──────────────────────────────────

const IAC: u8 = 255;
const DONT: u8 = 254;
const DO: u8 = 253;
const WONT: u8 = 252;
const WILL: u8 = 251;
const SB: u8 = 250;
const SE: u8 = 240;
const OPT_ECHO: u8 = 1;
const OPT_SUPPRESS_GO_AHEAD: u8 = 3;

fn telnet_process_chunk(data: &[u8]) -> (Vec<u8>, Vec<Vec<u8>>) {
    let mut clean = Vec::with_capacity(data.len());
    let mut responses: Vec<Vec<u8>> = Vec::new();
    let mut i = 0;

    while i < data.len() {
        if data[i] == IAC && i + 1 < data.len() {
            match data[i + 1] {
                DO if i + 2 < data.len() => {
                    let opt = data[i + 2];
                    if opt == OPT_ECHO || opt == OPT_SUPPRESS_GO_AHEAD {
                        responses.push(vec![IAC, WILL, opt]);
                    } else {
                        responses.push(vec![IAC, WONT, opt]);
                    }
                    i += 3;
                }
                DONT if i + 2 < data.len() => {
                    let opt = data[i + 2];
                    responses.push(vec![IAC, WONT, opt]);
                    i += 3;
                }
                WILL if i + 2 < data.len() => {
                    let opt = data[i + 2];
                    if opt == OPT_ECHO || opt == OPT_SUPPRESS_GO_AHEAD {
                        responses.push(vec![IAC, DO, opt]);
                    } else {
                        responses.push(vec![IAC, DONT, opt]);
                    }
                    i += 3;
                }
                WONT if i + 2 < data.len() => {
                    let opt = data[i + 2];
                    responses.push(vec![IAC, DONT, opt]);
                    i += 3;
                }
                SB => {
                    i += 2;
                    while i + 1 < data.len() {
                        if data[i] == IAC && data[i + 1] == SE {
                            i += 2;
                            break;
                        }
                        i += 1;
                    }
                }
                IAC => {
                    clean.push(255);
                    i += 2;
                }
                _ => {
                    i += 2;
                }
            }
        } else {
            clean.push(data[i]);
            i += 1;
        }
    }

    (clean, responses)
}

// ─── Tests ───────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_session_id_format() {
        let mgr = ConnectionManager::new();
        let id1 = mgr.next_session_id("ssh");
        let id2 = mgr.next_session_id("ssh");
        let id3 = mgr.next_session_id("telnet");
        assert!(id1.starts_with("ssh-"));
        assert!(id2.starts_with("ssh-"));
        assert!(id3.starts_with("telnet-"));
        assert_ne!(id1, id2);
    }

    #[test]
    fn test_list_serial_ports_no_panic() {
        let ports = ConnectionManager::list_serial_ports();
        let _ = ports.len();
    }

    #[test]
    fn test_telnet_iac_negotiation() {
        let data = vec![IAC, DO, OPT_ECHO, b'H', b'i'];
        let (clean, responses) = telnet_process_chunk(&data);
        assert_eq!(clean, b"Hi");
        assert_eq!(responses.len(), 1);
        assert_eq!(responses[0], vec![IAC, WILL, OPT_ECHO]);
    }

    #[test]
    fn test_telnet_iac_refuse_unknown() {
        let data = vec![IAC, DO, 99, b'O', b'K'];
        let (clean, responses) = telnet_process_chunk(&data);
        assert_eq!(clean, b"OK");
        assert_eq!(responses[0], vec![IAC, WONT, 99]);
    }

    #[test]
    fn test_telnet_clean_data_passthrough() {
        let data = b"Hello World\r\n";
        let (clean, responses) = telnet_process_chunk(data);
        assert_eq!(clean, data.to_vec());
        assert!(responses.is_empty());
    }

    #[test]
    fn test_connection_config_serde() {
        let config = ConnectionConfig::Ssh {
            host: "example.com".to_string(),
            port: 22,
            username: "user".to_string(),
            password: "pass".to_string(),
        };
        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("\"protocol\":\"ssh\""));

        let parsed: ConnectionConfig = serde_json::from_str(&json).unwrap();
        match parsed {
            ConnectionConfig::Ssh { host, port, .. } => {
                assert_eq!(host, "example.com");
                assert_eq!(port, 22);
            }
            _ => panic!("expected SSH config"),
        }
    }

    #[test]
    fn test_tokio_mpsc_writer() {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
        let mut writer = TokioMpscWriter(tx);
        let n = writer.write(b"hello").unwrap();
        assert_eq!(n, 5);
        writer.flush().unwrap();
        let received = rx.try_recv().unwrap();
        assert_eq!(received, b"hello");
    }

    #[tokio::test]
    async fn test_ssh_connect_invalid_host() {
        let mgr = ConnectionManager::new();
        let result = mgr.connect(ConnectionConfig::Ssh {
            host: "192.0.2.1".to_string(),
            port: 22,
            username: "test".to_string(),
            password: "test".to_string(),
        }).await;
        assert!(result.is_err());
    }
}
