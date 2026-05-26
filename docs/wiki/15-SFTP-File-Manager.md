# 15 — SFTP 文件管理

## 功能职责

基于 SSH 连接的远程文件管理器，支持浏览目录树、上传/下载文件、编辑文本文件、删除/重命名操作。

## 核心数据结构

### SftpManager (Rust) ([sftp.rs](../src-tauri/src/sftp.rs))

管理 SSH SFTP 通道的打开/关闭。每次 SFTP 操作通过 `ConnectionManager.get_ssh_handle()` 获取共享的 SSH handle，然后打开 SFTP channel。

### SftpStore (前端) ([sftpStore.ts](../src/stores/sftpStore.ts))

```typescript
interface SftpState {
  currentPath: string;           // 当前浏览路径
  files: FileEntry[];            // 当前目录的文件列表
  history: string[];             // 路径历史（用于后退）
  selectedFile: FileEntry | null;
  isLoading: boolean;
}
```

## 代码逻辑框架

### 文件操作命令

| 命令 | Tauri Invoke | 说明 |
|------|-------------|------|
| 浏览目录 | `sftp_list_dir(sessionId, path)` | 返回 `FileEntry[]` |
| 读取文件 | `sftp_read_file(sessionId, path)` | 返回文件内容字符串 |
| 写入文件 | `sftp_write_file(sessionId, path, content)` | 覆盖写入 |
| 上传文件 | `sftp_upload_file(sessionId, localPath, remotePath)` | 本地 → 远程 |
| 下载文件 | `sftp_download_file(sessionId, remotePath, localPath)` | 远程 → 本地 |
| 家目录 | `sftp_home_dir(sessionId)` | 返回用户远程家目录 |
| 文件属性 | `sftp_file_properties(sessionId, path)` | 大小/权限/修改时间 |
| 创建目录 | `sftp_create_dir(sessionId, path)` | 递归创建 |
| 创建文件 | `sftp_create_file(sessionId, path)` | 空文件 |
| 删除 | `sftp_delete_item(sessionId, path)` | 文件或空目录 |
| 重命名 | `sftp_rename_item(sessionId, old, new)` | 移动/重命名 |

### 目录树组件 ([FileTreeNode.tsx](../src/components/FileTreeNode.tsx))

递归渲染目录树节点，支持展开/折叠、文件图标、右键菜单。

### 面板布局 ([SftpPanel.tsx](../src/components/SftpPanel.tsx))

右侧 320px 抽屉面板：
- 顶部：路径面包屑 + 后退/前进 + 刷新按钮
- 主体：文件列表（图标 + 名称 + 大小 + 日期）
- 支持拖拽上传、双击目录进入、右键菜单

## 扩展点与约束

### 约束

- **仅 SSH 会话**：SFTP 功能仅对 `ssh-*` 会话可用
- **文件大小限制**：`sftp_read_file` 将整个文件内容加载到内存，大文件可能 OOM
- **无进度指示**：上传/下载操作无进度回调，大文件可能阻塞 UI
