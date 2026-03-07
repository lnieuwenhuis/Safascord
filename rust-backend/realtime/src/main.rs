use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::Result;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use futures::{SinkExt, StreamExt};
use redis::Client;
use safascord_core::config::AppConfig;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, Mutex, RwLock};
use tokio::time::sleep;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing::{error, info};

#[derive(Clone)]
struct RealtimeState {
    allowed_origins: Arc<Vec<String>>,
    clients: Arc<RwLock<HashMap<usize, ClientHandle>>>,
    channels: Arc<RwLock<HashMap<String, HashSet<usize>>>>,
    linger_until: Arc<RwLock<HashMap<String, Instant>>>,
    next_id: Arc<Mutex<usize>>,
    redis_client: Client,
    redis_ready: Arc<RwLock<bool>>,
}

#[derive(Clone)]
struct ClientHandle {
    sender: mpsc::UnboundedSender<Message>,
    channels: HashSet<String>,
}

#[derive(Debug, Deserialize)]
struct SocketInfoQuery {
    channel: Option<String>,
}

#[derive(Debug, Deserialize)]
struct WsMsg {
    #[serde(rename = "type")]
    msg_type: String,
    channel: Option<String>,
    user: Option<String>,
    #[serde(rename = "userId")]
    user_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct RedisEnvelope {
    channel: String,
    data: Value,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "safascord_realtime=info,tower_http=info".into()),
        )
        .init();

    let config = AppConfig::from_env_without_database(4001)?;
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
    let redis_client = Client::open(redis_url)?;
    let state = Arc::new(RealtimeState {
        allowed_origins: Arc::new(config.ws_allowed_origins.clone()),
        clients: Arc::new(RwLock::new(HashMap::new())),
        channels: Arc::new(RwLock::new(HashMap::new())),
        linger_until: Arc::new(RwLock::new(HashMap::new())),
        next_id: Arc::new(Mutex::new(1)),
        redis_client: redis_client.clone(),
        redis_ready: Arc::new(RwLock::new(false)),
    });

    spawn_redis_listener(state.clone()).await?;

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);
    let app = Router::new()
        .route("/health", get(health))
        .route("/ready", get(ready))
        .route("/socket-info", get(socket_info))
        .route("/ws", get(ws_handler))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], config.port));
    let listener = TcpListener::bind(addr).await?;
    info!("realtime listening on {}", addr);
    axum::serve(listener, app).await?;
    Ok(())
}

async fn spawn_redis_listener(state: Arc<RealtimeState>) -> Result<()> {
    let client = state.redis_client.clone();
    tokio::spawn(async move {
        loop {
            match client.get_async_pubsub().await {
                Ok(mut pubsub) => {
                    {
                        let mut ready = state.redis_ready.write().await;
                        *ready = true;
                    }
                    if let Err(err) = pubsub.subscribe("messages").await {
                        error!("redis subscribe failed: {err}");
                        let mut ready = state.redis_ready.write().await;
                        *ready = false;
                        sleep(Duration::from_secs(1)).await;
                        continue;
                    }
                    while let Some(msg) = pubsub.on_message().next().await {
                        let payload: String = match msg.get_payload() {
                            Ok(payload) => payload,
                            Err(err) => {
                                error!("redis payload error: {err}");
                                continue;
                            }
                        };
                        match serde_json::from_str::<RedisEnvelope>(&payload) {
                            Ok(env) => {
                                publish_to_channel(&state, &env.channel, Value::clone(&env.data))
                                    .await
                            }
                            Err(err) => error!("failed to parse redis envelope: {err}"),
                        }
                    }
                }
                Err(err) => {
                    error!("redis pubsub connection failed: {err}");
                    let mut ready = state.redis_ready.write().await;
                    *ready = false;
                    sleep(Duration::from_secs(1)).await;
                }
            }
        }
    });
    Ok(())
}

async fn health(State(state): State<Arc<RealtimeState>>) -> Json<Value> {
    let clients = state.clients.read().await.len();
    let channels = state.channels.read().await.len();
    Json(json!({ "ok": true, "clients": clients, "channels": channels }))
}

async fn ready(State(state): State<Arc<RealtimeState>>) -> Response {
    let ok = *state.redis_ready.read().await;
    let body = Json(json!({
        "ok": ok,
        "redis": {
            "sub": if ok { "ready" } else { "disconnected" },
            "pub": if ok { "ready" } else { "disconnected" }
        }
    }));
    if ok {
        body.into_response()
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, body).into_response()
    }
}

async fn socket_info(
    State(state): State<Arc<RealtimeState>>,
    Query(query): Query<SocketInfoQuery>,
) -> Json<Value> {
    let channel = query.channel.unwrap_or_default();
    let has_subs = {
        let channels = state.channels.read().await;
        channels
            .get(&channel)
            .map(|set| !set.is_empty())
            .unwrap_or(false)
    };
    let exists = if has_subs {
        true
    } else {
        state
            .linger_until
            .read()
            .await
            .get(&channel)
            .map(|deadline| *deadline > Instant::now())
            .unwrap_or(false)
    };
    Json(json!({ "exists": exists }))
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<RealtimeState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let origin = headers
        .get("origin")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    if !state.allowed_origins.is_empty()
        && !origin.is_empty()
        && !state.allowed_origins.iter().any(|item| item == origin)
    {
        return (StatusCode::FORBIDDEN, "Origin not allowed").into_response();
    }
    ws.on_upgrade(move |socket| handle_socket(state, socket))
}

