use std::sync::Arc;

use anyhow::Result;
use aws_sdk_s3::Client as S3Client;
use redis::Client as RedisClient;
use reqwest::Client as HttpClient;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions, PgSslMode};
use sqlx::PgPool;
use tokio::sync::RwLock;

use crate::config::AppConfig;
use crate::s3::build_s3_client;
use crate::stats::{RequestStats, SharedRequestStats};

#[derive(Clone)]
pub struct AppState {
    pub config: AppConfig,
    pub pool: PgPool,
    pub http: HttpClient,
    pub s3: S3Client,
    pub redis: RedisClient,
    pub request_stats: SharedRequestStats,
}

pub type SharedState = Arc<AppState>;

impl AppState {
    pub async fn from_config(config: AppConfig) -> Result<Self> {
        let mut options: PgConnectOptions = config.database_url.parse()?;
        if config.database_ssl {
            options = options.ssl_mode(PgSslMode::Require);
        }
        let pool = PgPoolOptions::new()
            .max_connections(20)
            .connect_with(options)
            .await?;
        let s3 = build_s3_client(&config.s3).await?;
        let redis_url = config
            .redis_url
            .clone()
            .or_else(|| {
                config
                    .redis_cluster_nodes
                    .first()
                    .map(|node| format!("redis://{}", node))
            })
            .unwrap_or_else(|| "redis://localhost:6379".to_string());
        let redis = RedisClient::open(redis_url)?;
        Ok(Self {
            config,
            pool,
            http: HttpClient::new(),
            s3,
            redis,
            request_stats: Arc::new(RwLock::new(RequestStats {
                start_time: chrono::Utc::now().timestamp_millis(),
                ..RequestStats::default()
            })),
        })
    }
}
