use serde::{Deserialize, Serialize};

use crate::model::collection::*;

#[derive(Debug, Serialize, Deserialize)]
pub struct HttpResponseDto {
    pub status: u16,
    pub headers: Vec<KeyValue>,
    pub body_text: String,
    pub body: HttpResponseBodyDto,
    pub duration_ms: u128,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HttpResponseBodyDto {
    pub kind: HttpResponseBodyKind,
    pub body_id: String,
    pub size: u64,
    pub filename: String,
    pub mime_type: Option<String>,
    pub content_disposition: Option<String>,
    pub downloadable: bool,
    pub available: bool,
    pub description: String,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HttpResponseBodyKind {
    Text,
    Binary,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HttpErrorDto {
    pub kind: String, // normalized network category: "dns" | "connection_refused" | "connection_timeout" | "request_timeout" | "tls" | "proxy" | ...
    pub message: String, // message humain
    pub detail: Option<String>, // detail technique (optionnel)
    #[serde(default)]
    pub diagnostics: Vec<HttpErrorDiagnosticDto>,
    pub duration_ms: Option<u128>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HttpErrorDiagnosticDto {
    pub label: String,
    pub value: String,
}
