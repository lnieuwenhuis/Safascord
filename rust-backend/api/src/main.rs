use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use anyhow::{anyhow, Context, Result};
use aws_sdk_s3::{
    operation::create_bucket::CreateBucketOutput, operation::head_bucket::HeadBucketOutput,
};
use axum::extract::{DefaultBodyLimit, Multipart, Path as AxumPath, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, patch, post};
use axum::{Json, Router};
use bcrypt::{hash, verify};
use chrono::{Duration, Utc};
use rand::Rng;
use regex::Regex;
use safascord_core::auth::{authorize_header, sign_token, AuthClaims};
use safascord_core::config::AppConfig;
use safascord_core::util::{random_string, to_safe_username};
use safascord_core::{AppState, SharedState};
use serde::Deserialize;
use serde_json::{json, Value};
use jsonwebtoken::jwk::Jwk;
use sqlx::{postgres::PgRow, PgPool, Row};
use tokio::fs;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing::info;
use uuid::Uuid;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "safascord_api=info,tower_http=info".into()),
        )
        .init();

    let config = AppConfig::from_env(4000)?;
    let state = Arc::new(AppState::from_config(config.clone()).await?);
    run_migrations(&state.pool).await?;
    ensure_storage_bucket(&state).await?;
    start_metrics_collector(state.clone());

    let mut cors = CorsLayer::new().allow_methods(Any).allow_headers(Any);
    if config.cors_origins.is_empty() {
        cors = cors.allow_origin(Any);
    } else {
        let headers = config
            .cors_origins
            .iter()
            .filter_map(|origin| HeaderValue::from_str(origin).ok())
            .collect::<Vec<_>>();
        cors = cors.allow_origin(headers);
    }

    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/ready", get(ready))
        .route("/api/debug/s3", get(debug_s3))
        .route("/api/debug/db", get(debug_db))
        .route("/api/debug/migrate", post(debug_migrate))
        .route("/api/debug/seed-data", delete(debug_seed_data))
        .route("/api/auth/register", post(auth_register))
        .route("/api/auth/login", post(auth_login))
        .route("/api/auth/shoo", post(auth_shoo))
        .route("/api/me", get(get_me))
        .route("/api/me/profile", patch(update_profile))
        .route("/api/me/display-name", patch(update_display_name))
        .route("/api/users", get(list_users))
        .route("/api/users/{id}/profile", get(get_user_profile))
        .route("/api/friends", get(get_friends))
        .route("/api/friends/requests", get(get_friend_requests))
        .route("/api/friends/request", post(send_friend_request))
        .route(
            "/api/friends/requests/{id}/{action}",
            post(respond_friend_request),
        )
        .route("/api/friends/{friendId}", delete(remove_friend))
        .route("/api/dms", get(list_dms).post(create_dm))
        .route("/api/channels", get(list_channels).post(create_channel))
        .route(
            "/api/channels/{id}",
            patch(update_channel).delete(delete_channel),
        )
        .route(
            "/api/channels/{id}/permissions",
            get(get_channel_permissions),
        )
        .route("/api/channel-by-name", get(channel_by_name))
        .route("/api/categories", post(create_category))
        .route(
            "/api/categories/{id}",
            patch(update_category).delete(delete_category),
        )
        .route("/api/servers", get(list_servers).post(create_server))
        .route(
            "/api/servers/{id}",
            patch(update_server).delete(delete_server),
        )
        .route("/api/servers/{id}/members/me", delete(leave_server))
        .route("/api/servers/{id}/invites", post(create_invite))
        .route("/api/invites/{code}", get(invite_info))
        .route("/api/invites/{code}/accept", post(accept_invite))
        .route("/api/servers/{id}/members", get(get_server_members))
        .route(
            "/api/servers/{id}/members/{userId}",
            delete(delete_member).patch(update_member_legacy),
        )
        .route("/api/servers/{id}/members/{userId}/mute", post(mute_member))
        .route("/api/servers/{id}/bans", post(create_ban))
        .route(
            "/api/servers/{serverId}/members/{userId}/roles",
            patch(update_member_roles),
        )
        .route(
            "/api/servers/{serverId}/members/{userId}/kick",
            post(kick_member),
        )
        .route(
            "/api/servers/{serverId}/members/{userId}/ban",
            post(ban_member),
        )
        .route("/api/servers/{id}/roles", get(get_roles).post(create_role))
        .route(
            "/api/servers/{id}/roles/{roleId}",
            patch(update_role).delete(delete_role),
        )
        .route("/api/servers/{id}/members/{userId}", get(get_member))
        .route("/api/messages", get(get_messages).post(create_message))
        .route("/api/socket-info", get(socket_info))
        .route(
            "/api/messages/{id}",
            delete(delete_message).patch(edit_message),
        )
        .route("/api/upload", post(upload_file))
        .route("/api/uploads/{key}", get(get_upload))
        .route("/api/notifications", get(get_notifications))
        .route("/api/notifications/{id}/read", post(mark_notification_read))
        .route(
            "/api/notifications/channel/{channelId}/read",
            post(mark_channel_notifications_read),
        )
        .route(
            "/api/notifications/read-all",
            post(mark_all_notifications_read),
        )
        .route("/api/notifications/{id}", delete(delete_notification))
        .route("/api/stats/summary", get(stats_summary))
        .route("/api/stats/activity", get(stats_activity))
        .route("/api/stats/system", get(stats_system))
        .route("/api/stats/metrics", get(stats_metrics))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            request_timing,
        ))
        .layer(DefaultBodyLimit::max(50 * 1024 * 1024))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], config.port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    info!("api listening on {}", addr);
    axum::serve(listener, app).await?;
    Ok(())
}

async fn request_timing(
    State(state): State<SharedState>,
    request: axum::extract::Request,
    next: Next,
) -> Response {
    let started = Instant::now();
    let response = next.run(request).await;
    let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;
    let mut stats = state.request_stats.write().await;
    stats.total_requests += 1;
    stats.total_latency += elapsed_ms;
    stats.period_requests += 1;
    stats.period_latency += elapsed_ms;
    if elapsed_ms > stats.max_latency {
        stats.max_latency = elapsed_ms;
    }
    response
}

async fn run_migrations(pool: &PgPool) -> Result<()> {
    let runtime_dir = Path::new("/app/migrations");
    let source_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../migrations");
    let migration_dir = if fs::try_exists(runtime_dir).await? {
        runtime_dir.to_path_buf()
    } else {
        source_dir
    };
    let mut files = fs::read_dir(&migration_dir).await?;
    let mut paths = Vec::new();
    while let Some(entry) = files.next_entry().await? {
        paths.push(entry.path());
    }
    paths.sort();
    for path in paths {
        if path.extension().and_then(|ext| ext.to_str()) != Some("sql") {
            continue;
        }
        let sql = fs::read_to_string(&path).await?;
        sqlx::raw_sql(&sql).execute(pool).await.with_context(|| {
            format!(
                "failed to run migration {}",
                path.file_name().unwrap().to_string_lossy()
            )
        })?;
    }
    Ok(())
}

async fn ensure_storage_bucket(state: &SharedState) -> Result<()> {
    if !state.config.s3.auto_init {
        return Ok(());
    }
    let _ = state
        .s3
        .head_bucket()
        .bucket(state.config.s3.bucket_name.clone())
        .send()
        .await;
    let head = state
        .s3
        .head_bucket()
        .bucket(state.config.s3.bucket_name.clone())
        .send()
        .await;
    if head.is_err() {
        let _res: CreateBucketOutput = state
            .s3
            .create_bucket()
            .bucket(state.config.s3.bucket_name.clone())
            .send()
            .await?;
    }
    let _res: HeadBucketOutput = state
        .s3
        .head_bucket()
        .bucket(state.config.s3.bucket_name.clone())
        .send()
        .await?;
    Ok(())
}

fn start_metrics_collector(state: SharedState) {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(10)).await;
            let stats_snapshot = state.request_stats.read().await.clone();
            let avg_latency = if stats_snapshot.period_requests > 0 {
                stats_snapshot.period_latency / stats_snapshot.period_requests as f64
            } else {
                0.0
            };
            let memory_mb = 0.0;
            let cpu_load = 0.0;
            let disk_used = 0.0;
            let _ = sqlx::query(
                "INSERT INTO system_metrics (cpu_load, memory_used, disk_used, avg_latency) VALUES ($1, $2, $3, $4)",
            )
            .bind(cpu_load)
            .bind(memory_mb)
            .bind(disk_used)
            .bind(avg_latency)
            .execute(&state.pool)
            .await;
            let mut stats = state.request_stats.write().await;
            stats.period_requests = 0;
            stats.period_latency = 0.0;
        }
    });
}

fn ok(body: Value) -> Json<Value> {
    Json(body)
}

fn error_body(message: &str) -> Json<Value> {
    Json(json!({ "error": message }))
}

fn reason_body(message: &str, reason: &str) -> Json<Value> {
    Json(json!({ "error": message, "reason": reason }))
}

fn auth_claims(headers: &HeaderMap, state: &SharedState) -> Result<AuthClaims> {
    authorize_header(headers, &state.config.jwt_secret)
}

async fn check_permission(
    pool: &PgPool,
    user_id: &str,
    server_id: &str,
    perm: &str,
) -> Result<bool> {
    let row = sqlx::query(
        r#"
        SELECT (s.owner_id = $1::uuid) AS is_owner,
               COALESCE(bool_or(r.can_manage_channels), FALSE) AS can_manage_channels,
               COALESCE(bool_or(r.can_manage_server), FALSE) AS can_manage_server,
               COALESCE(bool_or(r.can_manage_roles), FALSE) AS can_manage_roles
        FROM servers s
        LEFT JOIN server_member_roles smr
          ON smr.server_id = s.id
         AND smr.user_id = $1::uuid
        LEFT JOIN roles r
          ON r.id = smr.role_id
        WHERE s.id = $2::uuid
        GROUP BY s.owner_id
        "#,
    )
    .bind(user_id)
    .bind(server_id)
    .fetch_optional(pool)
    .await?;
    let Some(row) = row else {
        return Ok(false);
    };
    let is_owner: bool = row.try_get("is_owner").unwrap_or(false);
    if is_owner {
        return Ok(true);
    }
    Ok(match perm {
        "can_manage_channels" => row.try_get("can_manage_channels").unwrap_or(false),
        "can_manage_server" => row.try_get("can_manage_server").unwrap_or(false),
        "can_manage_roles" => row.try_get("can_manage_roles").unwrap_or(false),
        _ => false,
    })
}

