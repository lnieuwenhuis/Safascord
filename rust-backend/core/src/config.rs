use std::env;

use anyhow::{anyhow, Context, Result};

use crate::s3::S3Settings;

#[derive(Clone, Debug)]
pub struct AppConfig {
    pub port: u16,
    pub database_url: String,
    pub database_ssl: bool,
    pub redis_url: Option<String>,
    pub redis_cluster_nodes: Vec<String>,
    pub jwt_secret: String,
    pub cors_origins: Vec<String>,
    pub realtime_base_http: String,
    pub realtime_base_ws: String,
    pub ws_allowed_origins: Vec<String>,
    pub enable_debug_routes: bool,
    pub shoo_base_url: String,
    pub shoo_issuer: String,
    pub shoo_jwks_url: String,
    pub shoo_allowed_origins: Vec<String>,
    pub shoo_client_id: Option<String>,
    pub s3: S3Settings,
}

impl AppConfig {
    pub fn from_env(default_port: u16) -> Result<Self> {
        Self::from_env_with_database(default_port, Some("DATABASE_URL is required"))
    }

    pub fn from_env_without_database(default_port: u16) -> Result<Self> {
        Self::from_env_with_database(default_port, None)
    }

    fn from_env_with_database(default_port: u16, database_required: Option<&str>) -> Result<Self> {
        let database_url = match database_required {
            Some(message) => env::var("DATABASE_URL").with_context(|| message.to_string())?,
            None => env::var("DATABASE_URL").unwrap_or_default(),
        };
        let jwt_secret = env::var("JWT_SECRET").unwrap_or_else(|_| "dev_change_me".to_string());
        let port = env::var("PORT")
            .ok()
            .and_then(|raw| raw.parse::<u16>().ok())
            .unwrap_or(default_port);
        let cors_origins = split_env("CORS_ORIGINS");
        let ws_allowed_origins = split_env("WS_ALLOWED_ORIGINS");
        let shoo_base_url = normalize_url(
            env::var("SHOO_BASE_URL").unwrap_or_else(|_| "https://shoo.dev".to_string()),
            "https://shoo.dev",
        );
        let shoo_issuer = normalize_url(
            env::var("SHOO_ISSUER").unwrap_or_else(|_| shoo_base_url.clone()),
            &shoo_base_url,
        );
        let shoo_jwks_url = normalize_url(
            env::var("SHOO_JWKS_URL")
                .unwrap_or_else(|_| format!("{}/.well-known/jwks.json", shoo_base_url)),
            &format!("{}/.well-known/jwks.json", shoo_base_url),
        );

        Ok(Self {
            port,
            database_url,
            database_ssl: parse_bool(env::var("DATABASE_SSL").ok().as_deref(), false),
            redis_url: env::var("REDIS_URL")
                .ok()
                .filter(|raw| !raw.trim().is_empty()),
            redis_cluster_nodes: split_env("REDIS_CLUSTER_NODES"),
            jwt_secret,
            cors_origins,
            realtime_base_http: env::var("REALTIME_BASE_HTTP")
                .unwrap_or_else(|_| "http://localhost:4001".to_string()),
            realtime_base_ws: env::var("REALTIME_BASE_WS")
                .unwrap_or_else(|_| "ws://localhost:4001/ws".to_string()),
            ws_allowed_origins,
            enable_debug_routes: parse_bool(env::var("ENABLE_DEBUG_ROUTES").ok().as_deref(), false),
            shoo_base_url,
            shoo_issuer,
            shoo_jwks_url,
            shoo_allowed_origins: split_env_any(&[
                "SHOO_ALLOWED_ORIGINS",
                "APP_ORIGIN",
                "CORS_ORIGINS",
            ]),
            shoo_client_id: env::var("SHOO_CLIENT_ID")
                .ok()
                .filter(|raw| !raw.trim().is_empty()),
            s3: S3Settings::from_env()?,
        })
    }

    pub fn validate_redis(&self) -> Result<()> {
        if self.redis_url.is_none() && self.redis_cluster_nodes.is_empty() {
            return Err(anyhow!(
                "Either REDIS_URL or REDIS_CLUSTER_NODES must be set"
            ));
        }
        Ok(())
    }
}

pub fn parse_bool(value: Option<&str>, default_value: bool) -> bool {
    value
        .map(|raw| raw.eq_ignore_ascii_case("true"))
        .unwrap_or(default_value)
}

pub fn split_env(name: &str) -> Vec<String> {
    env::var(name)
        .unwrap_or_default()
        .split(',')
        .map(|raw| raw.trim().to_string())
        .filter(|raw| !raw.is_empty())
        .collect()
}

pub fn split_env_any(names: &[&str]) -> Vec<String> {
    for name in names {
        let values = split_env(name);
        if !values.is_empty() {
            return values;
        }
    }
    Vec::new()
}

pub fn normalize_url(value: String, fallback: &str) -> String {
    let mut url = if value.trim().is_empty() {
        fallback.to_string()
    } else {
        value.trim().trim_end_matches('/').to_string()
    };
    if url.starts_with("https://api.shoo.dev") {
        url = url.replace("https://api.shoo.dev", "https://shoo.dev");
    }
    url
}
