//! Media file utilities — read image files for thumbnail display.

use base64::{engine::general_purpose::STANDARD, Engine};
use std::fs;
use tracing::warn;

/// Read a local image file and return its base64-encoded data URL.
/// Returns empty string if the file doesn't exist or can't be read.
/// Max file size: 10 MB (larger images would be too slow in base64).
#[tauri::command]
pub fn read_image_base64(path: String) -> String {
    let p = std::path::Path::new(&path);
    if !p.exists() || !p.is_file() {
        return String::new();
    }

    // Reject files > 10 MB
    if let Ok(meta) = fs::metadata(p) {
        if meta.len() > 10 * 1024 * 1024 {
            warn!("read_image_base64: file too large: {}", path);
            return String::new();
        }
    }

    let data = match fs::read(p) {
        Ok(d) => d,
        Err(e) => {
            warn!("read_image_base64: read error for {}: {}", path, e);
            return String::new();
        }
    };

    let mime = mime_type(&path);
    let b64 = STANDARD.encode(&data);
    format!("data:{};base64,{}", mime, b64)
}

fn mime_type(path: &str) -> &str {
    let lower = path.to_lowercase();
    if lower.ends_with(".png") { return "image/png"; }
    if lower.ends_with(".gif") { return "image/gif"; }
    if lower.ends_with(".webp") { return "image/webp"; }
    if lower.ends_with(".bmp") { return "image/bmp"; }
    if lower.ends_with(".svg") { return "image/svg+xml"; }
    if lower.ends_with(".tiff") || lower.ends_with(".tif") { return "image/tiff"; }
    "image/jpeg" // default for .jpg, .jpeg
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_missing_file_returns_empty() {
        let result = read_image_base64("Z:\\nonexistent\\file.jpg".to_string());
        assert!(result.is_empty());
    }

    #[test]
    fn test_mime_detection() {
        assert_eq!(mime_type("photo.jpg"), "image/jpeg");
        assert_eq!(mime_type("icon.png"), "image/png");
        assert_eq!(mime_type("anim.gif"), "image/gif");
    }
}