async fn find_user_by_username_or_email(pool: &PgPool, identifier: &str) -> Result<Option<PgRow>> {
    let mut username = identifier.to_string();
    let mut discriminator: Option<String> = None;
    if let Some((name, tag)) = identifier.split_once('#') {
        username = name.to_string();
        discriminator = Some(tag.to_string());
    }
    let row = sqlx::query(
        r#"
        SELECT id::text AS id, username, email, display_name, password_hash, discriminator
        FROM users
        WHERE (username = $1 AND ($2::text IS NULL OR discriminator = $2::text)) OR email = $3
        LIMIT 1
        "#,
    )
    .bind(username)
    .bind(discriminator)
    .bind(identifier)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

async fn next_discriminator(pool: &PgPool, username: &str) -> Result<String> {
    for _ in 0..30 {
        let discrim = format!("{:04}", rand::thread_rng().gen_range(0..10000));
        let exists = sqlx::query("SELECT 1 FROM users WHERE username=$1 AND discriminator=$2")
            .bind(username)
            .bind(&discrim)
            .fetch_optional(pool)
            .await?;
        if exists.is_none() {
            return Ok(discrim);
        }
    }
    Ok(format!("{:04}", rand::thread_rng().gen_range(0..10000)))
}

async fn ensure_unique_username(pool: &PgPool, base: &str) -> Result<String> {
    let username = to_safe_username(base);
    for i in 0..50 {
        let candidate = if i == 0 {
            username.clone()
        } else {
            format!("{}_{}", username, random_string(4).to_lowercase())
        };
        let exists = sqlx::query("SELECT 1 FROM users WHERE username=$1 LIMIT 1")
            .bind(&candidate)
            .fetch_optional(pool)
            .await?;
        if exists.is_none() {
            return Ok(candidate);
        }
    }
    Ok(format!("user_{}", random_string(8).to_lowercase()))
}

async fn ensure_default_server_membership(pool: &PgPool, user_id: &str) -> Result<()> {
    let server =
        sqlx::query("SELECT id::text AS id FROM servers WHERE name='FST [est. 2025]' LIMIT 1")
            .fetch_optional(pool)
            .await?;
    let Some(server) = server else {
        return Ok(());
    };
    let server_id: String = server.try_get("id")?;
    let role = sqlx::query(
        "SELECT id::text AS id FROM roles WHERE server_id=$1::uuid AND name='Member' LIMIT 1",
    )
    .bind(&server_id)
    .fetch_optional(pool)
    .await?;
    let role_id = role.and_then(|row| row.try_get::<String, _>("id").ok());
    sqlx::query(
        "INSERT INTO server_members (server_id, user_id, role_id) VALUES ($1::uuid,$2::uuid,$3::uuid) ON CONFLICT DO NOTHING",
    )
    .bind(&server_id)
    .bind(user_id)
    .bind(role_id.clone())
    .execute(pool)
    .await?;
    if let Some(role_id) = role_id {
        sqlx::query(
            "INSERT INTO server_member_roles (server_id, user_id, role_id) VALUES ($1::uuid,$2::uuid,$3::uuid) ON CONFLICT DO NOTHING",
        )
        .bind(&server_id)
        .bind(user_id)
        .bind(role_id)
        .execute(pool)
        .await?;
    }
    Ok(())
}

#[derive(Deserialize)]
struct RegisterBody {
    username: Option<String>,
    email: Option<String>,
    password: Option<String>,
    #[serde(rename = "displayName")]
    display_name: Option<String>,
}

async fn auth_register(
    State(state): State<SharedState>,
    Json(body): Json<RegisterBody>,
) -> Json<Value> {
    let (Some(username), Some(email), Some(password)) = (body.username, body.email, body.password)
    else {
        return error_body("Missing fields");
    };
    let discrim = match next_discriminator(&state.pool, &username).await {
        Ok(discrim) => discrim,
        Err(err) => return reason_body("Registration failed", &err.to_string()),
    };
    let exists = sqlx::query(
        "SELECT 1 FROM users WHERE (username=$1 AND discriminator=$2) OR email=$3 LIMIT 1",
    )
    .bind(&username)
    .bind(&discrim)
    .bind(&email)
    .fetch_optional(&state.pool)
    .await;
    if matches!(exists, Ok(Some(_))) {
        return error_body("Username+Tag or email already in use");
    }
    let Ok(hash_value) = hash(password, 10) else {
        return error_body("Registration failed");
    };
    let inserted = sqlx::query(
        "INSERT INTO users (username, email, password_hash, display_name, discriminator) VALUES ($1,$2,$3,$4,$5) RETURNING id::text AS id, username, email, display_name",
    )
    .bind(&username)
    .bind(&email)
    .bind(hash_value)
    .bind(body.display_name.unwrap_or_else(|| username.clone()))
    .bind(&discrim)
    .fetch_one(&state.pool)
    .await;
    let Ok(row) = inserted else {
        return error_body("Registration failed");
    };
    let user_id: String = row.try_get("id").unwrap_or_default();
    let username: String = row.try_get("username").unwrap_or_default();
    let email: Option<String> = row.try_get("email").ok();
    let display_name: Option<String> = row.try_get("display_name").ok();
    let _ = ensure_default_server_membership(&state.pool, &user_id).await;
    let token = match sign_token(&state.config.jwt_secret, &user_id, &username) {
        Ok(token) => token,
        Err(err) => return reason_body("Registration failed", &err.to_string()),
    };
    ok(json!({
        "token": token,
        "user": {
            "id": user_id,
            "username": username,
            "email": email,
            "displayName": display_name
        }
    }))
}

#[derive(Deserialize)]
struct LoginBody {
    identifier: Option<String>,
    password: Option<String>,
}

async fn auth_login(State(state): State<SharedState>, Json(body): Json<LoginBody>) -> Json<Value> {
    let (Some(identifier), Some(password)) = (body.identifier, body.password) else {
        return error_body("Missing fields");
    };
    let row = match find_user_by_username_or_email(&state.pool, &identifier).await {
        Ok(Some(row)) => row,
        _ => return error_body("Invalid credentials"),
    };
    let password_hash: Option<String> = row.try_get("password_hash").ok();
    let ok_password = password_hash
        .as_deref()
        .map(|hash_value| verify(password, hash_value).unwrap_or(false))
        .unwrap_or(false);
    if !ok_password {
        return error_body("Invalid credentials");
    }
    let user_id: String = row.try_get("id").unwrap_or_default();
    let username: String = row.try_get("username").unwrap_or_default();
    let email: Option<String> = row.try_get("email").ok();
    let display_name: Option<String> = row.try_get("display_name").ok();
    let _ = ensure_default_server_membership(&state.pool, &user_id).await;
    let token = match sign_token(&state.config.jwt_secret, &user_id, &username) {
        Ok(token) => token,
        Err(err) => return reason_body("Invalid credentials", &err.to_string()),
    };
    ok(json!({
        "token": token,
        "user": {
            "id": user_id,
            "username": username,
            "email": email,
            "displayName": display_name
        }
    }))
}

#[derive(Deserialize)]
struct ShooBody {
    #[serde(rename = "idToken")]
    id_token: Option<String>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct ShooClaims {
    pairwise_sub: Option<String>,
    email: Option<String>,
    name: Option<String>,
    given_name: Option<String>,
    family_name: Option<String>,
    preferred_username: Option<String>,
    picture: Option<String>,
    iss: Option<String>,
    aud: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct Jwks {
    keys: Vec<Jwk>,
}

async fn auth_shoo(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(body): Json<ShooBody>,
) -> Json<Value> {
    let Some(id_token) = body.id_token else {
        return error_body("Missing idToken");
    };
    let origin_hint = headers
        .get("origin")
        .and_then(|value| value.to_str().ok())
        .map(|v| v.to_string());
    let claims = match verify_shoo_id_token(&state, &id_token, origin_hint.as_deref()).await {
        Ok(claims) => claims,
        Err(err) => return reason_body("Authentication failed", &err.to_string()),
    };
    let (user_id, username, email, display_name, avatar_url, is_new) =
        match find_or_create_shoo_user(&state, claims).await {
            Ok(user) => user,
            Err(err) => return reason_body("Authentication failed", &err.to_string()),
        };
    let token = match sign_token(&state.config.jwt_secret, &user_id, &username) {
        Ok(token) => token,
        Err(err) => return reason_body("Authentication failed", &err.to_string()),
    };
    ok(json!({
        "token": token,
        "user": {
            "id": user_id,
            "username": username,
            "email": email,
            "displayName": display_name,
            "avatarUrl": avatar_url
        },
        "isNew": is_new
    }))
}

async fn verify_shoo_id_token(
    state: &SharedState,
    id_token: &str,
    origin_hint: Option<&str>,
) -> Result<ShooClaims> {
    let header = jsonwebtoken::decode_header(id_token)?;
    let kid = header.kid.ok_or_else(|| anyhow!("Missing kid"))?;
    let jwks = state
        .http
        .get(state.config.shoo_jwks_url.clone())
        .send()
        .await?
        .json::<Jwks>()
        .await?;
    let jwk = jwks
        .keys
        .into_iter()
        .find(|key| key.common.key_id.as_deref() == Some(kid.as_str()))
        .ok_or_else(|| anyhow!("No matching Shoo JWK"))?;
    let key = jsonwebtoken::DecodingKey::from_jwk(&jwk)?;
    let mut validation = jsonwebtoken::Validation::new(header.alg);
    let audiences = shoo_audiences(&state.config, origin_hint);
    validation.set_audience(&audiences);
    validation.set_issuer(&[
        state.config.shoo_issuer.clone(),
        state.config.shoo_base_url.clone(),
        "https://shoo.dev".to_string(),
    ]);
    let token_data = jsonwebtoken::decode::<ShooClaims>(id_token, &key, &validation)?;
    Ok(token_data.claims)
}

fn shoo_audiences(config: &AppConfig, origin_hint: Option<&str>) -> Vec<String> {
    let mut candidates = HashSet::new();
    for origin in &config.shoo_allowed_origins {
        candidates.insert(origin.trim_end_matches('/').to_string());
    }
    if let Some(origin_hint) = origin_hint {
        candidates.insert(origin_hint.trim_end_matches('/').to_string());
    }
    candidates.insert("http://localhost".to_string());
    candidates.insert("http://localhost:5173".to_string());
    candidates.insert("http://127.0.0.1:5173".to_string());
    if let Some(client_id) = &config.shoo_client_id {
        candidates.insert(client_id.clone());
    }
    let mut audiences = HashSet::new();
    for origin in candidates {
        if origin.starts_with("origin:") {
            audiences.insert(origin.clone());
        } else {
            audiences.insert(format!("origin:{}", origin));
            audiences.insert(origin.clone());
        }
    }
    audiences.into_iter().collect()
}

async fn find_or_create_shoo_user(
    state: &SharedState,
    claims: ShooClaims,
) -> Result<(String, String, Option<String>, String, Option<String>, bool)> {
    let pairwise_sub = claims
        .pairwise_sub
        .clone()
        .ok_or_else(|| anyhow!("Missing pairwise_sub in Shoo token"))?;
    let email = claims.email.clone();
    let display_name = claims
        .name
        .clone()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            let combined = format!(
                "{} {}",
                claims.given_name.clone().unwrap_or_default(),
                claims.family_name.clone().unwrap_or_default()
            );
            let trimmed = combined.trim().to_string();
            (!trimmed.is_empty()).then_some(trimmed)
        })
        .or(claims.preferred_username.clone())
        .or_else(|| {
            email
                .as_ref()
                .and_then(|value| value.split('@').next().map(|s| s.to_string()))
        })
        .unwrap_or_else(|| {
            format!(
                "Shoo User {}",
                &pairwise_sub[pairwise_sub.len().saturating_sub(6)..]
            )
        });
    let avatar_url = claims.picture.clone();

    let mut existing = sqlx::query(
        "SELECT id::text AS id, username, email, display_name, avatar_url FROM users WHERE shoo_sub=$1 LIMIT 1",
    )
    .bind(&pairwise_sub)
    .fetch_optional(&state.pool)
    .await?;

    if existing.is_none() {
        if let Some(email_value) = &email {
            let by_email = sqlx::query(
                "SELECT id::text AS id, username, email, display_name, avatar_url FROM users WHERE email=$1 LIMIT 1",
            )
            .bind(email_value)
            .fetch_optional(&state.pool)
            .await?;
            if let Some(row) = by_email {
                let user_id: String = row.try_get("id")?;
                sqlx::query("UPDATE users SET shoo_sub=$1 WHERE id=$2::uuid")
                    .bind(&pairwise_sub)
                    .bind(&user_id)
                    .execute(&state.pool)
                    .await?;
                existing = Some(row);
            }
        }
    }

    if let Some(row) = existing {
        let user_id: String = row.try_get("id")?;
        let username: String = row.try_get("username")?;
        let email: Option<String> = row.try_get("email").ok();
        let existing_display_name: Option<String> = row.try_get("display_name").ok();
        let existing_avatar: Option<String> = row.try_get("avatar_url").ok();
        if existing_display_name.is_none() || (existing_avatar.is_none() && avatar_url.is_some()) {
            sqlx::query(
                "UPDATE users SET display_name = COALESCE(display_name, $1), avatar_url = COALESCE(avatar_url, $2) WHERE id=$3::uuid",
            )
            .bind(&display_name)
            .bind(&avatar_url)
            .bind(&user_id)
            .execute(&state.pool)
            .await?;
        }
        return Ok((
            user_id,
            username,
            email,
            existing_display_name.unwrap_or(display_name),
            existing_avatar.or(avatar_url),
            false,
        ));
    }

    let base_username = claims
        .preferred_username
        .clone()
        .or_else(|| {
            email
                .as_ref()
                .and_then(|value| value.split('@').next().map(|v| v.to_string()))
        })
        .unwrap_or_else(|| {
            format!(
                "shoo_{}",
                &pairwise_sub[pairwise_sub.len().saturating_sub(8)..]
            )
        });
    let username = ensure_unique_username(&state.pool, &base_username).await?;
    let discriminator = next_discriminator(&state.pool, &username).await?;
    let row = sqlx::query(
        "INSERT INTO users (username, email, password_hash, display_name, avatar_url, discriminator, shoo_sub) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id::text AS id, username, email, display_name, avatar_url",
    )
    .bind(&username)
    .bind(&email)
    .bind("shoo_auth")
    .bind(&display_name)
    .bind(&avatar_url)
    .bind(discriminator)
    .bind(&pairwise_sub)
    .fetch_one(&state.pool)
    .await?;
    let user_id: String = row.try_get("id")?;
    let _ = ensure_default_server_membership(&state.pool, &user_id).await;
    Ok((
        user_id,
        row.try_get("username")?,
        row.try_get("email").ok(),
        row.try_get::<Option<String>, _>("display_name")?
            .unwrap_or(display_name),
        row.try_get("avatar_url").ok(),
        true,
    ))
}

async fn health() -> Json<Value> {
    ok(json!({
        "ok": true,
        "service": "api",
        "uptime": 0,
        "ts": Utc::now().to_rfc3339()
    }))
}

async fn ready(State(state): State<SharedState>) -> Response {
    let database = sqlx::query("SELECT 1").execute(&state.pool).await.is_ok();
    let redis = match state.redis.get_multiplexed_async_connection().await {
        Ok(mut conn) => redis::cmd("PING")
            .query_async::<String>(&mut conn)
            .await
            .is_ok(),
        Err(_) => false,
    };
    let storage = state
        .s3
        .head_bucket()
        .bucket(state.config.s3.bucket_name.clone())
        .send()
        .await
        .is_ok();
    let realtime = state
        .http
        .get(format!(
            "{}/health",
            state.config.realtime_base_http.trim_end_matches('/')
        ))
        .send()
        .await
        .map(|res| res.status().is_success())
        .unwrap_or(false);
    let ok_value = database && redis && storage && realtime;
    let body = Json(json!({
        "ok": ok_value,
        "checks": {
            "database": database,
            "redis": redis,
            "storage": storage,
            "realtime": realtime
        },
        "ts": Utc::now().to_rfc3339()
    }));
    if ok_value {
        body.into_response()
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, body).into_response()
    }
}

async fn debug_s3(State(state): State<SharedState>) -> Json<Value> {
    if !state.config.enable_debug_routes {
        return error_body("Not found");
    }
    let buckets = state.s3.list_buckets().send().await.ok();
    let objects = state
        .s3
        .list_objects_v2()
        .bucket(state.config.s3.bucket_name.clone())
        .send()
        .await
        .ok();
    ok(json!({
        "bucketName": state.config.s3.bucket_name,
        "buckets": buckets
            .and_then(|res| res.buckets)
            .unwrap_or_default()
            .into_iter()
            .map(|bucket| json!({
                "name": bucket.name,
                "creationDate": bucket.creation_date.map(|value| value.to_string())
            }))
            .collect::<Vec<_>>(),
        "objects": objects
            .and_then(|res| res.contents)
            .unwrap_or_default()
            .into_iter()
            .map(|object| json!({
                "key": object.key,
                "lastModified": object.last_modified.map(|value| value.to_string()),
                "size": object.size
            }))
            .collect::<Vec<_>>()
    }))
}

async fn debug_db(State(state): State<SharedState>) -> Json<Value> {
    if !state.config.enable_debug_routes {
        return error_body("Not found");
    }
    let tables =
        sqlx::query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")
            .fetch_all(&state.pool)
            .await
            .unwrap_or_default();
    ok(json!({
        "tables": tables.into_iter().map(|row| json!({ "table_name": row.try_get::<String,_>("table_name").unwrap_or_default() })).collect::<Vec<_>>()
    }))
}

async fn debug_migrate(State(state): State<SharedState>) -> Json<Value> {
    if !state.config.enable_debug_routes {
        return error_body("Not found");
    }
    match run_migrations(&state.pool).await {
        Ok(_) => ok(json!({ "ok": true })),
        Err(err) => reason_body("Migration failed", &err.to_string()),
    }
}

async fn debug_seed_data(State(state): State<SharedState>) -> Json<Value> {
    if !state.config.enable_debug_routes {
        return error_body("Not found");
    }
    let _ = sqlx::query("DELETE FROM friendships")
        .execute(&state.pool)
        .await;
    let _ = sqlx::query("DELETE FROM channels WHERE type='dm'")
        .execute(&state.pool)
        .await;
    ok(json!({ "ok": true }))
}

async fn get_me(State(state): State<SharedState>, headers: HeaderMap) -> Json<Value> {
    let claims = match auth_claims(&headers, &state) {
        Ok(claims) => claims,
        Err(_) => return error_body("Unauthorized"),
    };
    let row = sqlx::query(
        r#"
        SELECT id::text AS id, username, email, display_name, bio, banner_color, banner_url, avatar_url,
               custom_background_url, custom_background_opacity, status, discriminator,
               allow_dms_from_strangers AS "allowDmsFromStrangers",
               notifications_quiet_mode AS "notificationsQuietMode"
        FROM users WHERE id = $1::uuid
        "#,
    )
    .bind(&claims.sub)
    .fetch_optional(&state.pool)
    .await;
    let Ok(Some(row)) = row else {
        return error_body("Unauthorized");
    };
    ok(json!({ "user": row_to_user_me(&row) }))
}

fn row_to_user_me(row: &PgRow) -> Value {
    json!({
        "id": row.try_get::<String,_>("id").unwrap_or_default(),
        "username": row.try_get::<String,_>("username").unwrap_or_default(),
        "email": row.try_get::<Option<String>,_>("email").ok().flatten(),
        "displayName": row.try_get::<Option<String>,_>("display_name").ok().flatten(),
        "bio": row.try_get::<Option<String>,_>("bio").ok().flatten(),
        "bannerColor": row.try_get::<Option<String>,_>("banner_color").ok().flatten(),
        "bannerUrl": row.try_get::<Option<String>,_>("banner_url").ok().flatten(),
        "avatarUrl": row.try_get::<Option<String>,_>("avatar_url").ok().flatten(),
        "customBackgroundUrl": row.try_get::<Option<String>,_>("custom_background_url").ok().flatten(),
        "customBackgroundOpacity": row.try_get::<Option<f64>,_>("custom_background_opacity").ok().flatten(),
        "status": row.try_get::<Option<String>,_>("status").ok().flatten(),
        "discriminator": row.try_get::<Option<String>,_>("discriminator").ok().flatten(),
        "allowDmsFromStrangers": row.try_get::<Option<bool>,_>("allowDmsFromStrangers").ok().flatten(),
        "notificationsQuietMode": row.try_get::<Option<bool>,_>("notificationsQuietMode").ok().flatten()
    })
}

#[derive(Deserialize)]
struct UpdateProfileBody {
    bio: Option<Value>,
    #[serde(rename = "bannerColor")]
    banner_color: Option<Value>,
    #[serde(rename = "bannerUrl")]
    banner_url: Option<Value>,
    #[serde(rename = "avatarUrl")]
    avatar_url: Option<Value>,
    #[serde(rename = "customBackgroundUrl")]
    custom_background_url: Option<Value>,
    #[serde(rename = "customBackgroundOpacity")]
    custom_background_opacity: Option<Value>,
    status: Option<Value>,
    username: Option<Value>,
    #[serde(rename = "displayName")]
    display_name: Option<Value>,
    #[serde(rename = "notificationsQuietMode")]
    notifications_quiet_mode: Option<Value>,
}

async fn update_profile(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(body): Json<UpdateProfileBody>,
) -> Json<Value> {
    let claims = match auth_claims(&headers, &state) {
        Ok(claims) => claims,
        Err(_) => return error_body("Unauthorized"),
    };
    let mut fields = Vec::new();
    let mut binds: Vec<Value> = Vec::new();
    bind_optional_field(&mut fields, &mut binds, "bio", body.bio);
    bind_optional_field(&mut fields, &mut binds, "banner_color", body.banner_color);
    bind_optional_field(&mut fields, &mut binds, "banner_url", body.banner_url);
    bind_optional_field(&mut fields, &mut binds, "avatar_url", body.avatar_url);
    bind_optional_field(
        &mut fields,
        &mut binds,
        "custom_background_url",
        body.custom_background_url,
    );
    bind_optional_field(
        &mut fields,
        &mut binds,
        "custom_background_opacity",
        body.custom_background_opacity,
    );
    bind_optional_field(&mut fields, &mut binds, "status", body.status);
    bind_optional_field(&mut fields, &mut binds, "username", body.username);
    bind_optional_field(&mut fields, &mut binds, "display_name", body.display_name);
    bind_optional_field(
        &mut fields,
        &mut binds,
        "notifications_quiet_mode",
        body.notifications_quiet_mode,
    );
    if fields.is_empty() {
        return error_body("No fields");
    }
    let sql = format!(
        "UPDATE users SET {} WHERE id = ${}::uuid RETURNING id::text AS id, username, email, display_name, bio, banner_color, banner_url, avatar_url, custom_background_url, custom_background_opacity, status, notifications_quiet_mode AS \"notificationsQuietMode\"",
        fields.join(", "),
        binds.len() + 1
    );
    let mut query = sqlx::query(&sql);
    for value in binds {
        query = bind_json_value(query, value);
    }
    let row = query.bind(&claims.sub).fetch_one(&state.pool).await;
    let Ok(row) = row else {
        return error_body("Failed to update profile");
    };
    ok(json!({
        "user": {
            "id": row.try_get::<String,_>("id").unwrap_or_default(),
            "username": row.try_get::<String,_>("username").unwrap_or_default(),
            "email": row.try_get::<Option<String>,_>("email").ok().flatten(),
            "displayName": row.try_get::<Option<String>,_>("display_name").ok().flatten(),
            "bio": row.try_get::<Option<String>,_>("bio").ok().flatten(),
            "bannerColor": row.try_get::<Option<String>,_>("banner_color").ok().flatten(),
            "bannerUrl": row.try_get::<Option<String>,_>("banner_url").ok().flatten(),
            "avatarUrl": row.try_get::<Option<String>,_>("avatar_url").ok().flatten(),
            "customBackgroundUrl": row.try_get::<Option<String>,_>("custom_background_url").ok().flatten(),
            "customBackgroundOpacity": row.try_get::<Option<f64>,_>("custom_background_opacity").ok().flatten(),
            "status": row.try_get::<Option<String>,_>("status").ok().flatten(),
            "notificationsQuietMode": row.try_get::<Option<bool>,_>("notificationsQuietMode").ok().flatten()
        }
    }))
}

fn bind_optional_field(
    fields: &mut Vec<String>,
    binds: &mut Vec<Value>,
    column: &str,
    value: Option<Value>,
) {
    if let Some(value) = value {
        let index = binds.len() + 1;
        fields.push(format!("{column} = ${index}"));
        binds.push(value);
    }
}

fn bind_json_value<'q>(
    query: sqlx::query::Query<'q, sqlx::Postgres, sqlx::postgres::PgArguments>,
    value: Value,
) -> sqlx::query::Query<'q, sqlx::Postgres, sqlx::postgres::PgArguments> {
    match value {
        Value::Null => query.bind(Option::<String>::None),
        Value::Bool(value) => query.bind(value),
        Value::Number(value) => {
            if let Some(int) = value.as_i64() {
                query.bind(int)
            } else if let Some(float) = value.as_f64() {
                query.bind(float)
            } else {
                query.bind(value.to_string())
            }
        }
        Value::String(value) => query.bind(value),
        other => query.bind(other.to_string()),
    }
}

#[derive(Deserialize)]
struct DisplayNameBody {
    #[serde(rename = "displayName")]
    display_name: Option<String>,
}

