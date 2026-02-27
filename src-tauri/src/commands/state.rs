use std::collections::HashMap;
use std::sync::Mutex;
use tokio_util::sync::CancellationToken;

#[derive(Default)]
pub struct RequestRegistry {
  pub tokens: Mutex<HashMap<String, CancellationToken>>,
}