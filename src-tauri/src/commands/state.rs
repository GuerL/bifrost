use std::collections::HashMap;
use std::sync::Mutex;
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
pub struct RunningRequest {
  pub run_id: String,
  pub token: CancellationToken,
}

#[derive(Default)]
pub struct RequestRegistry {
  pub running: Mutex<HashMap<String, RunningRequest>>,
}