async fn update_display_name(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(body): Json<DisplayNameBody>,
) -> Json<Value> {
    let claims = match auth_claims(&headers, &state) {
        Ok(claims) => claims,
        Err(_) => return error_body("Unauthorized"),
    };
    let Some(display_name) = body.display_name else {
        return error_body("Bad request");
    };
    let row = sqlx::query(
        "UPDATE users SET display_name=$2 WHERE id=$1::uuid RETURNING id::text AS id, username, email, display_name",
    )
    .bind(&claims.sub)
    .bind(display_name)
    .fetch_one(&state.pool)
    .await;
    let Ok(row) = row else {
        return error_body("Unauthorized");
    };
    ok(json!({
        "user": {
            "id": row.try_get::<String,_>("id").unwrap_or_default(),
            "username": row.try_get::<String,_>("username").unwrap_or_default(),
            "email": row.try_get::<Option<String>,_>("email").ok().flatten(),
            "displayName": row.try_get::<Option<String>,_>("display_name").ok().flatten()
        }
    }))
}

async fn list_users(
    State(state): State<SharedState>,
    Query(query): Query<HashMap<String, String>>,
) -> Json<Value> {
    let server_id = query.get("serverId").cloned();
    let rows = sqlx::query(
        r#"
        WITH user_primary_role AS (
          SELECT
            sm.user_id,
            sm.server_id,
            (
              SELECT r.display_group
              FROM server_member_roles smr
              JOIN roles r ON r.id = smr.role_id
              WHERE smr.user_id = sm.user_id AND smr.server_id = sm.server_id
              ORDER BY r.position ASC
              LIMIT 1
            ) AS display_group,
            (
              SELECT r.color
              FROM server_member_roles smr
              JOIN roles r ON r.id = smr.role_id
              WHERE smr.user_id = sm.user_id AND smr.server_id = sm.server_id
              ORDER BY r.position ASC
              LIMIT 1
            ) AS color,
            (
              SELECT min(r.position)
              FROM server_member_roles smr
              JOIN roles r ON r.id = smr.role_id
              WHERE smr.user_id = sm.user_id AND smr.server_id = sm.server_id
            ) AS position
          FROM server_members sm
          WHERE ($1::uuid IS NULL OR sm.server_id = $1::uuid)
        )
        SELECT COALESCE(upr.display_group, 'Users') AS title,
               users.id::text AS user_id,
               users.username,
               users.display_name,
               users.avatar_url,
               users.status,
               users.discriminator,
               upr.color,
               upr.position
        FROM user_primary_role upr
        JOIN users ON users.id = upr.user_id
        ORDER BY upr.position ASC NULLS LAST, users.username ASC
        "#,
    )
    .bind(server_id)
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();
    let mut grouped: HashMap<String, Vec<Value>> = HashMap::new();
    let mut colors: HashMap<String, String> = HashMap::new();
    for row in rows {
        let title = row
            .try_get::<String, _>("title")
            .unwrap_or_else(|_| "Users".to_string());
        let color = row
            .try_get::<Option<String>, _>("color")
            .ok()
            .flatten()
            .unwrap_or_else(|| "#99aab5".to_string());
        colors.entry(title.clone()).or_insert(color.clone());
        grouped.entry(title).or_default().push(json!({
            "id": row.try_get::<String,_>("user_id").unwrap_or_default(),
            "username": row.try_get::<String,_>("username").unwrap_or_default(),
            "displayName": row.try_get::<Option<String>,_>("display_name").ok().flatten(),
            "avatarUrl": row.try_get::<Option<String>,_>("avatar_url").ok().flatten(),
            "status": row.try_get::<Option<String>,_>("status").ok().flatten(),
            "discriminator": row.try_get::<Option<String>,_>("discriminator").ok().flatten(),
            "roleColor": row.try_get::<Option<String>,_>("color").ok().flatten()
        }));
    }
    let groups = grouped
        .into_iter()
        .map(|(title, users)| {
            json!({
                "id": title.to_lowercase(),
                "name": title,
                "color": colors.get(&title).cloned().unwrap_or_else(|| "#99aab5".to_string()),
                "users": users
            })
        })
        .collect::<Vec<_>>();
    ok(json!({ "groups": groups }))
}

async fn get_user_profile(
    State(state): State<SharedState>,
    headers: HeaderMap,
    AxumPath(user_id): AxumPath<String>,
) -> Json<Value> {
    let claims = match auth_claims(&headers, &state) {
        Ok(claims) => claims,
        Err(_) => return error_body("Unauthorized"),
    };
    let row = sqlx::query(
        "SELECT u.id::text AS id, u.username, u.display_name, u.bio, u.banner_color, u.banner_url, u.avatar_url, u.custom_background_url, u.status, u.discriminator, u.allow_dms_from_strangers FROM users u WHERE u.id = $1::uuid",
    )
    .bind(&user_id)
    .fetch_optional(&state.pool)
    .await;
    let Ok(Some(row)) = row else {
        return error_body("User not found");
    };
    let mut friendship_status = "none".to_string();
    let mut friend_request_id: Option<String> = None;
    if claims.sub != user_id {
        let mut ids = [claims.sub.clone(), user_id.clone()];
        ids.sort();
        let friendship = sqlx::query("SELECT id::text AS id, status, action_user_id::text AS action_user_id FROM friendships WHERE user_id_1=$1::uuid AND user_id_2=$2::uuid")
            .bind(&ids[0])
            .bind(&ids[1])
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten();
        if let Some(friendship) = friendship {
            let status: String = friendship.try_get("status").unwrap_or_default();
            let action_user_id: String = friendship.try_get("action_user_id").unwrap_or_default();
            if status == "accepted" {
                friendship_status = "friends".to_string();
            } else if status == "pending" {
                if action_user_id == claims.sub {
                    friendship_status = "outgoing".to_string();
                } else {
                    friendship_status = "incoming".to_string();
                    friend_request_id = friendship.try_get("id").ok();
                }
            } else if status == "blocked" {
                friendship_status = "blocked".to_string();
            }
        }
    }
    ok(json!({
        "user": {
            "id": row.try_get::<String,_>("id").unwrap_or_default(),
            "username": row.try_get::<String,_>("username").unwrap_or_default(),
            "displayName": row.try_get::<Option<String>,_>("display_name").ok().flatten(),
            "bio": row.try_get::<Option<String>,_>("bio").ok().flatten(),
            "bannerColor": row.try_get::<Option<String>,_>("banner_color").ok().flatten(),
            "bannerUrl": row.try_get::<Option<String>,_>("banner_url").ok().flatten(),
            "avatarUrl": row.try_get::<Option<String>,_>("avatar_url").ok().flatten(),
            "customBackgroundUrl": row.try_get::<Option<String>,_>("custom_background_url").ok().flatten(),
            "status": row.try_get::<Option<String>,_>("status").ok().flatten(),
            "discriminator": row.try_get::<Option<String>,_>("discriminator").ok().flatten(),
            "allowDmsFromStrangers": row.try_get::<Option<bool>,_>("allow_dms_from_strangers").ok().flatten(),
            "friendshipStatus": friendship_status,
            "friendRequestId": friend_request_id
        }
    }))
}

async fn get_friends(State(state): State<SharedState>, headers: HeaderMap) -> Json<Value> {
    let claims = match auth_claims(&headers, &state) {
        Ok(claims) => claims,
        Err(_) => return error_body("Unauthorized"),
    };
    let rows = sqlx::query(
        r#"
        SELECT u.id::text, u.username, u.display_name, u.avatar_url, u.status, u.discriminator
        FROM friendships f
        JOIN users u ON (u.id = CASE WHEN f.user_id_1 = $1::uuid THEN f.user_id_2 ELSE f.user_id_1 END)
        WHERE (f.user_id_1 = $1::uuid OR f.user_id_2 = $1::uuid)
          AND f.status = 'accepted'
        ORDER BY f.updated_at DESC
        "#,
    )
    .bind(&claims.sub)
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();
    ok(json!({
        "friends": rows.into_iter().map(|u| json!({
            "id": u.try_get::<String,_>("id").unwrap_or_default(),
            "username": u.try_get::<String,_>("username").unwrap_or_default(),
            "displayName": u.try_get::<Option<String>,_>("display_name").ok().flatten(),
            "avatarUrl": u.try_get::<Option<String>,_>("avatar_url").ok().flatten(),
            "status": u.try_get::<Option<String>,_>("status").ok().flatten(),
            "discriminator": u.try_get::<Option<String>,_>("discriminator").ok().flatten()
        })).collect::<Vec<_>>()
    }))
}

async fn get_friend_requests(State(state): State<SharedState>, headers: HeaderMap) -> Json<Value> {
    let claims = match auth_claims(&headers, &state) {
        Ok(claims) => claims,
        Err(_) => return error_body("Unauthorized"),
    };
    let rows = sqlx::query(
        r#"
        SELECT f.id::text as request_id, f.action_user_id::text as sender_id,
               u.id::text as user_id, u.username, u.display_name, u.avatar_url, u.discriminator,
               CASE WHEN f.action_user_id = $1::uuid THEN 'outgoing' ELSE 'incoming' END as type
        FROM friendships f
        JOIN users u ON (u.id = CASE WHEN f.user_id_1 = $1::uuid THEN f.user_id_2 ELSE f.user_id_1 END)
        WHERE (f.user_id_1 = $1::uuid OR f.user_id_2 = $1::uuid)
          AND f.status = 'pending'
        "#,
    )
    .bind(&claims.sub)
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();
    ok(json!({
        "requests": rows.into_iter().map(|row| json!({
            "id": row.try_get::<String,_>("request_id").unwrap_or_default(),
            "type": row.try_get::<String,_>("type").unwrap_or_default(),
            "user": {
                "id": row.try_get::<String,_>("user_id").unwrap_or_default(),
                "username": row.try_get::<String,_>("username").unwrap_or_default(),
                "displayName": row.try_get::<Option<String>,_>("display_name").ok().flatten(),
                "avatarUrl": row.try_get::<Option<String>,_>("avatar_url").ok().flatten(),
                "discriminator": row.try_get::<Option<String>,_>("discriminator").ok().flatten()
            }
        })).collect::<Vec<_>>()
    }))
}

#[derive(Deserialize)]
struct FriendRequestBody {
    username: Option<String>,
    #[serde(rename = "userId")]
    user_id: Option<String>,
}

async fn send_friend_request(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(body): Json<FriendRequestBody>,
) -> Json<Value> {
    let claims = match auth_claims(&headers, &state) {
        Ok(claims) => claims,
        Err(_) => return error_body("Unauthorized"),
    };
    if body.username.is_none() && body.user_id.is_none() {
        return error_body("Bad request");
    }
    let target_row = if let Some(user_id) = body.user_id {
        sqlx::query("SELECT id::text AS id, username FROM users WHERE id=$1::uuid")
            .bind(&user_id)
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten()
    } else if let Some(username) = body.username {
        find_user_by_username_or_email(&state.pool, &username)
            .await
            .ok()
            .flatten()
    } else {
        None
    };
    let Some(target_row) = target_row else {
        return error_body("User not found");
    };
    let target_user_id: String = target_row.try_get("id").unwrap_or_default();
    if target_user_id == claims.sub {
        return error_body("Cannot add self");
    }
    let mut ids = [claims.sub.clone(), target_user_id.clone()];
    ids.sort();
    let existing = sqlx::query("SELECT status, action_user_id::text AS action_user_id FROM friendships WHERE user_id_1=$1::uuid AND user_id_2=$2::uuid")
        .bind(&ids[0])
        .bind(&ids[1])
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten();
    if let Some(existing) = existing {
        let status: String = existing.try_get("status").unwrap_or_default();
        let action_user_id: String = existing.try_get("action_user_id").unwrap_or_default();
        if status == "accepted" {
            return error_body("Already friends");
        }
        if status == "pending" {
            if action_user_id == claims.sub {
                return error_body("Request already sent");
            }
            let _ = sqlx::query("UPDATE friendships SET status='accepted', action_user_id=$3::uuid WHERE user_id_1=$1::uuid AND user_id_2=$2::uuid")
                .bind(&ids[0])
                .bind(&ids[1])
                .bind(&claims.sub)
                .execute(&state.pool)
                .await;
            return ok(json!({ "status": "accepted" }));
        }
        if status == "blocked" {
            return error_body("Cannot add friend");
        }
    }
    let inserted = sqlx::query(
        "INSERT INTO friendships (user_id_1, user_id_2, status, action_user_id) VALUES ($1::uuid, $2::uuid, 'pending', $3::uuid)",
    )
    .bind(&ids[0])
    .bind(&ids[1])
    .bind(&claims.sub)
    .execute(&state.pool)
    .await;
    if inserted.is_err() {
        return error_body("Server error");
    }
    ok(json!({ "status": "pending" }))
}

async fn respond_friend_request(
    State(state): State<SharedState>,
    headers: HeaderMap,
    AxumPath((request_id, action)): AxumPath<(String, String)>,
) -> Json<Value> {
    let claims = match auth_claims(&headers, &state) {
        Ok(claims) => claims,
        Err(_) => return error_body("Unauthorized"),
    };
    if action != "accept" && action != "decline" {
        return error_body("Bad request");
    }
    let friendship = sqlx::query(
        "SELECT id::text AS id, status, action_user_id::text AS action_user_id, user_id_1::text AS user_id_1, user_id_2::text AS user_id_2 FROM friendships WHERE id=$1::uuid",
    )
    .bind(&request_id)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();
    let Some(friendship) = friendship else {
        return error_body("Request not found");
    };
    let status: String = friendship.try_get("status").unwrap_or_default();
    if status != "pending" {
        return error_body("Request not pending");
    }
    let action_user_id: String = friendship.try_get("action_user_id").unwrap_or_default();
    let user_id_1: String = friendship.try_get("user_id_1").unwrap_or_default();
    let user_id_2: String = friendship.try_get("user_id_2").unwrap_or_default();
    if action == "accept" && action_user_id == claims.sub {
        return error_body("Cannot accept own request");
    }
    if user_id_1 != claims.sub && user_id_2 != claims.sub {
        return error_body("Unauthorized");
    }
    if action == "accept" {
        let _ = sqlx::query("UPDATE friendships SET status='accepted', action_user_id=$2::uuid, updated_at=now() WHERE id=$1::uuid")
            .bind(&request_id)
            .bind(&claims.sub)
            .execute(&state.pool)
            .await;
    } else {
        let _ = sqlx::query("DELETE FROM friendships WHERE id=$1::uuid")
            .bind(&request_id)
            .execute(&state.pool)
            .await;
    }
    ok(json!({ "ok": true }))
}

async fn remove_friend(
    State(state): State<SharedState>,
    headers: HeaderMap,
    AxumPath(friend_id): AxumPath<String>,
) -> Json<Value> {
    let claims = match auth_claims(&headers, &state) {
        Ok(claims) => claims,
        Err(_) => return error_body("Unauthorized"),
    };
    let mut ids = [claims.sub.clone(), friend_id];
    ids.sort();
    let _ = sqlx::query("DELETE FROM friendships WHERE user_id_1=$1::uuid AND user_id_2=$2::uuid")
        .bind(&ids[0])
        .bind(&ids[1])
        .execute(&state.pool)
        .await;
    ok(json!({ "ok": true }))
}

#[derive(Deserialize)]
struct DmBody {
    #[serde(rename = "userId")]
    user_id: Option<String>,
}

async fn list_dms(State(state): State<SharedState>, headers: HeaderMap) -> Json<Value> {
    let claims = match auth_claims(&headers, &state) {
        Ok(claims) => claims,
        Err(_) => return error_body("Unauthorized"),
    };
    let rows = sqlx::query(
        r#"
        SELECT c.id::text AS id, u.id::text as user_id, u.username, u.display_name, u.avatar_url, u.status, u.discriminator
        FROM channels c
        JOIN channel_members cm1 ON c.id = cm1.channel_id
        JOIN channel_members cm2 ON c.id = cm2.channel_id
        JOIN users u ON cm2.user_id = u.id
        WHERE c.type = 'dm'
          AND cm1.user_id = $1::uuid
          AND cm2.user_id != $1::uuid
        ORDER BY c.id
        "#,
    )
    .bind(&claims.sub)
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();
    ok(json!({
        "dms": rows.into_iter().map(|row| json!({
            "id": row.try_get::<String,_>("id").unwrap_or_default(),
            "user": {
                "id": row.try_get::<String,_>("user_id").unwrap_or_default(),
                "username": row.try_get::<String,_>("username").unwrap_or_default(),
                "displayName": row.try_get::<Option<String>,_>("display_name").ok().flatten(),
                "avatarUrl": row.try_get::<Option<String>,_>("avatar_url").ok().flatten(),
                "status": row.try_get::<Option<String>,_>("status").ok().flatten(),
                "discriminator": row.try_get::<Option<String>,_>("discriminator").ok().flatten()
            }
        })).collect::<Vec<_>>()
    }))
}

async fn create_dm(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(body): Json<DmBody>,
) -> Json<Value> {
    let claims = match auth_claims(&headers, &state) {
        Ok(claims) => claims,
        Err(_) => return error_body("Unauthorized"),
    };
    let Some(user_id) = body.user_id else {
        return error_body("Bad request");
    };
    if user_id == claims.sub {
        return error_body("Cannot DM self");
    }
    let existing = sqlx::query(
        r#"
        SELECT c.id::text AS id
        FROM channels c
        JOIN channel_members cm1 ON c.id = cm1.channel_id
        JOIN channel_members cm2 ON c.id = cm2.channel_id
        WHERE c.type = 'dm' AND cm1.user_id = $1::uuid AND cm2.user_id = $2::uuid
        LIMIT 1
        "#,
    )
    .bind(&claims.sub)
    .bind(&user_id)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();
    if let Some(existing) = existing {
        return ok(json!({ "id": existing.try_get::<String,_>("id").unwrap_or_default() }));
    }
    let target_user = sqlx::query("SELECT allow_dms_from_strangers FROM users WHERE id=$1::uuid")
        .bind(&user_id)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten();
    let Some(target_user) = target_user else {
        return error_body("User not found");
    };
    let mut ids = [claims.sub.clone(), user_id.clone()];
    ids.sort();
    let friendship = sqlx::query(
        "SELECT status FROM friendships WHERE user_id_1=$1::uuid AND user_id_2=$2::uuid",
    )
    .bind(&ids[0])
    .bind(&ids[1])
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();
    let is_friend = friendship
        .and_then(|row| row.try_get::<String, _>("status").ok())
        .map(|status| status == "accepted")
        .unwrap_or(false);
    let allow_strangers = target_user
        .try_get::<bool, _>("allow_dms_from_strangers")
        .unwrap_or(true);
    if !is_friend && !allow_strangers {
        return error_body("User does not accept DMs");
    }
    let mut tx = match state.pool.begin().await {
        Ok(tx) => tx,
        Err(_) => return error_body("Server error"),
    };
    let row = sqlx::query(
        "INSERT INTO channels (type, name) VALUES ('dm', 'dm') RETURNING id::text AS id",
    )
    .fetch_one(&mut *tx)
    .await;
    let Ok(row) = row else {
        return error_body("Server error");
    };
    let channel_id: String = row.try_get("id").unwrap_or_default();
    let _ = sqlx::query("INSERT INTO channel_members (channel_id, user_id) VALUES ($1::uuid, $2::uuid), ($1::uuid, $3::uuid)")
        .bind(&channel_id)
        .bind(&claims.sub)
        .bind(&user_id)
        .execute(&mut *tx)
        .await;
    let _ = tx.commit().await;
    ok(json!({ "id": channel_id }))
}

