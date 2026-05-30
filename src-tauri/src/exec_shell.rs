//! Direct shell command execution — bypasses the interactive PTY entirely.
//!
//! The PTY approach fails for background command capture because the shell
//! echoes every line of input in interactive mode, and ANSI/VT control codes
//! pollute the output stream.
//!
//! This module spawns a child process directly (shell → command → stdout)
//! and returns the captured output with no PTY noise.

use std::process::Command;
use std::time::Duration;
use tracing::warn;

/// Result of executing a shell command directly.
#[derive(serde::Serialize)]
pub struct ExecShellResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

/// Execute a command via the platform shell and capture its output.
///
/// On Windows, uses `powershell.exe -NoProfile -NonInteractive -Command`.
/// On Unix, uses `sh -c`.
///
/// The command runs with a 60-second timeout; if it exceeds this, the
/// process is killed and exit_code is set to -1.
#[tauri::command]
pub fn exec_shell_cmd(command: String, timeout_secs: Option<u64>) -> ExecShellResult {
    let timeout = Duration::from_secs(timeout_secs.unwrap_or(60).min(600));

    let shell: &str;
    let shell_args: Vec<&str>;
    let utf8_cmd: String;

    #[cfg(target_os = "windows")]
    {
        utf8_cmd = format!(
            "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;$OutputEncoding=[System.Text.UTF8Encoding]::new();{}",
            command
        );
        shell = "powershell.exe";
        shell_args = vec![
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &utf8_cmd,
        ];
    }

    #[cfg(not(target_os = "windows"))]
    {
        shell = "sh";
        shell_args = vec!["-c", &command];
        // suppress unused warning on Windows
        let _ = &utf8_cmd;
    }

    match Command::new(shell)
        .args(&shell_args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
    {
        Ok(mut child) => {
            // Wait with timeout
            let exit_code = match wait_timeout(&mut child, timeout) {
                Ok(Some(status)) => status.code().unwrap_or(-1),
                Ok(None) => {
                    // Timed out — kill the process
                    let _ = child.kill();
                    let _ = child.wait();
                    -1
                }
                Err(e) => {
                    warn!("exec_shell_cmd: wait error: {}", e);
                    let _ = child.kill();
                    let _ = child.wait();
                    -1
                }
            };

            let stdout = child
                .stdout
                .take()
                .and_then(|out| {
                    use std::io::Read;
                    let mut buf = Vec::new();
                    let mut handle = out;
                    handle.read_to_end(&mut buf).ok()?;
                    Some(String::from_utf8_lossy(&buf).to_string())
                })
                .unwrap_or_default();

            let stderr = child
                .stderr
                .take()
                .and_then(|err| {
                    use std::io::Read;
                    let mut buf = Vec::new();
                    let mut handle = err;
                    handle.read_to_end(&mut buf).ok()?;
                    Some(String::from_utf8_lossy(&buf).to_string())
                })
                .unwrap_or_default();

            ExecShellResult {
                exit_code,
                stdout,
                stderr,
            }
        }
        Err(e) => {
            warn!("exec_shell_cmd: spawn error: {}", e);
            ExecShellResult {
                exit_code: -1,
                stdout: String::new(),
                stderr: format!("Failed to spawn shell: {}", e),
            }
        }
    }
}

fn wait_timeout(
    child: &mut std::process::Child,
    timeout: Duration,
) -> std::io::Result<Option<std::process::ExitStatus>> {
    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Ok(Some(status)),
            Ok(None) => {
                if start.elapsed() >= timeout {
                    return Ok(None);
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(e),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_echo_command() {
        let result = exec_shell_cmd("echo hello".to_string(), Some(10));
        assert!(result.stdout.trim().contains("hello"));
        assert_eq!(result.exit_code, 0);
    }

    #[test]
    fn test_failing_command() {
        let result = exec_shell_cmd("exit 42".to_string(), Some(10));
        assert_eq!(result.exit_code, 42);
    }
}
