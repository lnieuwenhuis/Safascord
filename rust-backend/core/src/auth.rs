use std::sync::Once;

use anyhow::{anyhow, Result};
use chrono::{Duration, Utc};
use http::HeaderMap;
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

static JWT_CRYPTO_PROVIDER: Once = Once::new();

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthClaims {
    pub sub: String,
    pub username: String,
    pub exp: usize,
}

pub fn ensure_jwt_crypto_provider() {
    JWT_CRYPTO_PROVIDER.call_once(|| {
        let _ = jsonwebtoken::crypto::rust_crypto::DEFAULT_PROVIDER.install_default();
    });
}

pub fn sign_token(jwt_secret: &str, user_id: &str, username: &str) -> Result<String> {
    ensure_jwt_crypto_provider();
    let claims = AuthClaims {
        sub: user_id.to_string(),
        username: username.to_string(),
        exp: (Utc::now() + Duration::days(7)).timestamp() as usize,
    };
    Ok(encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(jwt_secret.as_bytes()),
    )?)
}

pub fn verify_token(jwt_secret: &str, token: &str) -> Result<AuthClaims> {
    ensure_jwt_crypto_provider();
    let data = decode::<AuthClaims>(
        token,
        &DecodingKey::from_secret(jwt_secret.as_bytes()),
        &Validation::new(Algorithm::HS256),
    )?;
    Ok(data.claims)
}

pub fn authorize_header(headers: &HeaderMap, jwt_secret: &str) -> Result<AuthClaims> {
    let auth = headers
        .get(http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| anyhow!("Unauthorized"))?;
    let token = auth.trim().trim_start_matches("Bearer").trim();
    if token.is_empty() {
        return Err(anyhow!("Unauthorized"));
    }
    verify_token(jwt_secret, token)
}