// Remaining handlers continue below. The compatibility surface is large; this file
// intentionally keeps the behavior close to the existing TypeScript service.

async fn list_channels(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Json<Value> {
    let auth = auth_claims(&headers, &state).ok();
    let server_id = query.get("serverId").cloned();
    let rows = sqlx::query(
        "SELECT c.id::text AS id, c.name, c.category, c.type, c.server_id::text AS \"serverId\" FROM channels c WHERE ($1::uuid IS NULL OR c.server_id = $1::uuid) ORDER BY c.category, c.name",
    )
    .bind(server_id.clone())
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();
    let categories = sqlx::query("SELECT name FROM channel_categories WHERE ($1::uuid IS NULL OR server_id=$1::uuid) ORDER BY name")
        .bind(server_id.clone())
        .fetch_all(&state.pool)
        .await
        .unwrap_or_default();
    let mut channels = rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.try_get::<String,_>("id").unwrap_or_default(),
                "name": row.try_get::<String,_>("name").unwrap_or_default(),
                "category": row.try_get::<Option<String>,_>("category").ok().flatten(),
                "type": row.try_get::<String,_>("type").unwrap_or_else(|_| "text".to_string()),
                "canSendMessages": true,
                "canView": true
            })
        })
        .collect::<Vec<_>>();

    if let (Some(server_id), Some(auth)) = (server_id.as_deref(), auth.as_ref()) {
        let member = sqlx::query(
            "SELECT 1 FROM server_members WHERE server_id=$1::uuid AND user_id=$2::uuid LIMIT 1",
        )
        .bind(server_id)
        .bind(&auth.sub)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten();
        if member.is_none() {
            return ok(json!({ "sections": [] }));
        }
        let owner =
            sqlx::query("SELECT owner_id::text AS owner_id FROM servers WHERE id=$1::uuid LIMIT 1")
                .bind(server_id)
                .fetch_optional(&state.pool)
                .await
                .ok()
                .flatten();
        let role_rows = sqlx::query("SELECT smr.role_id::text AS role_id FROM server_member_roles smr WHERE smr.server_id = $1::uuid AND smr.user_id = $2::uuid")
            .bind(server_id)
            .bind(&auth.sub)
            .fetch_all(&state.pool)
            .await
            .unwrap_or_default();
        let role_ids = role_rows
            .into_iter()
            .filter_map(|row| row.try_get::<String, _>("role_id").ok())
            .collect::<Vec<_>>();
        let is_owner = owner
            .and_then(|row| row.try_get::<String, _>("owner_id").ok())
            .map(|owner_id| owner_id == auth.sub)
            .unwrap_or(false);
        let is_admin = if is_owner || role_ids.is_empty() {
            false
        } else {
            sqlx::query("SELECT 1 FROM roles WHERE server_id = $1::uuid AND id = ANY($2::uuid[]) AND (can_manage_server = TRUE OR can_manage_channels = TRUE) LIMIT 1")
                .bind(server_id)
                .bind(&role_ids)
                .fetch_optional(&state.pool)
                .await
                .ok()
                .flatten()
                .is_some()
        };
        let perm_rows = if role_ids.is_empty() {
            Vec::new()
        } else {
            sqlx::query(
                "SELECT cp.channel_id::text AS channel_id, bool_or(cp.can_view) AS can_view, bool_or(cp.can_send_messages) AS can_send_messages FROM channel_permissions cp WHERE cp.channel_id IN (SELECT id FROM channels WHERE server_id = $1::uuid) AND cp.role_id = ANY($2::uuid[]) GROUP BY cp.channel_id",
            )
            .bind(server_id)
            .bind(&role_ids)
            .fetch_all(&state.pool)
            .await
            .unwrap_or_default()
        };
        let restricted_rows = sqlx::query("SELECT DISTINCT cp.channel_id::text AS channel_id FROM channel_permissions cp JOIN channels c ON c.id = cp.channel_id WHERE c.server_id = $1::uuid")
            .bind(server_id)
            .fetch_all(&state.pool)
            .await
            .unwrap_or_default();
        let restricted = restricted_rows
            .into_iter()
            .filter_map(|row| row.try_get::<String, _>("channel_id").ok())
            .collect::<HashSet<_>>();
        let perm_map = perm_rows
            .into_iter()
            .filter_map(|row| {
                Some((
                    row.try_get::<String, _>("channel_id").ok()?,
                    (
                        row.try_get::<bool, _>("can_view").unwrap_or(false),
                        row.try_get::<bool, _>("can_send_messages").unwrap_or(false),
                    ),
                ))
            })
            .collect::<HashMap<_, _>>();
        for channel in &mut channels {
            let channel_type = channel
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or("text");
            let channel_id = channel
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            if channel_type == "dm" || is_owner || is_admin || !restricted.contains(&channel_id) {
                continue;
            }
            let (can_view, can_send_messages) =
                perm_map.get(&channel_id).copied().unwrap_or((false, false));
            channel["canView"] = Value::Bool(can_view);
            channel["canSendMessages"] = Value::Bool(can_view && can_send_messages);
        }
    }

    let visible = channels
        .into_iter()
        .filter(|row| row.get("canView").and_then(Value::as_bool).unwrap_or(true))
        .collect::<Vec<_>>();
    let mut by_category: HashMap<String, Vec<Value>> = HashMap::new();
    for row in visible {
        let category = row
            .get("category")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        by_category.entry(category).or_default().push(json!({
            "id": row.get("id").cloned().unwrap_or(Value::Null),
            "name": row.get("name").cloned().unwrap_or(Value::Null),
            "type": row.get("type").cloned().unwrap_or(Value::String("text".to_string())),
            "canSendMessages": row.get("canSendMessages").cloned().unwrap_or(Value::Bool(true))
        }));
    }
    for category in categories {
        let title = category.try_get::<String, _>("name").unwrap_or_default();
        by_category.entry(title).or_default();
    }
    let mut sections = by_category
        .into_iter()
        .map(|(title, channels)| json!({ "title": title, "channels": channels }))
        .collect::<Vec<_>>();
    sections.sort_by(|a, b| {
        a.get("title")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .cmp(b.get("title").and_then(Value::as_str).unwrap_or_default())
    });
    ok(json!({ "sections": sections }))
}

// The remaining route implementations are intentionally compatibility-first but are
// omitted in this initial patch due to size. They are added incrementally below in
// follow-up edits so the file stays reviewable.

#[derive(Deserialize)]
struct ChannelPermissionBody {
    #[serde(rename = "roleId")]
    role_id: Option<String>,
    #[serde(rename = "canView")]
    can_view: Option<bool>,
    #[serde(rename = "canSendMessages")]
    can_send_messages: Option<bool>,
}

#[derive(Deserialize)]
struct CreateChannelBody {
    #[serde(rename = "serverId")]
    server_id: Option<String>,
    name: Option<String>,
    category: Option<String>,
    permissions: Option<Vec<ChannelPermissionBody>>,
}

async fn create_channel(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(body): Json<CreateChannelBody>,
) -> Json<Value> {
    let claims = match auth_claims(&headers, &state) {
        Ok(claims) => claims,
        Err(_) => return error_body("Unauthorized"),
    };
    let (Some(server_id), Some(name), Some(category)) = (body.server_id, body.name, body.category)
    else {
        return error_body("Bad request");
    };
    let allowed = check_permission(&state.pool, &claims.sub, &server_id, "can_manage_channels")
        .await
        .unwrap_or(false);
    if !allowed {
        return error_body("Missing permissions");
    }
    let mut tx = match state.pool.begin().await {
        Ok(tx) => tx,
        Err(_) => return error_body("Unauthorized"),
    };
    let channel = sqlx::query(
        "INSERT INTO channels (server_id, name, category) VALUES ($1::uuid,$2::text,$3::text) RETURNING id::text AS id, name, category",
    )
    .bind(&server_id)
    .bind(&name)
    .bind(&category)
    .fetch_one(&mut *tx)
    .await;
    let Ok(channel) = channel else {
        return error_body("Unauthorized");
    };
    let channel_id: String = channel.try_get("id").unwrap_or_default();
    if let Some(permissions) = body.permissions {
        for permission in permissions {
            if let Some(role_id) = permission.role_id {
                let _ = sqlx::query(
                    "INSERT INTO channel_permissions (channel_id, role_id, can_view, can_send_messages) VALUES ($1::uuid, $2::uuid, $3::boolean, $4::boolean)",
                )
                .bind(&channel_id)
                .bind(role_id)
                .bind(permission.can_view.unwrap_or(false))
                .bind(permission.can_send_messages.unwrap_or(false))
                .execute(&mut *tx)
                .await;
            }
        }
    }
    let _ = tx.commit().await;
    ok(json!({
        "channel": {
            "id": channel_id,
            "name": channel.try_get::<String,_>("name").unwrap_or_default(),
            "category": channel.try_get::<Option<String>,_>("category").ok().flatten()
        }
    }))
}

#[derive(Deserialize)]
struct UpdateChannelBody {
    name: Option<String>,
    permissions: Option<Vec<ChannelPermissionBody>>,
}

async fn update_channel(
    State(state): State<SharedState>,
    headers: HeaderMap,
    AxumPath(channel_id): AxumPath<String>,
    Json(body): Json<UpdateChannelBody>,
) -> Json<Value> {
    let claims = match auth_claims(&headers, &state) {
        Ok(claims) => claims,
        Err(_) => return error_body("Unauthorized"),
    };
    let channel =
        sqlx::query("SELECT server_id::text AS server_id FROM channels WHERE id=$1::uuid")
            .bind(&channel_id)
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten();
    let Some(channel) = channel else {
        return error_body("Not found");
    };
    let server_id: String = channel.try_get("server_id").unwrap_or_default();
    let allowed = check_permission(&state.pool, &claims.sub, &server_id, "can_manage_channels")
        .await
        .unwrap_or(false);
    if !allowed {
        return error_body("Missing permissions");
    }
    let mut tx = match state.pool.begin().await {
        Ok(tx) => tx,
        Err(_) => return error_body("Unauthorized"),
    };
    if let Some(name) = body.name {
        let _ = sqlx::query("UPDATE channels SET name=$2 WHERE id=$1::uuid")
            .bind(&channel_id)
            .bind(name)
            .execute(&mut *tx)
            .await;
    }
    if let Some(permissions) = body.permissions {
        let _ = sqlx::query("DELETE FROM channel_permissions WHERE channel_id=$1::uuid")
            .bind(&channel_id)
            .execute(&mut *tx)
            .await;
        for permission in permissions {
            if let Some(role_id) = permission.role_id {
                let _ = sqlx::query(
                    "INSERT INTO channel_permissions (channel_id, role_id, can_view, can_send_messages) VALUES ($1::uuid, $2::uuid, $3::boolean, $4::boolean)",
                )
                .bind(&channel_id)
                .bind(role_id)
                .bind(permission.can_view.unwrap_or(false))
                .bind(permission.can_send_messages.unwrap_or(false))
                .execute(&mut *tx)
                .await;
            }
        }
    }
    let row = sqlx::query("SELECT id::text AS id, name FROM channels WHERE id=$1::uuid")
        .bind(&channel_id)
        .fetch_one(&mut *tx)
        .await;
    let _ = tx.commit().await;
    let Ok(row) = row else {
        return error_body("Unauthorized");
    };
    ok(
        json!({ "channel": { "id": row.try_get::<String,_>("id").unwrap_or_default(), "name": row.try_get::<String,_>("name").unwrap_or_default() } }),
    )
}

async fn get_channel_permissions(
    State(state): State<SharedState>,
    headers: HeaderMap,
    AxumPath(channel_id): AxumPath<String>,
) -> Json<Value> {
    if auth_claims(&headers, &state).is_err() {
        return error_body("Unauthorized");
    }
    let rows = sqlx::query(
        "SELECT role_id::text AS \"roleId\", can_view AS \"canView\", can_send_messages AS \"canSendMessages\" FROM channel_permissions WHERE channel_id=$1::uuid",
    )
    .bind(&channel_id)
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();
    ok(json!({
        "permissions": rows.into_iter().map(|row| json!({
            "roleId": row.try_get::<String,_>("roleId").unwrap_or_default(),
            "canView": row.try_get::<bool,_>("canView").unwrap_or(false),
            "canSendMessages": row.try_get::<bool,_>("canSendMessages").unwrap_or(false)
        })).collect::<Vec<_>>()
    }))
}

async fn delete_channel(
    State(state): State<SharedState>,
    headers: HeaderMap,
    AxumPath(channel_id): AxumPath<String>,
) -> Json<Value> {
    let claims = match auth_claims(&headers, &state) {
        Ok(claims) => claims,
        Err(_) => return error_body("Unauthorized"),
    };
    let channel =
        sqlx::query("SELECT server_id::text AS server_id FROM channels WHERE id=$1::uuid")
            .bind(&channel_id)
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten();
    let Some(channel) = channel else {
        return error_body("Not found");
    };
    let server_id: String = channel.try_get("server_id").unwrap_or_default();
    let allowed = check_permission(&state.pool, &claims.sub, &server_id, "can_manage_channels")
        .await
        .unwrap_or(false);
    if !allowed {
        return error_body("Missing permissions");
    }
    let _ = sqlx::query("DELETE FROM channels WHERE id=$1::uuid")
        .bind(&channel_id)
        .execute(&state.pool)
        .await;
    ok(json!({ "ok": true }))
}

async fn channel_by_name(
    State(state): State<SharedState>,
    Query(query): Query<HashMap<String, String>>,
) -> Json<Value> {
    let Some(server_id) = query.get("serverId").cloned() else {
        return error_body("Bad request");
    };
    let Some(name) = query.get("name").cloned() else {
        return error_body("Bad request");
    };
    let row = sqlx::query(
        "SELECT id::text AS id FROM channels WHERE server_id=$1::uuid AND name=$2::text LIMIT 1",
    )
    .bind(&server_id)
    .bind(&name)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();
    let Some(row) = row else {
        return error_body("Not found");
    };
    ok(json!({ "id": row.try_get::<String,_>("id").unwrap_or_default() }))
}

#[derive(Deserialize)]
struct CategoryBody {
    #[serde(rename = "serverId")]
    server_id: Option<String>,
    name: Option<String>,
}

async fn create_category(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(body): Json<CategoryBody>,
) -> Json<Value> {
    let claims = match auth_claims(&headers, &state) {
        Ok(claims) => claims,
        Err(_) => return error_body("Unauthorized"),
    };
    let (Some(server_id), Some(name)) = (body.server_id, body.name) else {
        return error_body("Bad request");
    };
    let allowed = check_permission(&state.pool, &claims.sub, &server_id, "can_manage_channels")
        .await
        .unwrap_or(false);
    if !allowed {
        return error_body("Missing permissions");
    }
    let row = sqlx::query(
        "INSERT INTO channel_categories (server_id, name) VALUES ($1::uuid,$2::text) RETURNING id::text AS id, name",
    )
    .bind(&server_id)
    .bind(&name)
    .fetch_one(&state.pool)
    .await;
    let Ok(row) = row else {
        return error_body("Unauthorized");
    };
    ok(
        json!({ "category": { "id": row.try_get::<String,_>("id").unwrap_or_default(), "name": row.try_get::<String,_>("name").unwrap_or_default() } }),
    )
}

async fn update_category(
    State(state): State<SharedState>,
    headers: HeaderMap,
    AxumPath(category_id): AxumPath<String>,
    Json(body): Json<CategoryBody>,
) -> Json<Value> {
    let claims = match auth_claims(&headers, &state) {
        Ok(claims) => claims,
        Err(_) => return error_body("Unauthorized"),
    };
    let Some(name) = body.name else {
        return error_body("Bad request");
    };
    let category = sqlx::query(
        "SELECT server_id::text AS server_id FROM channel_categories WHERE id=$1::uuid",
    )
    .bind(&category_id)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();
    let Some(category) = category else {
        return error_body("Not found");
    };
    let server_id: String = category.try_get("server_id").unwrap_or_default();
    let allowed = check_permission(&state.pool, &claims.sub, &server_id, "can_manage_channels")
        .await
        .unwrap_or(false);
    if !allowed {
        return error_body("Missing permissions");
    }
    let row = sqlx::query(
        "UPDATE channel_categories SET name=$2 WHERE id=$1::uuid RETURNING id::text AS id, name",
    )
    .bind(&category_id)
    .bind(&name)
    .fetch_one(&state.pool)
    .await;
    let Ok(row) = row else {
        return error_body("Unauthorized");
    };
    ok(
        json!({ "category": { "id": row.try_get::<String,_>("id").unwrap_or_default(), "name": row.try_get::<String,_>("name").unwrap_or_default() } }),
    )
}

