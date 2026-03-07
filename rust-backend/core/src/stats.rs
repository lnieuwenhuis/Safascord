use std::sync::Arc;

use serde::Serialize;
use tokio::sync::RwLock;

#[derive(Debug, Default, Clone, Serialize)]
pub struct RequestStats {
    pub total_requests: u64,
    pub total_latency: f64,
    pub max_latency: f64,
    pub start_time: i64,
    pub period_requests: u64,
    pub period_latency: f64,
}

pub type SharedRequestStats = Arc<RwLock<RequestStats>>;
