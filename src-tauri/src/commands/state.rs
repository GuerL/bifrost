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

#[derive(Clone)]
pub struct StoredResponseBody {
    pub bytes: Vec<u8>,
}

#[derive(Default)]
pub struct ResponseBodyStore {
    pub bodies: Mutex<HashMap<String, StoredResponseBody>>,
    pub request_body_ids: Mutex<HashMap<String, String>>,
}