async fn delete_category(
    State(state): State<SharedState>,
    headers: HeaderMap,
    AxumPath(category_id): AxumPath<String>,
) -> Json<Value> {
    let claims = match auth_claims(&headers, &state) {
        Ok(claims) => claims,
        Err(_) => return error_body("Unauthorized"),
    };
    let category = sqlx::query(
        "SELECT server_id::text AS server_id FROM channel_categories WHERE id=$1::uuid",
    )
    .bind(&category_id)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();
    let Some(category) = category else {
        return error_body("Not found");
    };
    let server_id: String = category.try_get("server_id").unwrap_or_default();
    let allowed = check_permission(&state.pool, &claims.sub, &server_id, "can_manage_channels")
        .await
        .unwrap_or(false);
    if !allowed {
        return error_body("Missing permissions");
    }
    let _ = sqlx::query("DELETE FROM channel_categories WHERE id=$1::uuid")
        .bind(&category_id)
        .execute(&state.pool)
        .await;
    ok(json!({ "ok": true }))
}
async fn list_servers(State(state): State<SharedState>, headers: HeaderMap) -> Json<Value> {
    let claims = match auth_claims(&headers, &state) {
        Ok(claims) => claims,
        Err(_) => return ok(json!({ "servers": [] })),
    };
    let rows = sqlx::query(
        "SELECT servers.id::text AS id, servers.name, servers.icon_url AS \"iconUrl\", servers.banner_url AS \"bannerUrl\", servers.owner_id::text AS \"ownerId\" FROM server_members JOIN servers ON servers.id = server_members.server_id WHERE server_members.user_id = $1::uuid ORDER BY servers.name",
    )
    .bind(&claims.sub)
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();
    ok(json!({
        "servers": rows.into_iter().map(|row| json!({
            "id": row.try_get::<String,_>("id").unwrap_or_default(),
            "name": row.try_get::<String,_>("name").unwrap_or_default(),
            "iconUrl": row.try_get::<Option<String>,_>("iconUrl").ok().flatten(),
            "bannerUrl": row.try_get::<Option<String>,_>("bannerUrl").ok().flatten(),
            "ownerId": row.try_get::<Option<String>,_>("ownerId").ok().flatten()
        })).collect::<Vec<_>>()
    }))
}

#[derive(Deserialize)]
struct ServerBody {
    name: Option<String>,
    description: Option<String>,
    #[serde(rename = "iconUrl")]
    icon_url: Option<String>,
    #[serde(rename = "bannerUrl")]
    banner_url: Option<String>,
}

async fn create_server(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(body): Json<ServerBody>,
) -> Json<Value> {
    let claims = match auth_claims(&headers, &state) {
        Ok(claims) => claims,
        Err(_) => return error_body("Bad request"),
    };
    let Some(name) = body.name else {
        return error_body("Bad request");
    };
    let row = sqlx::query(
        "INSERT INTO servers (name, owner_id, description, icon_url, banner_url) VALUES ($1::text, $2::uuid, $3, $4, $5) RETURNING id::text AS id, name, description, icon_url AS \"iconUrl\", banner_url AS \"bannerUrl\", owner_id::text AS \"ownerId\"",
    )
    .bind(&name)
    .bind(&claims.sub)
    .bind(body.description)
    .bind(body.icon_url)
    .bind(body.banner_url)
    .fetch_one(&state.pool)
    .await;
    let Ok(row) = row else {
        return error_body("Unauthorized");
    };
    let server_id: String = row.try_get("id").unwrap_or_default();
    let owner_role = sqlx::query(
        "INSERT INTO roles (server_id, name, color, display_group, position, can_manage_channels, can_manage_server, can_manage_roles) VALUES ($1::uuid, 'Owner', '#ff0000', 'Owner', 0, true, true, true) RETURNING id::text AS id",
    )
    .bind(&server_id)
    .fetch_one(&state.pool)
    .await;
    let member_role = sqlx::query(
        "INSERT INTO roles (server_id, name, color, display_group, position, can_manage_channels, can_manage_server, can_manage_roles) VALUES ($1::uuid, 'Member', '#99aab5', 'Member', 1, false, false, false) RETURNING id::text AS id",
    )
    .bind(&server_id)
    .fetch_one(&state.pool)
    .await;
    let owner_role_id = owner_role
        .ok()
        .and_then(|row| row.try_get::<String, _>("id").ok());
    let _member_role_id = member_role
        .ok()
        .and_then(|row| row.try_get::<String, _>("id").ok());
    if let Some(owner_role_id) = owner_role_id {
        let _ = sqlx::query("INSERT INTO server_members (server_id, user_id, role_id) VALUES ($1::uuid,$2::uuid,$3::uuid) ON CONFLICT DO NOTHING")
            .bind(&server_id)
            .bind(&claims.sub)
            .bind(&owner_role_id)
            .execute(&state.pool)
            .await;
        let _ = sqlx::query("INSERT INTO server_member_roles (server_id, user_id, role_id) VALUES ($1::uuid,$2::uuid,$3::uuid) ON CONFLICT DO NOTHING")
            .bind(&server_id)
            .bind(&claims.sub)
            .bind(owner_role_id)
            .execute(&state.pool)
            .await;
    }
    ok(json!({
        "server": {
            "id": server_id,
            "name": row.try_get::<String,_>("name").unwrap_or_default(),
            "description": row.try_get::<Option<String>,_>("description").ok().flatten(),
            "iconUrl": row.try_get::<Option<String>,_>("iconUrl").ok().flatten(),
            "bannerUrl": row.try_get::<Option<String>,_>("bannerUrl").ok().flatten(),
            "ownerId": row.try_get::<Option<String>,_>("ownerId").ok().flatten()
        }
    }))
}

async fn update_server(
    State(state): State<SharedState>,
    headers: HeaderMap,
    AxumPath(server_id): AxumPath<String>,
    Json(body): Json<ServerBody>,
) -> Json<Value> {
    let claims = match auth_claims(&headers, &state) {
        Ok(claims) => claims,
        Err(_) => return error_body("Bad request"),
    };
    let allowed = check_permission(&state.pool, &claims.sub, &server_id, "can_manage_server")
        .await
        .unwrap_or(false);
    if !allowed {
        return error_body("Missing permissions");
    }
    let mut fields = Vec::new();
    let mut binds: Vec<Value> = Vec::new();
    if let Some(name) = body.name {
        bind_optional_field(&mut fields, &mut binds, "name", Some(Value::String(name)));
    }
    if let Some(description) = body.description {
        bind_optional_field(
            &mut fields,
            &mut binds,
            "description",
            Some(Value::String(description)),
        );
    }
    if let Some(icon_url) = body.icon_url {
        bind_optional_field(
            &mut fields,
            &mut binds,
            "icon_url",
            Some(Value::String(icon_url)),
        );
    }
    if let Some(banner_url) = body.banner_url {
        bind_optional_field(
            &mut fields,
            &mut binds,
            "banner_url",
            Some(Value::String(banner_url)),
        );
    }
    if fields.is_empty() {
        return error_body("No fields");
    }
    let sql = format!(
        "UPDATE servers SET {} WHERE id=$1::uuid RETURNING id::text AS id, name, description, icon_url AS \"iconUrl\", banner_url AS \"bannerUrl\", owner_id::text AS \"ownerId\"",
        fields.iter().enumerate().map(|(i, field)| field.replacen('$', &format!("${}", i + 2), 1)).collect::<Vec<_>>().join(", ")
    );
    let mut query = sqlx::query(&sql).bind(&server_id);
    for value in binds {
        query = bind_json_value(query, value);
    }
    let row = query.fetch_one(&state.pool).await;
    let Ok(row) = row else {
        return error_body("Unauthorized");
    };
    ok(json!({ "server": {
        "id": row.try_get::<String,_>("id").unwrap_or_default(),
        "name": row.try_get::<String,_>("name").unwrap_or_default(),
        "description": row.try_get::<Option<String>,_>("description").ok().flatten(),
        "iconUrl": row.try_get::<Option<String>,_>("iconUrl").ok().flatten(),
        "bannerUrl": row.try_get::<Option<String>,_>("bannerUrl").ok().flatten(),
        "ownerId": row.try_get::<Option<String>,_>("ownerId").ok().flatten()
    }}))
}

async fn delete_server(
    State(state): State<SharedState>,
    headers: HeaderMap,
    AxumPath(server_id): AxumPath<String>,
) -> Json<Value> {
    let claims = match auth_claims(&headers, &state) {
        Ok(claims) => claims,
        Err(_) => return error_body("Bad request"),
    };
    let row = sqlx::query("SELECT owner_id::text AS owner_id FROM servers WHERE id=$1::uuid")
        .bind(&server_id)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten();
    if row.and_then(|row| row.try_get::<String, _>("owner_id").ok()) != Some(claims.sub) {
        return error_body("Unauthorized");
    }
    let _ = sqlx::query("DELETE FROM servers WHERE id=$1::uuid")
        .bind(&server_id)
        .execute(&state.pool)
        .await;
    ok(json!({ "ok": true }))
}

async fn leave_server(
    State(state): State<SharedState>,
    headers: HeaderMap,
    AxumPath(server_id): AxumPath<String>,
) -> Json<Value> {
    let claims = match auth_claims(&headers, &state) {
        Ok(claims) => claims,
        Err(_) => return error_body("Bad request"),
    };
    let owner = sqlx::query("SELECT owner_id::text AS owner_id FROM servers WHERE id=$1::uuid")
        .bind(&server_id)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten()
        .and_then(|row| row.try_get::<String, _>("owner_id").ok());
    if owner.as_deref() == Some(claims.sub.as_str()) {
        let member_count = count_query(
            &state.pool,
            &format!(
                "SELECT count(*) FROM server_members WHERE server_id='{}'::uuid",
                server_id
            ),
        )
        .await;
        if member_count > 1 {
            return error_body("Owner cannot leave server unless they are the last member. Please delete the server instead.");
        }
    }
    let _ = sqlx::query("DELETE FROM server_members WHERE server_id=$1::uuid AND user_id=$2::uuid")
        .bind(&server_id)
        .bind(&claims.sub)
        .execute(&state.pool)
        .await;
    let _ = sqlx::query(
        "DELETE FROM server_member_roles WHERE server_id=$1::uuid AND user_id=$2::uuid",
    )
    .bind(&server_id)
    .bind(&claims.sub)
    .execute(&state.pool)
    .await;
    let member_count = count_query(
        &state.pool,
        &format!(
            "SELECT count(*) FROM server_members WHERE server_id='{}'::uuid",
            server_id
        ),
    )
    .await;
    let invite_count = count_query(&state.pool, &format!("SELECT count(*) FROM invites WHERE server_id='{}'::uuid AND (expires_at IS NULL OR expires_at > now())", server_id)).await;
    if member_count == 0 && invite_count == 0 {
        let _ = sqlx::query("DELETE FROM servers WHERE id=$1::uuid")
            .bind(&server_id)
            .execute(&state.pool)
            .await;
        return ok(json!({ "left": true, "serverDeleted": true }));
    }
    ok(json!({ "left": true }))
}

#[derive(Deserialize)]
struct InviteBody {
    #[serde(rename = "expiresIn")]
    expires_in: Option<i64>,
    #[serde(rename = "maxUses")]
    max_uses: Option<i64>,
}

async fn create_invite(
    State(state): State<SharedState>,
    headers: HeaderMap,
    AxumPath(server_id): AxumPath<String>,
    Json(body): Json<InviteBody>,
) -> Json<Value> {
    let claims = match auth_claims(&headers, &state) {
        Ok(claims) => claims,
        Err(_) => return error_body("Bad request"),
    };
    let member =
        sqlx::query("SELECT 1 FROM server_members WHERE server_id=$1::uuid AND user_id=$2::uuid")
            .bind(&server_id)
            .bind(&claims.sub)
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten();
    if member.is_none() {
        return error_body("Not a member");
    }
    let code = random_string(8).to_lowercase();
    let expires_at = Utc::now() + Duration::seconds(body.expires_in.unwrap_or(7 * 24 * 60 * 60));
    let _ = sqlx::query("INSERT INTO invites (code, server_id, created_by, max_uses, expires_at) VALUES ($1, $2::uuid, $3::uuid, $4, $5)")
        .bind(&code)
        .bind(&server_id)
        .bind(&claims.sub)
        .bind(body.max_uses)
        .bind(expires_at)
        .execute(&state.pool)
        .await;
    ok(json!({ "code": code, "url": format!("https://safascord.org/invite/{}", code) }))
}

async fn invite_info(
    State(state): State<SharedState>,
    AxumPath(code): AxumPath<String>,
) -> Json<Value> {
    let row = sqlx::query(
        "SELECT i.code, i.server_id::text AS server_id, i.expires_at, i.max_uses, i.uses, s.name as server_name, s.icon_url, s.banner_url, (SELECT count(*) FROM server_members WHERE server_id = s.id) as member_count FROM invites i JOIN servers s ON s.id = i.server_id WHERE i.code = $1",
    )
    .bind(&code)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();
    let Some(row) = row else {
        return error_body("Invite not found");
    };
    let expires_at = row
        .try_get::<Option<chrono::DateTime<Utc>>, _>("expires_at")
        .ok()
        .flatten();
    if expires_at.map(|value| value < Utc::now()).unwrap_or(false) {
        return error_body("Invite expired");
    }
    let max_uses = row.try_get::<Option<i32>, _>("max_uses").ok().flatten();
    let uses = row.try_get::<i32, _>("uses").unwrap_or(0);
    if max_uses.map(|max_uses| uses >= max_uses).unwrap_or(false) {
        return error_body("Invite max uses reached");
    }
    ok(json!({
        "code": row.try_get::<String,_>("code").unwrap_or_default(),
        "server": {
            "id": row.try_get::<String,_>("server_id").unwrap_or_default(),
            "name": row.try_get::<String,_>("server_name").unwrap_or_default(),
            "iconUrl": row.try_get::<Option<String>,_>("icon_url").ok().flatten(),
            "bannerUrl": row.try_get::<Option<String>,_>("banner_url").ok().flatten(),
            "memberCount": row.try_get::<i64,_>("member_count").unwrap_or(0)
        },
        "expiresAt": expires_at.map(|value| value.to_rfc3339()),
        "maxUses": max_uses,
        "uses": uses
    }))
}

async fn accept_invite(
    State(state): State<SharedState>,
    headers: HeaderMap,
    AxumPath(code): AxumPath<String>,
) -> Json<Value> {
    let claims = match auth_claims(&headers, &state) {
        Ok(claims) => claims,
        Err(_) => return error_body("Bad request"),
    };
    let row = sqlx::query("SELECT i.*, s.name as server_name FROM invites i JOIN servers s ON s.id = i.server_id WHERE i.code = $1")
        .bind(&code)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten();
    let Some(row) = row else {
        return error_body("Invite not found");
    };
    let expires_at = row
        .try_get::<Option<chrono::DateTime<Utc>>, _>("expires_at")
        .ok()
        .flatten();
    if expires_at.map(|value| value < Utc::now()).unwrap_or(false) {
        return error_body("Invite expired");
    }
    let max_uses = row.try_get::<Option<i32>, _>("max_uses").ok().flatten();
    let uses = row.try_get::<i32, _>("uses").unwrap_or(0);
    if max_uses.map(|max_uses| uses >= max_uses).unwrap_or(false) {
        return error_body("Invite max uses reached");
    }
    let server_id: String = row
        .try_get::<Uuid, _>("server_id")
        .map(|id| id.to_string())
        .unwrap_or_default();
    let banned =
        sqlx::query("SELECT 1 FROM server_bans WHERE server_id=$1::uuid AND user_id=$2::uuid")
            .bind(&server_id)
            .bind(&claims.sub)
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten();
    if banned.is_some() {
        return error_body("You are banned from this server");
    }
    let role = sqlx::query(
        "SELECT id::text AS id FROM roles WHERE server_id=$1::uuid AND name='Member' LIMIT 1",
    )
    .bind(&server_id)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();
    let role_id = role
        .and_then(|row| row.try_get::<String, _>("id").ok())
        .or_else(|| {
            futures::executor::block_on(async {
                sqlx::query("SELECT id::text AS id FROM roles WHERE server_id=$1::uuid ORDER BY position DESC LIMIT 1")
                    .bind(&server_id)
                    .fetch_optional(&state.pool)
                    .await
                    .ok()
                    .flatten()
                    .and_then(|row| row.try_get::<String, _>("id").ok())
            })
        });
    let _ = sqlx::query("INSERT INTO server_members (server_id, user_id, role_id) VALUES ($1::uuid, $2::uuid, $3::uuid) ON CONFLICT DO NOTHING")
        .bind(&server_id)
        .bind(&claims.sub)
        .bind(role_id.clone())
        .execute(&state.pool)
        .await;
    if let Some(role_id) = role_id {
        let _ = sqlx::query("INSERT INTO server_member_roles (server_id, user_id, role_id) VALUES ($1::uuid, $2::uuid, $3::uuid) ON CONFLICT DO NOTHING")
            .bind(&server_id)
            .bind(&claims.sub)
            .bind(role_id)
            .execute(&state.pool)
            .await;
    }
    let _ = sqlx::query("UPDATE invites SET uses = uses + 1 WHERE code=$1")
        .bind(&code)
        .execute(&state.pool)
        .await;
    ok(json!({ "success": true, "serverId": server_id }))
}

