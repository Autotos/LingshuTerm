//! AI API proxy — routes chat completion requests through the Rust backend
//! to bypass browser CORS restrictions on provider endpoints.

use serde::{Deserialize, Serialize};

// ─── Request / response types ────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ProxyRequest {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub max_tokens: u32,
    pub temperature: f32,
    pub messages: Vec<ChatMessage>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String, // "system" | "user" | "assistant"
    pub content: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct ProxyResponse {
    pub status: u16,
    pub body: String,
    pub ok: bool,
}

// ─── Tauri command ───────────────────────────────────────────────

#[tauri::command]
pub async fn ai_proxy_request(req: ProxyRequest) -> Result<ProxyResponse, String> {
    let url = format!(
        "{}/chat/completions",
        req.base_url.trim_end_matches('/')
    );

    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert("Content-Type", "application/json".parse().unwrap());
    if !req.api_key.is_empty() {
        headers.insert(
            "Authorization",
            format!("Bearer {}", req.api_key).parse::<reqwest::header::HeaderValue>().map_err(|e| e.to_string())?,
        );
    }

    let body = serde_json::json!({
        "model": req.model,
        "messages": req.messages,
        "max_tokens": req.max_tokens,
        "temperature": req.temperature,
    });

    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let resp = client
        .post(&url)
        .headers(headers)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("AI proxy request failed: {}", e))?;

    let status = resp.status().as_u16();
    let body = resp.text().await.unwrap_or_default();
    let ok = status >= 200 && status < 300;

    Ok(ProxyResponse { status, body, ok })
}
