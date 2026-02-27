use serde::{Deserialize, Serialize};

use crate::model::collection::*;


#[derive(Debug, Serialize, Deserialize)]
pub struct HttpResponseDto {
  pub status: u16,
  pub headers: Vec<KeyValue>,
  pub body_text: String,
  pub duration_ms: u128,
}