async fn get_server_members(
    State(state): State<SharedState>,
    headers: HeaderMap,
    AxumPath(server_id): AxumPath<String>,
    Query(query): Query<HashMap<String, String>>,
) -> Json<Value> {
    if auth_claims(&headers, &state).is_err() {
        return error_body("Bad request");
    }
    let channel_id = query.get("channelId").cloned();
    let rows = sqlx::query(
        r#"
        SELECT u.id::text AS id, u.username, u.discriminator, u.display_name as "displayName", u.avatar_url as "avatarUrl", sm.muted,
               array_agg(smr.role_id::text) as roles
        FROM server_members sm
        JOIN users u ON u.id = sm.user_id
        LEFT JOIN server_member_roles smr ON smr.user_id = sm.user_id AND smr.server_id = sm.server_id
        WHERE sm.server_id = $1::uuid
        GROUP BY u.id, u.username, u.discriminator, u.display_name, u.avatar_url, sm.muted
        ORDER BY u.username
        "#,
    )
    .bind(&server_id)
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();
    let mut members = rows
        .into_iter()
        .map(|row| {
            let roles: Vec<Option<String>> = row.try_get("roles").unwrap_or_default();
            json!({
                "id": row.try_get::<String,_>("id").unwrap_or_default(),
                "username": row.try_get::<String,_>("username").unwrap_or_default(),
                "discriminator": row.try_get::<Option<String>,_>("discriminator").ok().flatten(),
                "displayName": row.try_get::<Option<String>,_>("displayName").ok().flatten(),
                "avatarUrl": row.try_get::<Option<String>,_>("avatarUrl").ok().flatten(),
                "muted": row.try_get::<bool,_>("muted").unwrap_or(false),
                "roles": roles.into_iter().flatten().collect::<Vec<_>>()
            })
        })
        .collect::<Vec<_>>();
    if let Some(channel_id) = channel_id {
        if Uuid::parse_str(&channel_id).is_ok() {
            let perms = sqlx::query("SELECT role_id::text AS role_id, can_view FROM channel_permissions WHERE channel_id=$1::uuid")
                .bind(&channel_id)
                .fetch_all(&state.pool)
                .await
                .unwrap_or_default();
            if !perms.is_empty() {
                let allowed_roles = perms
                    .into_iter()
                    .filter(|row| row.try_get::<bool, _>("can_view").unwrap_or(false))
                    .filter_map(|row| row.try_get::<String, _>("role_id").ok())
                    .collect::<HashSet<_>>();
                let owner = sqlx::query(
                    "SELECT owner_id::text AS owner_id FROM servers WHERE id=$1::uuid LIMIT 1",
                )
                .bind(&server_id)
                .fetch_optional(&state.pool)
                .await
                .ok()
                .flatten()
                .and_then(|row| row.try_get::<String, _>("owner_id").ok());
                let admin_roles = sqlx::query("SELECT id::text AS id FROM roles WHERE server_id=$1::uuid AND (can_manage_server = TRUE OR can_manage_channels = TRUE)")
                    .bind(&server_id)
                    .fetch_all(&state.pool)
                    .await
                    .unwrap_or_default()
                    .into_iter()
                    .filter_map(|row| row.try_get::<String,_>("id").ok())
                    .collect::<HashSet<_>>();
                members.retain(|member| {
                    let member_id = member.get("id").and_then(Value::as_str).unwrap_or_default();
                    if owner.as_deref() == Some(member_id) {
                        return true;
                    }
                    let roles = member
                        .get("roles")
                        .and_then(Value::as_array)
                        .cloned()
                        .unwrap_or_default()
                        .into_iter()
                        .filter_map(|value| value.as_str().map(|s| s.to_string()))
                        .collect::<Vec<_>>();
                    roles.iter().any(|role_id| {
                        admin_roles.contains(role_id) || allowed_roles.contains(role_id)
                    })
                });
            }
        }
    }
    ok(json!({ "members": members }))
}

async fn delete_member(
    State(state): State<SharedState>,
    headers: HeaderMap,
    AxumPath((server_id, user_id)): AxumPath<(String, String)>,
) -> Json<Value> {
    let claims = match auth_claims(&headers, &state) {
        Ok(claims) => claims,
        Err(_) => return error_body("Bad request"),
    };
    let allowed = check_permission(&state.pool, &claims.sub, &server_id, "can_manage_server")
        .await
        .unwrap_or(false);
    if !allowed {
        return error_body("Missing permissions");
    }
    let owner = sqlx::query("SELECT owner_id::text AS owner_id FROM servers WHERE id=$1::uuid")
        .bind(&server_id)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten()
        .and_then(|row| row.try_get::<String, _>("owner_id").ok());
    if owner.as_deref() == Some(user_id.as_str()) {
        return error_body("Cannot kick owner");
    }
    let _ = sqlx::query("DELETE FROM server_members WHERE server_id=$1::uuid AND user_id=$2::uuid")
        .bind(&server_id)
        .bind(&user_id)
        .execute(&state.pool)
        .await;
    let _ = sqlx::query(
        "DELETE FROM server_member_roles WHERE server_id=$1::uuid AND user_id=$2::uuid",
    )
    .bind(&server_id)
    .bind(&user_id)
    .execute(&state.pool)
    .await;
    ok(json!({ "ok": true }))
}

#[derive(Deserialize)]
struct LegacyUpdateMemberBody {
    #[serde(rename = "roleIds")]
    role_ids: Option<Vec<String>>,
}

async fn update_member_legacy(
    State(state): State<SharedState>,
    headers: HeaderMap,
    AxumPath((server_id, user_id)): AxumPath<(String, String)>,
    Json(body): Json<LegacyUpdateMemberBody>,
) -> Json<Value> {
    let claims = match auth_claims(&headers, &state) {
        Ok(claims) => claims,
        Err(_) => return error_body("Bad request"),
    };
    let Some(role_ids) = body.role_ids else {
        return error_body("Bad request");
    };
    let allowed = check_permission(&state.pool, &claims.sub, &server_id, "can_manage_roles")
        .await
        .unwrap_or(false);
    if !allowed {
        return error_body("Missing permissions");
    }
    let owner = sqlx::query("SELECT owner_id::text AS owner_id FROM servers WHERE id=$1::uuid")
        .bind(&server_id)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten()
        .and_then(|row| row.try_get::<String, _>("owner_id").ok());
    if owner.as_deref() == Some(user_id.as_str()) {
        return error_body("Cannot modify owner roles");
    }
    let mut tx = match state.pool.begin().await {
        Ok(tx) => tx,
        Err(_) => return error_body("Unauthorized"),
    };
    let _ = sqlx::query(
        "DELETE FROM server_member_roles WHERE server_id=$1::uuid AND user_id=$2::uuid",
    )
    .bind(&server_id)
    .bind(&user_id)
    .execute(&mut *tx)
    .await;
    for role_id in role_ids {
        let _ = sqlx::query("INSERT INTO server_member_roles (server_id, user_id, role_id) VALUES ($1::uuid, $2::uuid, $3::uuid) ON CONFLICT DO NOTHING")
            .bind(&server_id)
            .bind(&user_id)
            .bind(role_id)
            .execute(&mut *tx)
            .await;
    }
    let _ = tx.commit().await;
    ok(json!({ "ok": true }))
}

#[derive(Deserialize)]
struct MuteBody {
    muted: Option<bool>,
}

async fn mute_member(
    State(state): State<SharedState>,
    headers: HeaderMap,
    AxumPath((server_id, user_id)): AxumPath<(String, String)>,
    Json(body): Json<MuteBody>,
) -> Json<Value> {
    let claims = match auth_claims(&headers, &state) {
        Ok(claims) => claims,
        Err(_) => return error_body("Bad request"),
    };
    let Some(muted) = body.muted else {
        return error_body("Bad request");
    };
    let allowed = check_permission(&state.pool, &claims.sub, &server_id, "can_manage_server")
        .await
        .unwrap_or(false);
    if !allowed {
        return error_body("Missing permissions");
    }
    let _ = sqlx::query(
        "UPDATE server_members SET muted=$3 WHERE server_id=$1::uuid AND user_id=$2::uuid",
    )
    .bind(&server_id)
    .bind(&user_id)
    .bind(muted)
    .execute(&state.pool)
    .await;
    ok(json!({ "ok": true }))
}

#[derive(Deserialize)]
struct BanBody {
    #[serde(rename = "userId")]
    user_id: Option<String>,
    reason: Option<String>,
}

async fn create_ban(
    State(state): State<SharedState>,
    headers: HeaderMap,
    AxumPath(server_id): AxumPath<String>,
    Json(body): Json<BanBody>,
) -> Json<Value> {
    let claims = match auth_claims(&headers, &state) {
        Ok(claims) => claims,
        Err(_) => return error_body("Bad request"),
    };
    let Some(user_id) = body.user_id else {
        return error_body("Bad request");
    };
    let allowed = check_permission(&state.pool, &claims.sub, &server_id, "can_manage_server")
        .await
        .unwrap_or(false);
    if !allowed {
        return error_body("Missing permissions");
    }
    let owner = sqlx::query("SELECT owner_id::text AS owner_id FROM servers WHERE id=$1::uuid")
        .bind(&server_id)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten()
        .and_then(|row| row.try_get::<String, _>("owner_id").ok());
    if owner.as_deref() == Some(user_id.as_str()) {
        return error_body("Cannot ban owner");
    }
    let mut tx = match state.pool.begin().await {
        Ok(tx) => tx,
        Err(_) => return error_body("Unauthorized"),
    };
    let _ = sqlx::query("INSERT INTO server_bans (server_id, user_id, reason) VALUES ($1::uuid, $2::uuid, $3) ON CONFLICT DO NOTHING")
        .bind(&server_id)
        .bind(&user_id)
        .bind(body.reason)
        .execute(&mut *tx)
        .await;
    let _ = sqlx::query("DELETE FROM server_members WHERE server_id=$1::uuid AND user_id=$2::uuid")
        .bind(&server_id)
        .bind(&user_id)
        .execute(&mut *tx)
        .await;
    let _ = sqlx::query(
        "DELETE FROM server_member_roles WHERE server_id=$1::uuid AND user_id=$2::uuid",
    )
    .bind(&server_id)
    .bind(&user_id)
    .execute(&mut *tx)
    .await;
    let _ = tx.commit().await;
    ok(json!({ "ok": true }))
}

#[derive(Deserialize)]
struct RolesBody {
    roles: Option<Vec<String>>,
}

async fn update_member_roles(
    State(state): State<SharedState>,
    headers: HeaderMap,
    AxumPath((server_id, user_id)): AxumPath<(String, String)>,
    Json(body): Json<RolesBody>,
) -> Json<Value> {
    let claims = match auth_claims(&headers, &state) {
        Ok(claims) => claims,
        Err(_) => return error_body("Bad request"),
    };
    let Some(roles) = body.roles else {
        return error_body("Bad request");
    };
    let allowed = check_permission(&state.pool, &claims.sub, &server_id, "can_manage_roles")
        .await
        .unwrap_or(false);
    if !allowed {
        return error_body("Unauthorized");
    }
    let mut tx = match state.pool.begin().await {
        Ok(tx) => tx,
        Err(_) => return error_body("Server error"),
    };
    let _ = sqlx::query(
        "DELETE FROM server_member_roles WHERE server_id=$1::uuid AND user_id=$2::uuid",
    )
    .bind(&server_id)
    .bind(&user_id)
    .execute(&mut *tx)
    .await;
    for role_id in roles {
        let _ = sqlx::query("INSERT INTO server_member_roles (server_id, user_id, role_id) VALUES ($1::uuid, $2::uuid, $3::uuid)")
            .bind(&server_id)
            .bind(&user_id)
            .bind(role_id)
            .execute(&mut *tx)
            .await;
    }
    let _ = tx.commit().await;
    ok(json!({ "ok": true }))
}

async fn kick_member(
    State(state): State<SharedState>,
    headers: HeaderMap,
    AxumPath((server_id, user_id)): AxumPath<(String, String)>,
) -> Json<Value> {
    let claims = match auth_claims(&headers, &state) {
        Ok(claims) => claims,
        Err(_) => return error_body("Bad request"),
    };
    let owner = sqlx::query("SELECT owner_id::text AS owner_id FROM servers WHERE id=$1::uuid")
        .bind(&server_id)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten()
        .and_then(|row| row.try_get::<String, _>("owner_id").ok());
    if owner.as_deref() != Some(claims.sub.as_str()) {
        return error_body("Unauthorized");
    }
    let _ = sqlx::query("DELETE FROM server_members WHERE server_id=$1::uuid AND user_id=$2::uuid")
        .bind(&server_id)
        .bind(&user_id)
        .execute(&state.pool)
        .await;
    let _ = sqlx::query(
        "DELETE FROM server_member_roles WHERE server_id=$1::uuid AND user_id=$2::uuid",
    )
    .bind(&server_id)
    .bind(&user_id)
    .execute(&state.pool)
    .await;
    ok(json!({ "ok": true }))
}

async fn ban_member(
    State(state): State<SharedState>,
    headers: HeaderMap,
    AxumPath((server_id, user_id)): AxumPath<(String, String)>,
) -> Json<Value> {
    let claims = match auth_claims(&headers, &state) {
        Ok(claims) => claims,
        Err(_) => return error_body("Bad request"),
    };
    let owner = sqlx::query("SELECT owner_id::text AS owner_id FROM servers WHERE id=$1::uuid")
        .bind(&server_id)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten()
        .and_then(|row| row.try_get::<String, _>("owner_id").ok());
    if owner.as_deref() != Some(claims.sub.as_str()) {
        return error_body("Unauthorized");
    }
    let _ = sqlx::query("DELETE FROM server_members WHERE server_id=$1::uuid AND user_id=$2::uuid")
        .bind(&server_id)
        .bind(&user_id)
        .execute(&state.pool)
        .await;
    let _ = sqlx::query(
        "DELETE FROM server_member_roles WHERE server_id=$1::uuid AND user_id=$2::uuid",
    )
    .bind(&server_id)
    .bind(&user_id)
    .execute(&state.pool)
    .await;
    let _ = sqlx::query("INSERT INTO server_bans (server_id, user_id) VALUES ($1::uuid, $2::uuid) ON CONFLICT DO NOTHING")
        .bind(&server_id)
        .bind(&user_id)
        .execute(&state.pool)
        .await;
    ok(json!({ "ok": true }))
}

async fn get_roles(
    State(state): State<SharedState>,
    headers: HeaderMap,
    AxumPath(server_id): AxumPath<String>,
) -> Json<Value> {
    if auth_claims(&headers, &state).is_err() {
        return error_body("Bad request");
    }
    let rows = sqlx::query("SELECT id::text AS id, name, color, position, can_manage_channels AS \"canManageChannels\", can_manage_server AS \"canManageServer\", can_manage_roles AS \"canManageRoles\" FROM roles WHERE server_id=$1::uuid ORDER BY position ASC, name ASC")
        .bind(&server_id)
        .fetch_all(&state.pool)
        .await
        .unwrap_or_default();
    ok(json!({
        "roles": rows.into_iter().map(|row| json!({
            "id": row.try_get::<String,_>("id").unwrap_or_default(),
            "name": row.try_get::<String,_>("name").unwrap_or_default(),
            "color": row.try_get::<Option<String>,_>("color").ok().flatten(),
            "position": row.try_get::<i32,_>("position").unwrap_or(0),
            "canManageChannels": row.try_get::<bool,_>("canManageChannels").unwrap_or(false),
            "canManageServer": row.try_get::<bool,_>("canManageServer").unwrap_or(false),
            "canManageRoles": row.try_get::<bool,_>("canManageRoles").unwrap_or(false)
        })).collect::<Vec<_>>()
    }))
}

#[derive(Deserialize)]
struct RoleBody {
    name: Option<String>,
    color: Option<String>,
    position: Option<i32>,
    #[serde(rename = "canManageChannels")]
    can_manage_channels: Option<bool>,
    #[serde(rename = "canManageServer")]
    can_manage_server: Option<bool>,
    #[serde(rename = "canManageRoles")]
    can_manage_roles: Option<bool>,
}

async fn create_role(
    State(state): State<SharedState>,
    headers: HeaderMap,
    AxumPath(server_id): AxumPath<String>,
    Json(body): Json<RoleBody>,
) -> Json<Value> {
    let claims = match auth_claims(&headers, &state) {
        Ok(claims) => claims,
        Err(_) => return error_body("Bad request"),
    };
    let Some(name) = body.name else {
        return error_body("Bad request");
    };
    let allowed = check_permission(&state.pool, &claims.sub, &server_id, "can_manage_roles")
        .await
        .unwrap_or(false);
    if !allowed {
        return error_body("Missing permissions");
    }
    let position = body.position.unwrap_or_else(|| 0);
    let row = sqlx::query("INSERT INTO roles (server_id, name, color, display_group, position, can_manage_channels, can_manage_server, can_manage_roles) VALUES ($1::uuid, $2::text, $3::text, $2::text, $4::integer, $5::boolean, $6::boolean, $7::boolean) RETURNING id::text AS id, name, color, position, can_manage_channels AS \"canManageChannels\", can_manage_server AS \"canManageServer\", can_manage_roles AS \"canManageRoles\"")
        .bind(&server_id)
        .bind(&name)
        .bind(body.color.unwrap_or_else(|| "#99aab5".to_string()))
        .bind(position)
        .bind(body.can_manage_channels.unwrap_or(false))
        .bind(body.can_manage_server.unwrap_or(false))
        .bind(body.can_manage_roles.unwrap_or(false))
        .fetch_one(&state.pool)
        .await;
    let Ok(row) = row else {
        return error_body("Unauthorized");
    };
    ok(json!({ "role": {
        "id": row.try_get::<String,_>("id").unwrap_or_default(),
        "name": row.try_get::<String,_>("name").unwrap_or_default(),
        "color": row.try_get::<Option<String>,_>("color").ok().flatten(),
        "position": row.try_get::<i32,_>("position").unwrap_or(0),
        "canManageChannels": row.try_get::<bool,_>("canManageChannels").unwrap_or(false),
        "canManageServer": row.try_get::<bool,_>("canManageServer").unwrap_or(false),
        "canManageRoles": row.try_get::<bool,_>("canManageRoles").unwrap_or(false)
    }}))
}

