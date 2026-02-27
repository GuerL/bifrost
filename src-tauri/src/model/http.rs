use serde::{Deserialize, Serialize};

use crate::model::collection::*;


#[derive(Debug, Serialize, Deserialize)]
pub struct HttpResponseDto {
  pub status: u16,
  pub headers: Vec<KeyValue>,
  pub body_text: String,
  pub duration_ms: u128,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HttpErrorDto {
  pub kind: String,        // "invalid_url" | "dns" | "timeout" | "connect" | "tls" | "http" | "unknown"
  pub message: String,     // message humain
  pub detail: Option<String>, // detail technique (optionnel)
  pub duration_ms: Option<u128>,
}