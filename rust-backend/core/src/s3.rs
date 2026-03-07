use std::env;

use anyhow::Result;
use aws_config::BehaviorVersion;
use aws_sdk_s3::config::{Credentials, Region};
use aws_sdk_s3::Client;

#[derive(Clone, Debug)]
pub struct S3Settings {
    pub endpoint: String,
    pub region: String,
    pub access_key: String,
    pub secret_key: String,
    pub bucket_name: String,
    pub public_url: String,
    pub force_path_style: bool,
    pub auto_init: bool,
    pub set_public_policy: bool,
    pub set_lifecycle: bool,
    pub public_base_url: Option<String>,
    pub proxy_uploads: bool,
    pub api_url: Option<String>,
}

impl S3Settings {
    pub fn from_env() -> Result<Self> {
        Ok(Self {
            endpoint: read_env(&[
                "S3_ENDPOINT",
                "AWS_ENDPOINT_URL_S3",
                "ENDPOINT_URL",
                "RAILWAY_BUCKET_ENDPOINT",
                "BUCKET_ENDPOINT",
                "BUCKET_ENDPOINT_URL",
            ])
            .unwrap_or_else(|| "http://minio:9000".to_string()),
            region: read_env(&[
                "S3_REGION",
                "AWS_REGION",
                "AWS_DEFAULT_REGION",
                "REGION",
                "BUCKET_REGION",
                "RAILWAY_BUCKET_REGION",
            ])
            .unwrap_or_else(|| "auto".to_string()),
            access_key: read_env(&[
                "S3_ACCESS_KEY",
                "S3_ACCESS_KEY_ID",
                "AWS_ACCESS_KEY_ID",
                "ACCESS_KEY_ID",
                "BUCKET_ACCESS_KEY",
                "BUCKET_ACCESS_KEY_ID",
                "RAILWAY_BUCKET_ACCESS_KEY",
                "RAILWAY_BUCKET_ACCESS_KEY_ID",
            ])
            .unwrap_or_else(|| "admin".to_string()),
            secret_key: read_env(&[
                "S3_SECRET_KEY",
                "S3_SECRET_ACCESS_KEY",
                "AWS_SECRET_ACCESS_KEY",
                "SECRET_ACCESS_KEY",
                "BUCKET_SECRET_KEY",
                "BUCKET_SECRET_ACCESS_KEY",
                "RAILWAY_BUCKET_SECRET_KEY",
                "RAILWAY_BUCKET_SECRET_ACCESS_KEY",
            ])
            .unwrap_or_else(|| "password".to_string()),
            bucket_name: read_env(&[
                "S3_BUCKET_NAME",
                "BUCKET_NAME",
                "AWS_S3_BUCKET",
                "RAILWAY_BUCKET_NAME",
            ])
            .unwrap_or_else(|| "uploads".to_string()),
            public_url: read_env(&["S3_PUBLIC_URL", "S3_PUBLIC_BASE_URL"])
                .unwrap_or_else(|| "http://localhost:9000".to_string()),
            force_path_style: read_env(&["S3_FORCE_PATH_STYLE"])
                .map(|raw| raw.eq_ignore_ascii_case("true"))
                .unwrap_or(false),
            auto_init: read_env(&["S3_AUTO_INIT"])
                .map(|raw| raw.eq_ignore_ascii_case("true"))
                .unwrap_or(false),
            set_public_policy: read_env(&["S3_SET_PUBLIC_POLICY"])
                .map(|raw| raw != "false")
                .unwrap_or(true),
            set_lifecycle: read_env(&["S3_SET_LIFECYCLE"])
                .map(|raw| raw != "false")
                .unwrap_or(true),
            public_base_url: read_env(&["S3_PUBLIC_BASE_URL"]),
            proxy_uploads: read_env(&["PROXY_UPLOADS"])
                .map(|raw| raw.eq_ignore_ascii_case("true"))
                .unwrap_or(false),
            api_url: read_env(&["API_URL"]),
        })
    }

    pub fn upload_base_url(&self) -> String {
        if self.proxy_uploads {
            let api_url = self.api_url.clone().unwrap_or_default();
            let normalized = api_url
                .trim_end_matches("/api")
                .trim_end_matches('/')
                .to_string();
            format!("{}/api/uploads", normalized)
        } else {
            self.public_base_url
                .clone()
                .unwrap_or_else(|| {
                    format!(
                        "{}/{}",
                        self.public_url.trim_end_matches('/'),
                        self.bucket_name
                    )
                })
                .trim_end_matches('/')
                .to_string()
        }
    }
}

pub fn read_env(keys: &[&str]) -> Option<String> {
    for key in keys {
        let Ok(raw) = env::var(key) else {
            continue;
        };
        let trimmed = raw.trim().trim_matches('"').trim_matches('\'');
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    None
}

pub async fn build_s3_client(settings: &S3Settings) -> Result<Client> {
    let config = aws_config::defaults(BehaviorVersion::latest())
        .credentials_provider(Credentials::new(
            settings.access_key.clone(),
            settings.secret_key.clone(),
            None,
            None,
            "safascord-rust",
        ))
        .endpoint_url(settings.endpoint.clone())
        .region(Region::new(settings.region.clone()))
        .load()
        .await;
    let conf = aws_sdk_s3::config::Builder::from(&config)
        .force_path_style(settings.force_path_style)
        .build();
    Ok(Client::from_conf(conf))
}
