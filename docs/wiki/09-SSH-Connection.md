# 09 — SSH 远程连接 (Rust)

## 功能职责

基于 `russh` 的纯 Rust SSH 客户端实现，支持密码认证、PTY 交互、SFTP 文件传输和服务端统计信息查询。所有 SSH 操作通过单独的 channel 执行，与用户交互式 PTY 完全隔离。

## 核心数据结构

### ConnectionManager ([connection.rs:102-110](../src-tauri/src/connection.rs))

```rust
pub struct ConnectionManager {
    sessions: Arc<RwLock<HashMap<String, ConnectionSession>>>,
    next_ids: Mutex<HashMap<String, AtomicUsize>>,     // 协议 → 自增计数器
    app_handle: Arc<RwLock<Option<AppHandle>>>,
    stream_cores: Arc<Mutex<HashMap<String, UnifiedStreamCore>>>,
    cwd_queries: Arc<Mutex<HashMap<String, (String, Sender<String>)>>>,
}

struct ConnectionSession {
    _session_id: String,
    _protocol: String,
    writer: Mutex<Box<dyn Write + Send>>,              // 输入通道
    resize_tx: Mutex<Option<UnboundedSender<(u16, u16)>>>, // 终端调大小
    shutdown_flag: Arc<AtomicBool>,
    ssh_handle: Mutex<Option<Arc<russh::client::Handle<SshHandler>>>>, // SFTP 句柄
}
```

### SshHandler ([connection.rs:87-98](../src-tauri/src/connection.rs))

```rust
pub struct SshHandler;

impl russh::client::Handler for SshHandler {
    type Error = anyhow::Error;
    fn check_server_key(&self, _key: &PublicKey) -> impl Future<Output = Result<bool>> {
        async { Ok(true) }  // 当前接受所有主机密钥
    }
}
```

## 代码逻辑框架

### SSH 连接流程 ([connection.rs:282-429](../src-tauri/src/connection.rs))

```
connect_ssh(host, port, username, password)
  │
  ├─ 1. 生成 session_id = "ssh-{N}"
  │
  ├─ 2. russh::client::connect(config, (host, port), SshHandler)
  │     └─ 建立 TCP + SSH 协议握手
  │
  ├─ 3. handle.authenticate_password(username, password)
  │
  ├─ 4. channel.open_session()
  │     ├─ channel.request_pty(false, "xterm-256color", 80, 24, ...)
  │     └─ channel.request_shell(false)
  │
  ├─ 5. 创建 I/O 通道
  │     ├─ tx/rx: mpsc::unbounded_channel (前端 → PTY 输入)
  │     └─ resize_tx/rx: mpsc::unbounded_channel (终端 resize)
  │
  ├─ 6. 注册 UnifiedStreamCore (输出处理管线)
  │
  ├─ 7. spawn tokio task (异步读写循环)
  │     loop {
  │       tokio::select! {
  │         msg = channel.wait() → {
  │           Data → UnifiedStreamCore.process_chunk() + CWD query scan
  │           Eof  → emit session_ended
  │         }
  │         data = rx.recv() → channel.data(&data)
  │         (cols, rows) = resize_rx.recv() → channel.window_change()
  │       }
  │     }
  │
  └─ 8. 存储 ConnectionSession 到 sessions HashMap
```

### 服务端统计查询 ([connection.rs:199-254](../src-tauri/src/connection.rs))

```
query_server_stats(session_id)
  │
  ├─ 1. 获取 SSH Handle (get_ssh_handle)
  │
  ├─ 2. 打开新的 exec channel (与用户 PTY 隔离)
  │     channel.open_session()
  │     channel.exec(true, shell_command)
  │
  ├─ 3. 读取输出 (8 秒超时)
  │     loop { channel.wait() → Data → output.push() }
  │
  ├─ 4. 提取 JSON
  │     output.lines()
  │       .filter(|l| l.starts_with('{') && l.contains("\"cpu\""))
  │       .last()
  │
  └─ 返回 JSON 字符串
```

统计命令收集：CPU（total/user/system/idle）、MEM（total/used/free/buffers/cached）、DISK（根分区 + 前 3 个分区）、NET（网卡名 + 总收发字节）、USERS（在线用户列表 + 登录时间）。

### CWD 查询 ([connection.rs:159-195](../src-tauri/src/connection.rs))

通过向用户 PTY 注入 `echo "__CWD_{token}__ $(pwd -P)"` 命令并监听输出来获取远程工作目录。5 秒超时。

## 扩展点与约束

### 约束

- **主机密钥**：当前无条件接受所有主机密钥（`check_server_key` 返回 `Ok(true)`），不进行 TOFU 验证
- **认证方式**：仅支持密码认证，不支持密钥认证
- **SFTP 句柄**：通过 `Arc<russh::client::Handle>` 共享（Handle 不实现 Clone），保存在 `ssh_handle` 字段中
- **统计查询**：使用纯 shell 命令（/proc/stat, free, df, who），仅适用于 Linux 服务器
