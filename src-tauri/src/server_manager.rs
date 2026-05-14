//! Integrated Server Management — start/stop network services (TFTP, FTP, HTTP, etc.).
//!
//! Most services use mock logic that simulates startup delay and returns success.
//! Real implementations can be plugged in by replacing the mock spawn functions.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::time::{sleep, Duration};

// ─── Data types ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub default_port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceStatus {
    pub service: String,
    pub running: bool,
    pub pid: Option<u32>,
    pub port: u16,
    pub uptime_secs: Option<u64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FtpUser {
    pub login: String,
    pub password: String,
    pub root_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceConfig {
    pub port: u16,
    pub root_dir: Option<String>,
    pub args: Vec<String>,
    // TFTP-specific
    #[serde(default)]
    pub show_download_msg: bool,
    #[serde(default)]
    pub show_upload_msg: bool,
    #[serde(default)]
    pub auto_stop_enabled: bool,
    #[serde(default)]
    pub auto_stop_secs: u64,
    // FTP-specific
    #[serde(default)]
    pub ftp_users: Vec<FtpUser>,
    #[serde(default)]
    pub allow_anonymous: bool,
    #[serde(default)]
    pub use_utf8: bool,
    #[serde(default)]
    pub prompt_before_connect: bool,
}

impl Default for ServiceConfig {
    fn default() -> Self {
        Self {
            port: 69,
            root_dir: None,
            args: Vec::new(),
            show_download_msg: false,
            show_upload_msg: false,
            auto_stop_enabled: false,
            auto_stop_secs: 0,
            ftp_users: Vec::new(),
            allow_anonymous: false,
            use_utf8: false,
            prompt_before_connect: false,
        }
    }
}

/// Server log event sent to the frontend
#[derive(Debug, Clone, Serialize)]
struct ServerLogEvent {
    service: String,
    message: String,
    timestamp: String,
}

// ─── Service definitions ─────────────────────────────────────

fn builtin_services() -> Vec<ServiceInfo> {
    vec![
        ServiceInfo { id: "tftp".into(),   name: "TFTP".into(),    description: "Trivial File Transfer Protocol".into(), default_port: 69 },
        ServiceInfo { id: "ftp".into(),    name: "FTP".into(),     description: "File Transfer Protocol".into(),         default_port: 21 },
        ServiceInfo { id: "http".into(),   name: "HTTP".into(),    description: "Static HTTP file server".into(),        default_port: 8080 },
        ServiceInfo { id: "ssh".into(),    name: "SSH/SFTP".into(),description: "Secure Shell / SFTP".into(),             default_port: 22 },
        ServiceInfo { id: "telnet".into(), name: "Telnet".into(),  description: "Telnet remote login".into(),             default_port: 23 },
        ServiceInfo { id: "nfs".into(),    name: "NFS".into(),     description: "Network File System".into(),             default_port: 2049 },
        ServiceInfo { id: "vnc".into(),    name: "VNC".into(),     description: "Virtual Network Computing".into(),       default_port: 5900 },
        ServiceInfo { id: "cron".into(),   name: "Cron".into(),    description: "Scheduled task daemon".into(),            default_port: 0 },
        ServiceInfo { id: "iperf".into(),  name: "Iperf".into(),   description: "Network performance testing".into(),      default_port: 5201 },
    ]
}

// ─── Running process tracker ─────────────────────────────────

struct RunningService {
    pid: u32,
    port: u16,
    started_at: std::time::Instant,
}

pub struct ServerManager {
    services: Mutex<HashMap<String, RunningService>>,
    configs: Mutex<HashMap<String, ServiceConfig>>,
}

impl ServerManager {
    pub fn new() -> Self {
        let mut configs = HashMap::new();
        for s in builtin_services() {
            configs.insert(
                s.id.clone(),
                ServiceConfig {
                    port: s.default_port,
                    ..Default::default()
                },
            );
        }
        Self {
            services: Mutex::new(HashMap::new()),
            configs: Mutex::new(configs),
        }
    }
}

// ─── Tauri Commands ──────────────────────────────────────────

#[tauri::command]
pub async fn list_services() -> Result<Vec<ServiceInfo>, String> {
    Ok(builtin_services())
}

#[tauri::command]
pub async fn service_status(
    manager: tauri::State<'_, ServerManager>,
    service: String,
) -> Result<ServiceStatus, String> {
    let svc = builtin_services()
        .into_iter()
        .find(|s| s.id == service)
        .ok_or_else(|| format!("unknown service: {}", service))?;
    let services = manager.services.lock().unwrap();
    if let Some(r) = services.get(&service) {
        Ok(ServiceStatus {
            service,
            running: true,
            pid: Some(r.pid),
            port: r.port,
            uptime_secs: Some(r.started_at.elapsed().as_secs()),
            error: None,
        })
    } else {
        let configs = manager.configs.lock().unwrap();
        let port = configs.get(&service).map(|c| c.port).unwrap_or(svc.default_port);
        Ok(ServiceStatus {
            service,
            running: false,
            pid: None,
            port,
            uptime_secs: None,
            error: None,
        })
    }
}

fn emit_log(app: &AppHandle, service: &str, message: &str) {
    use std::time::SystemTime;
    let ts = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = ts.as_secs();
    let hh = (secs / 3600) % 24;
    let mm = (secs / 60) % 60;
    let ss = secs % 60;
    let _ = app.emit("server-log", ServerLogEvent {
        service: service.to_string(),
        message: message.to_string(),
        timestamp: format!("{:02}:{:02}:{:02}", hh, mm, ss),
    });
}

#[tauri::command]
pub async fn start_service(
    app: AppHandle,
    manager: tauri::State<'_, ServerManager>,
    service: String,
) -> Result<ServiceStatus, String> {
    let svc = builtin_services()
        .into_iter()
        .find(|s| s.id == service)
        .ok_or_else(|| format!("unknown service: {}", service))?;

    let port = {
        let services = manager.services.lock().unwrap();
        if services.contains_key(&service) {
            return Err(format!("{} is already running", svc.name));
        }
        let configs = manager.configs.lock().unwrap();
        configs.get(&service).map(|c| c.port).unwrap_or(svc.default_port)
    };

    emit_log(&app, &service, &format!("Starting {} server, please wait...", svc.name));

    // Mock: simulate startup delay
    sleep(Duration::from_millis(600)).await;

    emit_log(&app, &service, &format!("{} server started", svc.name));

    // Mock PID
    let pid = (std::process::id() as u32).wrapping_add(service.len() as u32);

    let mut services = manager.services.lock().unwrap();
    services.insert(
        service.clone(),
        RunningService {
            pid,
            port,
            started_at: std::time::Instant::now(),
        },
    );

    Ok(ServiceStatus {
        service: service.clone(),
        running: true,
        pid: Some(pid),
        port,
        uptime_secs: Some(0),
        error: None,
    })
}

#[tauri::command]
pub async fn stop_service(
    app: AppHandle,
    manager: tauri::State<'_, ServerManager>,
    service: String,
) -> Result<ServiceStatus, String> {
    let svc = builtin_services()
        .into_iter()
        .find(|s| s.id == service)
        .ok_or_else(|| format!("unknown service: {}", service))?;

    let mut services = manager.services.lock().unwrap();
    if services.remove(&service).is_none() {
        return Err(format!("{} is not running", svc.name));
    }

    emit_log(&app, &service, &format!("{} server stopped", svc.name));

    let configs = manager.configs.lock().unwrap();
    let port = configs.get(&service).map(|c| c.port).unwrap_or(svc.default_port);

    Ok(ServiceStatus {
        service,
        running: false,
        pid: None,
        port,
        uptime_secs: None,
        error: None,
    })
}

#[tauri::command]
pub async fn update_service_config(
    manager: tauri::State<'_, ServerManager>,
    service: String,
    config: ServiceConfig,
) -> Result<(), String> {
    let mut configs = manager.configs.lock().unwrap();
    configs.insert(service, config);
    Ok(())
}

#[tauri::command]
pub async fn get_service_config(
    manager: tauri::State<'_, ServerManager>,
    service: String,
) -> Result<ServiceConfig, String> {
    let configs = manager.configs.lock().unwrap();
    configs
        .get(&service)
        .cloned()
        .ok_or_else(|| format!("unknown service: {}", service))
}