async fn handle_socket(state: Arc<RealtimeState>, socket: WebSocket) {
    let (mut sink, mut stream) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
    let client_id = {
        let mut next = state.next_id.lock().await;
        let id = *next;
        *next += 1;
        id
    };

    {
        let mut clients = state.clients.write().await;
        clients.insert(
            client_id,
            ClientHandle {
                sender: tx.clone(),
                channels: HashSet::new(),
            },
        );
    }

    let writer = tokio::spawn(async move {
        while let Some(message) = rx.recv().await {
            if sink.send(message).await.is_err() {
                break;
            }
        }
    });

    while let Some(Ok(message)) = stream.next().await {
        match message {
            Message::Text(text) => {
                if text.len() > 2048 {
                    continue;
                }
                let Ok(msg) = serde_json::from_str::<WsMsg>(&text) else {
                    continue;
                };
                handle_ws_message(&state, client_id, msg).await;
            }
            Message::Close(_) => break,
            Message::Ping(payload) => {
                let _ = tx.send(Message::Pong(payload));
            }
            Message::Pong(_) => {}
            _ => {}
        }
    }

    cleanup_client(&state, client_id).await;
    writer.abort();
}

async fn handle_ws_message(state: &Arc<RealtimeState>, client_id: usize, msg: WsMsg) {
    match msg.msg_type.as_str() {
        "subscribe" => {
            if let Some(channel) = msg.channel {
                add_subscription(state, client_id, channel.clone()).await;
                send_to_client(
                    state,
                    client_id,
                    json!({ "type": "subscribed", "channel": channel }),
                )
                .await;
            }
        }
        "unsubscribe" => {
            if let Some(channel) = msg.channel {
                remove_subscription(state, client_id, &channel).await;
                send_to_client(
                    state,
                    client_id,
                    json!({ "type": "unsubscribed", "channel": channel }),
                )
                .await;
            }
        }
        "typing.start" => {
            if let (Some(channel), Some(user)) = (msg.channel, msg.user) {
                publish_typing(state, &channel, &user, msg.user_id.as_deref(), true).await;
            }
        }
        "typing.stop" => {
            if let (Some(channel), Some(user)) = (msg.channel, msg.user) {
                publish_typing(state, &channel, &user, msg.user_id.as_deref(), false).await;
            }
        }
        _ => {}
    }
}

async fn publish_typing(
    state: &Arc<RealtimeState>,
    channel: &str,
    user: &str,
    user_id: Option<&str>,
    active: bool,
) {
    let payload = json!({
        "channel": channel,
        "data": {
            "type": "typing",
            "channel": channel,
            "user": user,
            "userId": user_id,
            "active": active
        }
    });
    if let Ok(mut conn) = state.redis_client.get_multiplexed_async_connection().await {
        let publish_result: redis::RedisResult<usize> = redis::cmd("PUBLISH")
            .arg("messages")
            .arg(payload.to_string())
            .query_async(&mut conn)
            .await;
        let _ = publish_result;
    }
}

async fn add_subscription(state: &Arc<RealtimeState>, client_id: usize, channel: String) {
    {
        let mut channels = state.channels.write().await;
        channels
            .entry(channel.clone())
            .or_default()
            .insert(client_id);
    }
    {
        let mut clients = state.clients.write().await;
        if let Some(handle) = clients.get_mut(&client_id) {
            handle.channels.insert(channel.clone());
        }
    }
    state.linger_until.write().await.remove(&channel);
}

async fn remove_subscription(state: &Arc<RealtimeState>, client_id: usize, channel: &str) {
    let mut should_linger = false;
    {
        let mut channels = state.channels.write().await;
        if let Some(members) = channels.get_mut(channel) {
            members.remove(&client_id);
            should_linger = members.is_empty();
            if members.is_empty() {
                channels.remove(channel);
            }
        }
    }
    {
        let mut clients = state.clients.write().await;
        if let Some(handle) = clients.get_mut(&client_id) {
            handle.channels.remove(channel);
        }
    }
    if should_linger {
        state
            .linger_until
            .write()
            .await
            .insert(channel.to_string(), Instant::now() + Duration::from_secs(3));
    }
}

async fn cleanup_client(state: &Arc<RealtimeState>, client_id: usize) {
    let channels = {
        let mut clients = state.clients.write().await;
        clients
            .remove(&client_id)
            .map(|handle| handle.channels.into_iter().collect::<Vec<_>>())
            .unwrap_or_default()
    };
    for channel in channels {
        remove_subscription(state, client_id, &channel).await;
    }
}

async fn send_to_client(state: &Arc<RealtimeState>, client_id: usize, payload: Value) {
    let clients = state.clients.read().await;
    if let Some(handle) = clients.get(&client_id) {
        let _ = handle
            .sender
            .send(Message::Text(payload.to_string().into()));
    }
}

async fn publish_to_channel(state: &Arc<RealtimeState>, channel: &str, payload: Value) {
    let client_ids = {
        let channels = state.channels.read().await;
        channels
            .get(channel)
            .map(|set| set.iter().copied().collect::<Vec<_>>())
            .unwrap_or_default()
    };
    for client_id in client_ids {
        send_to_client(state, client_id, payload.clone()).await;
    }
}
