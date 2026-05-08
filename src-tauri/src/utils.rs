//! 应用级工具：工作空间初始化、路径解析等。

use std::path::PathBuf;

/// 解析用户家目录（跨平台）。
fn home_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var("USERPROFILE").ok().map(PathBuf::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("HOME").ok().map(PathBuf::from)
    }
}

/// LingShuTerm 工作空间根目录：`{HOME}/.LingShuTerm/workspace`
///
/// - Windows: `%USERPROFILE%\.LingShuTerm\workspace`
/// - macOS/Linux: `~/.LingShuTerm/workspace`
pub fn workspace_dir() -> Result<PathBuf, String> {
    let home = home_dir().ok_or_else(|| "cannot resolve home directory".to_string())?;
    Ok(home.join(".LingShuTerm").join("workspace"))
}

/// 确保工作空间目录存在（递归创建），应用启动时调用一次。
pub fn ensure_workspace() -> Result<PathBuf, String> {
    let dir = workspace_dir()?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("failed to create workspace {:?}: {}", dir, e))?;
    tracing::info!(path = %dir.display(), "workspace ensured");
    Ok(dir)
}