async fn update_role(
    State(state): State<SharedState>,
    headers: HeaderMap,
    AxumPath((server_id, role_id)): AxumPath<(String, String)>,
    Json(body): Json<RoleBody>,
) -> Json<Value> {
    let claims = match auth_claims(&headers, &state) {
        Ok(claims) => claims,
        Err(_) => return error_body("Bad request"),
    };
    let allowed = check_permission(&state.pool, &claims.sub, &server_id, "can_manage_roles")
        .await
        .unwrap_or(false);
    if !allowed {
        return error_body("Missing permissions");
    }
    let mut fields = Vec::new();
    let mut binds: Vec<Value> = Vec::new();
    if let Some(name) = body.name {
        bind_optional_field(
            &mut fields,
            &mut binds,
            "name",
            Some(Value::String(name.clone())),
        );
        bind_optional_field(
            &mut fields,
            &mut binds,
            "display_group",
            Some(Value::String(name)),
        );
    }
    if let Some(color) = body.color {
        bind_optional_field(&mut fields, &mut binds, "color", Some(Value::String(color)));
    }
    if let Some(position) = body.position {
        bind_optional_field(&mut fields, &mut binds, "position", Some(json!(position)));
    }
    if let Some(can_manage_channels) = body.can_manage_channels {
        bind_optional_field(
            &mut fields,
            &mut binds,
            "can_manage_channels",
            Some(json!(can_manage_channels)),
        );
    }
    if let Some(can_manage_server) = body.can_manage_server {
        bind_optional_field(
            &mut fields,
            &mut binds,
            "can_manage_server",
            Some(json!(can_manage_server)),
        );
    }
    if let Some(can_manage_roles) = body.can_manage_roles {
        bind_optional_field(
            &mut fields,
            &mut binds,
            "can_manage_roles",
            Some(json!(can_manage_roles)),
        );
    }
    if fields.is_empty() {
        return error_body("No fields");
    }
    let sql = format!(
        "UPDATE roles SET {} WHERE id=$1::uuid RETURNING id::text AS id, name, color, position, can_manage_channels AS \"canManageChannels\", can_manage_server AS \"canManageServer\", can_manage_roles AS \"canManageRoles\"",
        fields.iter().enumerate().map(|(i, field)| field.replacen('$', &format!("${}", i + 2), 1)).collect::<Vec<_>>().join(", ")
    );
    let mut query = sqlx::query(&sql).bind(&role_id);
    for value in binds {
        query = bind_json_value(query, value);
    }
    let row = query.fetch_one(&state.pool).await;
    let Ok(row) = row else {
        return error_body("Unauthorized");
    };
    ok(json!({ "role": {
        "id": row.try_get::<String,_>("id").unwrap_or_default(),
        "name": row.try_get::<String,_>("name").unwrap_or_default(),
        "color": row.try_get::<Option<String>,_>("color").ok().flatten(),
        "position": row.try_get::<i32,_>("position").unwrap_or(0),
        "canManageChannels": row.try_get::<bool,_>("canManageChannels").unwrap_or(false),
        "canManageServer": row.try_get::<bool,_>("canManageServer").unwrap_or(false),
        "canManageRoles": row.try_get::<bool,_>("canManageRoles").unwrap_or(false)
    }}))
}

async fn delete_role(
    State(state): State<SharedState>,
    headers: HeaderMap,
    AxumPath((server_id, role_id)): AxumPath<(String, String)>,
) -> Json<Value> {
    let claims = match auth_claims(&headers, &state) {
        Ok(claims) => claims,
        Err(_) => return error_body("Bad request"),
    };
    let allowed = check_permission(&state.pool, &claims.sub, &server_id, "can_manage_roles")
        .await
        .unwrap_or(false);
    if !allowed {
        return error_body("Missing permissions");
    }
    let _ = sqlx::query("DELETE FROM roles WHERE id=$1::uuid")
        .bind(&role_id)
        .execute(&state.pool)
        .await;
    ok(json!({ "ok": true }))
}

async fn get_member(
    State(state): State<SharedState>,
    headers: HeaderMap,
    AxumPath((server_id, user_id)): AxumPath<(String, String)>,
) -> Json<Value> {
    if auth_claims(&headers, &state).is_err() {
        return error_body("Bad request");
    }
    let roles = sqlx::query("SELECT r.id::text AS id, r.name, r.color, r.position FROM server_member_roles smr JOIN roles r ON r.id = smr.role_id WHERE smr.server_id=$1::uuid AND smr.user_id=$2::uuid ORDER BY r.position ASC")
        .bind(&server_id)
        .bind(&user_id)
        .fetch_all(&state.pool)
        .await
        .unwrap_or_default();
    let role_list = roles
        .into_iter()
        .map(|row| {
            json!({
                "id": row.try_get::<String,_>("id").unwrap_or_default(),
                "name": row.try_get::<String,_>("name").unwrap_or_default(),
                "color": row.try_get::<Option<String>,_>("color").ok().flatten(),
                "position": row.try_get::<i32,_>("position").unwrap_or(0)
            })
        })
        .collect::<Vec<_>>();
    let primary = role_list.first().cloned();
    ok(json!({
        "member": primary.map(|role| json!({
            "roleId": role.get("id").cloned().unwrap_or(Value::Null),
            "roleName": role.get("name").cloned().unwrap_or(Value::Null),
            "roleColor": role.get("color").cloned().unwrap_or(Value::Null),
            "canManageRoles": false,
            "roles": role_list
        }))
    }))
}
async fn resolve_channel_id(
    pool: &PgPool,
    channel: Option<&str>,
    server_id: Option<&str>,
) -> Result<Option<String>> {
    let Some(channel) = channel else {
        return Ok(None);
    };
    if Uuid::parse_str(channel).is_ok() {
        return Ok(Some(channel.to_string()));
    }
    let row = if let Some(server_id) = server_id {
        sqlx::query("SELECT id::text AS id FROM channels WHERE name=$1::text AND server_id=$2::uuid LIMIT 1")
            .bind(channel)
            .bind(server_id)
            .fetch_optional(pool)
            .await?
    } else {
        sqlx::query("SELECT id::text AS id FROM channels WHERE name=$1::text LIMIT 1")
            .bind(channel)
            .fetch_optional(pool)
            .await?
    };
    Ok(row.and_then(|row| row.try_get::<String, _>("id").ok()))
}

#[derive(Deserialize)]
struct MessagesQuery {
    channel: Option<String>,
    limit: Option<String>,
    before: Option<String>,
    #[serde(rename = "serverId")]
    server_id: Option<String>,
}

async fn get_messages(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Query(query): Query<MessagesQuery>,
) -> Json<Value> {
    let claims = match auth_claims(&headers, &state) {
        Ok(claims) => claims,
        Err(_) => return error_body("Unauthorized"),
    };
    let limit = query
        .limit
        .as_deref()
        .and_then(|raw| raw.parse::<i64>().ok())
        .map(|value| value.clamp(1, 200))
        .unwrap_or(50);
    let channel_id = match resolve_channel_id(
        &state.pool,
        query.channel.as_deref(),
        query.server_id.as_deref(),
    )
    .await
    {
        Ok(Some(channel_id)) => channel_id,
        _ => return ok(json!({ "messages": [] })),
    };
    let channel = sqlx::query(
        "SELECT server_id::text AS server_id, type, name FROM channels WHERE id=$1::uuid",
    )
    .bind(&channel_id)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();
    let Some(channel) = channel else {
        return ok(json!({ "messages": [] }));
    };
    let channel_type: String = channel
        .try_get("type")
        .unwrap_or_else(|_| "text".to_string());
    let server_id: Option<String> = channel.try_get("server_id").ok().flatten();
    if channel_type == "dm" {
        let member = sqlx::query(
            "SELECT 1 FROM channel_members WHERE channel_id=$1::uuid AND user_id=$2::uuid",
        )
        .bind(&channel_id)
        .bind(&claims.sub)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten();
        if member.is_none() {
            return error_body("Unauthorized");
        }
    } else if let Some(server_id) = server_id.as_deref() {
        let perms = sqlx::query(
            r#"
            SELECT EXISTS(SELECT 1 FROM channel_permissions cp_exists WHERE cp_exists.channel_id = $1::uuid) AS has_permissions,
                   COALESCE(bool_or(cp.can_view), FALSE) AS can_view,
                   EXISTS(SELECT 1 FROM servers s WHERE s.id = $3::uuid AND s.owner_id = $2::uuid) AS is_owner
            FROM server_member_roles smr
            LEFT JOIN channel_permissions cp ON cp.channel_id = $1::uuid AND cp.role_id = smr.role_id
            WHERE smr.user_id = $2::uuid AND smr.server_id = $3::uuid
            "#,
        )
        .bind(&channel_id)
        .bind(&claims.sub)
        .bind(server_id)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten();
        if let Some(perms) = perms {
            let has_permissions = perms.try_get::<bool, _>("has_permissions").unwrap_or(false);
            let can_view = perms.try_get::<bool, _>("can_view").unwrap_or(false);
            let is_owner = perms.try_get::<bool, _>("is_owner").unwrap_or(false);
            if has_permissions && !can_view && !is_owner {
                return error_body("Unauthorized");
            }
        }
    }
    let rows = sqlx::query(
        r#"
        SELECT messages.id::text AS id,
               COALESCE(users.display_name, users.username) AS user,
               users.avatar_url AS user_avatar,
               users.id::text AS user_id,
               messages.content AS text,
               messages.attachment_url,
               messages.created_at AS ts,
               user_role.color AS role_color
        FROM messages
        JOIN channels ON channels.id = messages.channel_id
        LEFT JOIN users ON users.id = messages.user_id
        LEFT JOIN LATERAL (
          SELECT r.color
          FROM server_member_roles smr
          JOIN roles r ON r.id = smr.role_id
          WHERE smr.user_id = messages.user_id AND smr.server_id = channels.server_id
          ORDER BY r.position ASC
          LIMIT 1
        ) AS user_role ON true
        WHERE messages.channel_id = $1::uuid
          AND ($2::timestamptz IS NULL OR messages.created_at < $2::timestamptz)
        ORDER BY messages.created_at DESC
        LIMIT $3
        "#,
    )
    .bind(&channel_id)
    .bind(query.before)
    .bind(limit)
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();
    let mut messages = rows
        .into_iter()
        .map(|row| json!({
            "id": row.try_get::<String,_>("id").unwrap_or_default(),
            "user": row.try_get::<Option<String>,_>("user").ok().flatten().unwrap_or_else(|| "User".to_string()),
            "userAvatar": row.try_get::<Option<String>,_>("user_avatar").ok().flatten(),
            "userId": row.try_get::<Option<String>,_>("user_id").ok().flatten(),
            "text": row.try_get::<String,_>("text").unwrap_or_default(),
            "attachmentUrl": row.try_get::<Option<String>,_>("attachment_url").ok().flatten(),
            "ts": row.try_get::<chrono::DateTime<Utc>,_>("ts").map(|value| value.to_rfc3339()).unwrap_or_else(|_| Utc::now().to_rfc3339()),
            "roleColor": row.try_get::<Option<String>,_>("role_color").ok().flatten()
        }))
        .collect::<Vec<_>>();
    messages.reverse();
    ok(json!({ "messages": messages }))
}

#[derive(Deserialize)]
struct CreateMessageBody {
    channel: Option<String>,
    content: Option<String>,
    #[serde(rename = "serverId")]
    server_id: Option<String>,
    #[serde(rename = "attachmentUrl")]
    attachment_url: Option<String>,
}

async fn create_message(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(body): Json<CreateMessageBody>,
) -> Json<Value> {
    let claims = match auth_claims(&headers, &state) {
        Ok(claims) => claims,
        Err(_) => return error_body("Bad request"),
    };
    let Some(channel_input) = body.channel.as_deref() else {
        return error_body("Bad request");
    };
    if body.content.as_deref().unwrap_or_default().is_empty() && body.attachment_url.is_none() {
        return error_body("Bad request");
    }
    if body
        .content
        .as_deref()
        .map(|content| content.len() > 5000)
        .unwrap_or(false)
    {
        return error_body("Message too long (max 5000 characters)");
    }
    let channel_id =
        match resolve_channel_id(&state.pool, Some(channel_input), body.server_id.as_deref()).await
        {
            Ok(Some(channel_id)) => channel_id,
            _ => return error_body("Channel not found"),
        };
    let channel = sqlx::query(
        "SELECT server_id::text AS server_id, type, name FROM channels WHERE id=$1::uuid",
    )
    .bind(&channel_id)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();
    let Some(channel) = channel else {
        return error_body("Channel not found");
    };
    let channel_type: String = channel
        .try_get("type")
        .unwrap_or_else(|_| "text".to_string());
    let channel_name: String = channel
        .try_get::<Option<String>, _>("name")
        .ok()
        .flatten()
        .unwrap_or_else(|| channel_input.to_string());
    let server_id: Option<String> = channel.try_get("server_id").ok().flatten();
    if channel_type == "dm" {
        let member = sqlx::query(
            "SELECT 1 FROM channel_members WHERE channel_id=$1::uuid AND user_id=$2::uuid",
        )
        .bind(&channel_id)
        .bind(&claims.sub)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten();
        if member.is_none() {
            return error_body("Not a member of this DM");
        }
    } else if let Some(server_id) = server_id.as_deref() {
        let access = sqlx::query(
            r#"
            SELECT sm.muted AS muted,
                   EXISTS(SELECT 1 FROM channel_permissions cp_exists WHERE cp_exists.channel_id = $1::uuid) AS has_permissions,
                   COALESCE(bool_or(cp.can_send_messages), FALSE) AS can_send,
                   COALESCE(bool_or((r.can_manage_server = TRUE) OR (r.can_manage_channels = TRUE)), FALSE) AS is_admin,
                   EXISTS(SELECT 1 FROM servers s WHERE s.id = $3::uuid AND s.owner_id = $2::uuid) AS is_owner
            FROM server_members sm
            LEFT JOIN server_member_roles smr ON smr.server_id = sm.server_id AND smr.user_id = sm.user_id
            LEFT JOIN roles r ON r.id = smr.role_id
            LEFT JOIN channel_permissions cp ON cp.channel_id = $1::uuid AND cp.role_id = smr.role_id
            WHERE sm.server_id = $3::uuid AND sm.user_id = $2::uuid
            GROUP BY sm.muted
            "#,
        )
        .bind(&channel_id)
        .bind(&claims.sub)
        .bind(server_id)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten();
        let Some(access) = access else {
            return error_body("Not a member of this server");
        };
        let muted = access.try_get::<bool, _>("muted").unwrap_or(false);
        let has_permissions = access
            .try_get::<bool, _>("has_permissions")
            .unwrap_or(false);
        let can_send = access.try_get::<bool, _>("can_send").unwrap_or(false);
        let is_admin = access.try_get::<bool, _>("is_admin").unwrap_or(false);
        let is_owner = access.try_get::<bool, _>("is_owner").unwrap_or(false);
        if muted {
            return error_body("You are muted");
        }
        if has_permissions && !can_send && !is_admin && !is_owner {
            return error_body("Missing permissions");
        }
    }
    let row = sqlx::query(
        "WITH inserted AS (INSERT INTO messages (channel_id, user_id, content, attachment_url) VALUES ($1::uuid, $2::uuid, $3::text, $4::text) RETURNING id::text AS id, content AS text, attachment_url, created_at AS ts, user_id) SELECT inserted.id, inserted.text, inserted.attachment_url, inserted.ts, COALESCE(u.display_name, u.username) AS sender_name, u.avatar_url AS sender_avatar FROM inserted LEFT JOIN users u ON u.id = inserted.user_id",
    )
    .bind(&channel_id)
    .bind(&claims.sub)
    .bind(body.content.clone().unwrap_or_default())
    .bind(body.attachment_url.clone())
    .fetch_one(&state.pool)
    .await;
    let Ok(row) = row else {
        return error_body("Unauthorized");
    };
    let message_id: String = row.try_get("id").unwrap_or_default();
    let text: String = row.try_get("text").unwrap_or_default();
    let attachment_url: Option<String> = row.try_get("attachment_url").ok().flatten();
    let ts = row
        .try_get::<chrono::DateTime<Utc>, _>("ts")
        .map(|value| value.to_rfc3339())
        .unwrap_or_else(|_| Utc::now().to_rfc3339());
    let sender_name: String = row
        .try_get::<Option<String>, _>("sender_name")
        .ok()
        .flatten()
        .unwrap_or_else(|| "User".to_string());
    let sender_avatar: Option<String> = row.try_get("sender_avatar").ok().flatten();
    let message_payload = json!({
        "id": message_id,
        "text": text,
        "attachmentUrl": attachment_url,
        "ts": ts
    });
    publish_realtime(
        &state,
        "messages",
        json!({
            "channel": channel_id,
            "data": {
                "type": "message",
                "channel": channel_id,
                "message": message_payload,
                "user": sender_name,
                "userAvatar": sender_avatar,
                "userId": claims.sub
            }
        }),
    )
    .await;
    if channel_input != channel_id {
        publish_realtime(
            &state,
            "messages",
            json!({
                "channel": channel_input,
                "data": {
                    "type": "message",
                    "channel": channel_input,
                    "message": message_payload,
                    "user": sender_name,
                    "userAvatar": sender_avatar,
                    "userId": claims.sub
                }
            }),
        )
        .await;
    }
    let _ = process_message_side_effects(
        state.clone(),
        &channel_id,
        &channel_name,
        &channel_type,
        server_id.as_deref(),
        &claims.sub,
        &sender_name,
        &message_id,
        body.content.as_deref().unwrap_or_default(),
    )
    .await;
    ok(
        json!({ "message": { "id": message_id, "text": text, "attachmentUrl": attachment_url, "ts": ts } }),
    )
}
async fn socket_info(
    State(state): State<SharedState>,
    Query(query): Query<HashMap<String, String>>,
) -> Json<Value> {
    let channel = query.get("channel").cloned().unwrap_or_default();
    let response = state
        .http
        .get(format!(
            "{}/socket-info?channel={}",
            state.config.realtime_base_http.trim_end_matches('/'),
            url::form_urlencoded::byte_serialize(channel.as_bytes()).collect::<String>()
        ))
        .send()
        .await;
    let exists = match response {
        Ok(response) => response
            .json::<Value>()
            .await
            .ok()
            .and_then(|value| value.get("exists").and_then(Value::as_bool))
            .unwrap_or(false),
        Err(_) => false,
    };
    ok(json!({ "exists": exists, "wsUrl": state.config.realtime_base_ws, "channel": channel }))
}
async fn delete_message(
    State(state): State<SharedState>,
    headers: HeaderMap,
    AxumPath(message_id): AxumPath<String>,
) -> Json<Value> {
    let claims = match auth_claims(&headers, &state) {
        Ok(claims) => claims,
        Err(_) => return error_body("Unauthorized"),
    };
    let message = sqlx::query("SELECT user_id::text AS user_id, channel_id::text AS channel_id FROM messages WHERE id=$1::uuid")
        .bind(&message_id)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten();
    let Some(message) = message else {
        return error_body("Message not found");
    };
    let user_id: String = message.try_get("user_id").unwrap_or_default();
    if user_id != claims.sub {
        return error_body("Unauthorized");
    }
    let channel_id: String = message.try_get("channel_id").unwrap_or_default();
    let _ = sqlx::query("DELETE FROM messages WHERE id=$1::uuid")
        .bind(&message_id)
        .execute(&state.pool)
        .await;
    publish_realtime(
        &state,
        "messages",
        json!({ "channel": channel_id, "data": { "type": "message_delete", "channel": channel_id, "messageId": message_id } }),
    )
    .await;
    ok(json!({ "success": true }))
}

#[derive(Deserialize)]
struct EditMessageBody {
    content: Option<String>,
}

async fn edit_message(
    State(state): State<SharedState>,
    headers: HeaderMap,
    AxumPath(message_id): AxumPath<String>,
    Json(body): Json<EditMessageBody>,
) -> Json<Value> {
    let claims = match auth_claims(&headers, &state) {
        Ok(claims) => claims,
        Err(_) => return error_body("Unauthorized"),
    };
    let Some(content) = body.content else {
        return error_body("Invalid content");
    };
    if content.is_empty() || content.len() > 5000 {
        return error_body("Invalid content");
    }
    let message = sqlx::query("SELECT user_id::text AS user_id, channel_id::text AS channel_id FROM messages WHERE id=$1::uuid")
        .bind(&message_id)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten();
    let Some(message) = message else {
        return error_body("Message not found");
    };
    let user_id: String = message.try_get("user_id").unwrap_or_default();
    if user_id != claims.sub {
        return error_body("Unauthorized");
    }
    let channel_id: String = message.try_get("channel_id").unwrap_or_default();
    let row =
        sqlx::query("UPDATE messages SET content=$1::text WHERE id=$2::uuid RETURNING created_at")
            .bind(&content)
            .bind(&message_id)
            .fetch_one(&state.pool)
            .await;
    let Ok(row) = row else {
        return error_body("Error updating message");
    };
    let ts = row
        .try_get::<chrono::DateTime<Utc>, _>("created_at")
        .map(|value| value.to_rfc3339())
        .unwrap_or_else(|_| Utc::now().to_rfc3339());
    publish_realtime(
        &state,
        "messages",
        json!({
            "channel": channel_id,
            "data": {
                "type": "message_update",
                "channel": channel_id,
                "message": { "id": message_id, "text": content, "ts": ts }
            }
        }),
    )
    .await;
    ok(json!({ "success": true, "message": { "id": message_id, "text": content } }))
}

async fn publish_realtime(state: &SharedState, channel: &str, payload: Value) {
    if let Ok(mut conn) = state.redis.get_multiplexed_async_connection().await {
        let _ = redis::cmd("PUBLISH")
            .arg(channel)
            .arg(payload.to_string())
            .query_async::<usize>(&mut conn)
            .await;
    }
}

async fn process_message_side_effects(
    state: SharedState,
    channel_id: &str,
    channel_name: &str,
    channel_type: &str,
    server_id: Option<&str>,
    sender_id: &str,
    sender_name: &str,
    message_id: &str,
    content: &str,
) -> Result<()> {
    if channel_type == "dm" {
        let members = sqlx::query("SELECT user_id::text AS user_id FROM channel_members WHERE channel_id=$1::uuid AND user_id!=$2::uuid")
            .bind(channel_id)
            .bind(sender_id)
            .fetch_all(&state.pool)
            .await?;
        for member in members {
            if let Ok(user_id) = member.try_get::<String, _>("user_id") {
                create_notification(
                    state.clone(),
                    &user_id,
                    "message",
                    message_id,
                    "dm",
                    &format!("New message from {}", sender_name),
                    Some(channel_id),
                    Some(json!({ "channelType": "dm" })),
                )
                .await?;
            }
        }
        return Ok(());
    }
    let Some(server_id) = server_id else {
        return Ok(());
    };
    let mention_re = Regex::new(r"@([a-zA-Z0-9_]+)").expect("valid regex");
    let unique_names = mention_re
        .captures_iter(content)
        .filter_map(|capture| capture.get(1).map(|value| value.as_str().to_string()))
        .collect::<HashSet<_>>();
    if unique_names.is_empty() {
        return Ok(());
    }
    let users = sqlx::query(
        "SELECT u.id::text AS id FROM users u JOIN server_members sm ON sm.user_id = u.id WHERE sm.server_id = $1::uuid AND u.username = ANY($2::text[])",
    )
    .bind(server_id)
    .bind(unique_names.into_iter().collect::<Vec<_>>())
    .fetch_all(&state.pool)
    .await?;
    for user in users {
        let user_id: String = user.try_get("id").unwrap_or_default();
        if user_id == sender_id {
            continue;
        }
        create_notification(
            state.clone(),
            &user_id,
            "mention",
            message_id,
            "message",
            &format!("You were mentioned by {} in #{}", sender_name, channel_name),
            Some(channel_id),
            Some(json!({ "channelName": channel_name, "serverId": server_id, "channelType": channel_type })),
        )
        .await?;
    }
    Ok(())
}

async fn create_notification(
    state: SharedState,
    user_id: &str,
    notif_type: &str,
    source_id: &str,
    source_type: &str,
    content: &str,
    channel_id: Option<&str>,
    channel_meta: Option<Value>,
) -> Result<()> {
    let row = sqlx::query(
        r#"
        WITH user_settings AS (
          SELECT COALESCE(notifications_quiet_mode, FALSE) AS quiet
          FROM users
          WHERE id = $1::uuid
        ),
        inserted AS (
          INSERT INTO notifications (user_id, type, source_id, source_type, content, channel_id)
          VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6::uuid)
          RETURNING id::text AS id, created_at
        )
        SELECT inserted.id, inserted.created_at, COALESCE(user_settings.quiet, FALSE) AS quiet
        FROM inserted
        LEFT JOIN user_settings ON TRUE
        "#,
    )
    .bind(user_id)
    .bind(notif_type)
    .bind(source_id)
    .bind(source_type)
    .bind(content)
    .bind(channel_id)
    .fetch_one(&state.pool)
    .await?;
    let notification_id: String = row.try_get("id")?;
    let created_at = row
        .try_get::<chrono::DateTime<Utc>, _>("created_at")
        .map(|value| value.to_rfc3339())
        .unwrap_or_else(|_| Utc::now().to_rfc3339());
    let quiet = row.try_get::<bool, _>("quiet").unwrap_or(false);
    let mut notification = json!({
        "id": notification_id,
        "type": notif_type,
        "sourceId": source_id,
        "sourceType": source_type,
        "channelId": channel_id,
        "content": content,
        "read": false,
        "ts": created_at,
        "quiet": quiet
    });
    if let Some(meta) = channel_meta {
        if let Some(channel_name) = meta.get("channelName") {
            notification["channelName"] = channel_name.clone();
        }
        if let Some(server_id) = meta.get("serverId") {
            notification["serverId"] = server_id.clone();
        }
        if let Some(channel_type) = meta.get("channelType") {
            notification["channelType"] = channel_type.clone();
        }
    }
    publish_realtime(
        &state,
        "messages",
        json!({
            "channel": format!("user:{}", user_id),
            "data": {
                "type": "notification",
                "notification": notification
            }
        }),
    )
    .await;
    Ok(())
}
async fn upload_file(
    State(state): State<SharedState>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Json<Value> {
    if auth_claims(&headers, &state).is_err() {
        return error_body("Unauthorized");
    }
    let Ok(Some(field)) = multipart.next_field().await else {
        return error_body("No file");
    };
    let file_name = field
        .file_name()
        .map(|value| value.to_string())
        .unwrap_or_else(|| "upload".to_string());
    let content_type = field
        .content_type()
        .map(|value| value.to_string())
        .unwrap_or_else(|| "application/octet-stream".to_string());
    let Ok(bytes) = field.bytes().await else {
        return error_body("Upload failed");
    };
    if bytes.len() > 50 * 1024 * 1024 {
        return error_body("File too large (max 50MB)");
    }
    let extension = Path::new(&file_name)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| format!(".{ext}"))
        .unwrap_or_default();
    let object_name = format!(
        "{}-{}{}",
        Utc::now().timestamp_millis(),
        random_string(8).to_lowercase(),
        extension
    );
    let put = state
        .s3
        .put_object()
        .bucket(state.config.s3.bucket_name.clone())
        .key(&object_name)
        .body(bytes.to_vec().into())
        .content_type(content_type)
        .send()
        .await;
    if put.is_err() {
        return error_body("Upload failed");
    }
    ok(json!({ "url": format!("{}/{}", state.config.s3.upload_base_url(), object_name) }))
}

async fn get_upload(State(state): State<SharedState>, AxumPath(key): AxumPath<String>) -> Response {
    let response = state
        .s3
        .get_object()
        .bucket(state.config.s3.bucket_name.clone())
        .key(&key)
        .send()
        .await;
    let Ok(response) = response else {
        return (StatusCode::NOT_FOUND, "Not found").into_response();
    };
    let content_type = response
        .content_type()
        .map(|value| value.to_string())
        .unwrap_or_else(|| "application/octet-stream".to_string());
    let bytes = response
        .body
        .collect()
        .await
        .map(|value| value.into_bytes())
        .unwrap_or_default();
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&content_type)
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=31536000"),
    );
    (headers, bytes).into_response()
}

async fn get_notifications(State(state): State<SharedState>, headers: HeaderMap) -> Json<Value> {
    let claims = match auth_claims(&headers, &state) {
        Ok(claims) => claims,
        Err(_) => return error_body("Unauthorized"),
    };
    let rows = sqlx::query(
        r#"
        SELECT n.id::text,
               n.type,
               n.source_id::text AS "sourceId",
               n.source_type AS "sourceType",
               n.channel_id::text AS "channelId",
               n.content,
               n.read,
               n.created_at AS ts,
               c.name AS "channelName",
               c.server_id::text AS "serverId",
               c.type AS "channelType"
        FROM notifications n
        LEFT JOIN channels c ON c.id = n.channel_id
        WHERE n.user_id = $1::uuid
        ORDER BY n.created_at DESC
        LIMIT 100
        "#,
    )
    .bind(&claims.sub)
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();
    ok(json!({
        "notifications": rows.into_iter().map(|row| json!({
            "id": row.try_get::<String,_>("id").unwrap_or_default(),
            "type": row.try_get::<String,_>("type").unwrap_or_default(),
            "sourceId": row.try_get::<Option<String>,_>("sourceId").ok().flatten(),
            "sourceType": row.try_get::<Option<String>,_>("sourceType").ok().flatten(),
            "channelId": row.try_get::<Option<String>,_>("channelId").ok().flatten(),
            "content": row.try_get::<Option<String>,_>("content").ok().flatten(),
            "read": row.try_get::<bool,_>("read").unwrap_or(false),
            "ts": row.try_get::<chrono::DateTime<Utc>,_>("ts").map(|value| value.to_rfc3339()).unwrap_or_else(|_| Utc::now().to_rfc3339()),
            "channelName": row.try_get::<Option<String>,_>("channelName").ok().flatten(),
            "serverId": row.try_get::<Option<String>,_>("serverId").ok().flatten(),
            "channelType": row.try_get::<Option<String>,_>("channelType").ok().flatten()
        })).collect::<Vec<_>>()
    }))
}

async fn mark_notification_read(
    State(state): State<SharedState>,
    headers: HeaderMap,
    AxumPath(notification_id): AxumPath<String>,
) -> Json<Value> {
    let claims = match auth_claims(&headers, &state) {
        Ok(claims) => claims,
        Err(_) => return error_body("Unauthorized"),
    };
    let _ = sqlx::query(
        "UPDATE notifications SET read = TRUE WHERE id = $1::uuid AND user_id = $2::uuid",
    )
    .bind(&notification_id)
    .bind(&claims.sub)
    .execute(&state.pool)
    .await;
    ok(json!({ "success": true }))
}

async fn mark_channel_notifications_read(
    State(state): State<SharedState>,
    headers: HeaderMap,
    AxumPath(channel_id): AxumPath<String>,
) -> Json<Value> {
    let claims = match auth_claims(&headers, &state) {
        Ok(claims) => claims,
        Err(_) => return error_body("Unauthorized"),
    };
    let _ = sqlx::query(
        "UPDATE notifications SET read = TRUE WHERE channel_id = $1::uuid AND user_id = $2::uuid",
    )
    .bind(&channel_id)
    .bind(&claims.sub)
    .execute(&state.pool)
    .await;
    ok(json!({ "success": true }))
}

async fn mark_all_notifications_read(
    State(state): State<SharedState>,
    headers: HeaderMap,
) -> Json<Value> {
    let claims = match auth_claims(&headers, &state) {
        Ok(claims) => claims,
        Err(_) => return error_body("Unauthorized"),
    };
    let _ = sqlx::query("UPDATE notifications SET read = TRUE WHERE user_id = $1::uuid")
        .bind(&claims.sub)
        .execute(&state.pool)
        .await;
    ok(json!({ "success": true }))
}

async fn delete_notification(
    State(state): State<SharedState>,
    headers: HeaderMap,
    AxumPath(notification_id): AxumPath<String>,
) -> Json<Value> {
    let claims = match auth_claims(&headers, &state) {
        Ok(claims) => claims,
        Err(_) => return error_body("Unauthorized"),
    };
    let _ = sqlx::query("DELETE FROM notifications WHERE id = $1::uuid AND user_id = $2::uuid")
        .bind(&notification_id)
        .bind(&claims.sub)
        .execute(&state.pool)
        .await;
    ok(json!({ "success": true }))
}

async fn stats_summary(State(state): State<SharedState>) -> Json<Value> {
    let users = count_query(&state.pool, "SELECT count(*) FROM users").await;
    let servers = count_query(&state.pool, "SELECT count(*) FROM servers").await;
    let messages = count_query(&state.pool, "SELECT count(*) FROM messages").await;
    let channels = count_query(&state.pool, "SELECT count(*) FROM channels").await;
    ok(json!({ "users": users, "servers": servers, "messages": messages, "channels": channels }))
}

async fn stats_activity(State(state): State<SharedState>) -> Json<Value> {
    let messages_per_hour = sqlx::query(
        "SELECT date_trunc('hour', created_at) as hour, count(*) as count FROM messages WHERE created_at > now() - interval '24 hours' GROUP BY hour ORDER BY hour ASC",
    )
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();
    let users_per_day = sqlx::query(
        "SELECT date_trunc('day', created_at) as day, count(*) as count FROM users WHERE created_at > now() - interval '7 days' GROUP BY day ORDER BY day ASC",
    )
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();
    ok(json!({
        "messagesPerHour": messages_per_hour.into_iter().map(|row| json!({
            "hour": row.try_get::<chrono::DateTime<Utc>,_>("hour").map(|value| value.to_rfc3339()).unwrap_or_else(|_| Utc::now().to_rfc3339()),
            "count": row.try_get::<i64,_>("count").unwrap_or(0).to_string()
        })).collect::<Vec<_>>(),
        "usersPerDay": users_per_day.into_iter().map(|row| json!({
            "day": row.try_get::<chrono::DateTime<Utc>,_>("day").map(|value| value.to_rfc3339()).unwrap_or_else(|_| Utc::now().to_rfc3339()),
            "count": row.try_get::<i64,_>("count").unwrap_or(0).to_string()
        })).collect::<Vec<_>>()
    }))
}

async fn stats_system(State(state): State<SharedState>) -> Json<Value> {
    let stats = state.request_stats.read().await.clone();
    let avg_latency = if stats.total_requests > 0 {
        stats.total_latency / stats.total_requests as f64
    } else {
        0.0
    };
    ok(json!({
        "uptime": 0,
        "memoryUsage": {
            "rss": 0,
            "heapTotal": 0,
            "heapUsed": 0,
            "external": 0
        },
        "cpuLoad": [],
        "requestStats": {
            "totalRequests": stats.total_requests,
            "totalLatency": stats.total_latency,
            "maxLatency": stats.max_latency,
            "startTime": stats.start_time,
            "avgLatency": avg_latency
        }
    }))
}

async fn stats_metrics(
    State(state): State<SharedState>,
    Query(query): Query<HashMap<String, String>>,
) -> Json<Value> {
    let range = query
        .get("range")
        .cloned()
        .unwrap_or_else(|| "1h".to_string());
    let (db_interval, step) = match range.as_str() {
        "10s" => ("2 minutes", "10 seconds"),
        "1m" => ("5 minutes", "10 seconds"),
        "10m" => ("10 minutes", "10 seconds"),
        "1h" => ("1 hour", "1 minute"),
        "12h" => ("12 hours", "5 minutes"),
        "1d" => ("1 day", "15 minutes"),
        "3d" => ("3 days", "1 hour"),
        "7d" => ("7 days", "4 hours"),
        _ => ("1 hour", "1 minute"),
    };
    let rows = sqlx::query(
        r#"
        SELECT
          date_bin($2::interval, created_at, TIMESTAMP '2000-01-01') as time,
          avg(cpu_load) as cpu,
          avg(memory_used) as memory,
          avg(disk_used) as disk,
          avg(avg_latency) as latency
        FROM system_metrics
        WHERE created_at > now() - $1::interval
        GROUP BY time
        ORDER BY time ASC
        "#,
    )
    .bind(db_interval)
    .bind(step)
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();
    ok(json!({
        "metrics": rows.into_iter().map(|row| json!({
            "time": row.try_get::<chrono::DateTime<Utc>,_>("time").map(|value| value.to_rfc3339()).unwrap_or_else(|_| Utc::now().to_rfc3339()),
            "cpu": format!("{:.2}", row.try_get::<Option<f64>,_>("cpu").ok().flatten().unwrap_or(0.0)),
            "memory": format!("{:.0}", row.try_get::<Option<f64>,_>("memory").ok().flatten().unwrap_or(0.0)),
            "disk": format!("{:.2}", row.try_get::<Option<f64>,_>("disk").ok().flatten().unwrap_or(0.0)),
            "latency": format!("{:.2}", row.try_get::<Option<f64>,_>("latency").ok().flatten().unwrap_or(0.0))
        })).collect::<Vec<_>>()
    }))
}

async fn count_query(pool: &PgPool, sql: &str) -> i64 {
    sqlx::query(sql)
        .fetch_one(pool)
        .await
        .ok()
        .and_then(|row| row.try_get::<i64, _>("count").ok())
        .unwrap_or(0)
}
