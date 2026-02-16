import http from "http"
import Redis, { Cluster } from "ioredis"
import { RawData, WebSocket, WebSocketServer } from "ws"

type Msg = {
  type: string
  channel?: string
  user?: string
  userId?: string
}

const port = Number(process.env.PORT || 4001)
const allowedOrigins = (process.env.WS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean)

let sub: Redis | Cluster
let pub: Redis | Cluster

if (process.env.REDIS_CLUSTER_NODES) {
  const nodes = process.env.REDIS_CLUSTER_NODES.split(",")
  sub = new Redis.Cluster(nodes)
  pub = new Redis.Cluster(nodes)
} else {
  const url = process.env.REDIS_URL || "redis://localhost:6379"
  sub = new Redis(url)
  pub = new Redis(url)
}

sub.on("error", (err) => {
  console.error("Redis subscriber error:", err)
})
pub.on("error", (err) => {
  console.error("Redis publisher error:", err)
})

const subs = new Map<string, Set<WebSocket>>()
const wsChannels = new Map<WebSocket, Set<string>>()
const wsAlive = new WeakMap<WebSocket, boolean>()
const lingerUntil = new Map<string, number>()
const lingerTimers = new Map<string, NodeJS.Timeout>()

function addSubscription(ws: WebSocket, channel: string) {
  const set = subs.get(channel) || new Set<WebSocket>()
  set.add(ws)
  subs.set(channel, set)

  const channels = wsChannels.get(ws) || new Set<string>()
  channels.add(channel)
  wsChannels.set(ws, channels)

  const lingerTimer = lingerTimers.get(channel)
  if (lingerTimer) {
    clearTimeout(lingerTimer)
    lingerTimers.delete(channel)
  }
  lingerUntil.delete(channel)
}

function removeSubscription(ws: WebSocket, channel: string) {
  const set = subs.get(channel)
  if (set) {
    set.delete(ws)
    if (set.size === 0) scheduleLinger(channel)
  }

  const channels = wsChannels.get(ws)
  channels?.delete(channel)
}

function removeAllSubscriptions(ws: WebSocket) {
  const channels = wsChannels.get(ws)
  if (!channels) return
  for (const channel of channels) {
    removeSubscription(ws, channel)
  }
  wsChannels.delete(ws)
}

function scheduleLinger(channel: string) {
  const until = Date.now() + 3000
  lingerUntil.set(channel, until)
  const existing = lingerTimers.get(channel)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    lingerUntil.delete(channel)
    lingerTimers.delete(channel)
  }, 3000)
  lingerTimers.set(channel, timer)
}

function publish(channel: string, data: unknown) {
  const set = subs.get(channel)
  if (!set || set.size === 0) return
  const payload = JSON.stringify(data)
  for (const ws of set) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload)
  }
}

function rawByteLength(raw: RawData): number {
  if (typeof raw === "string") return Buffer.byteLength(raw)
  if (raw instanceof ArrayBuffer) return raw.byteLength
  if (Array.isArray(raw)) return raw.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  return raw.byteLength
}

const server = http.createServer((req, res) => {
  if (!req.url) {
    res.statusCode = 404
    res.end("not found")
    return
  }
  const url = new URL(req.url, `http://localhost:${port}`)
  if (req.method === "GET" && url.pathname === "/health") {
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify({ ok: true, clients: wss.clients.size, channels: subs.size }))
    return
  }
  if (req.method === "GET" && url.pathname === "/ready") {
    const redisReady = sub.status === "ready" && pub.status === "ready"
    res.statusCode = redisReady ? 200 : 503
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify({ ok: redisReady, redis: { sub: sub.status, pub: pub.status } }))
    return
  }
  if (req.method === "GET" && url.pathname === "/socket-info") {
    const channel = url.searchParams.get("channel") || ""
    const set = subs.get(channel)
    const hasSubs = !!(set && set.size > 0)
    const exists = hasSubs || ((lingerUntil.get(channel) || 0) > Date.now())
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify({ exists }))
    return
  }
  res.statusCode = 404
  res.end("not found")
})

const wss = new WebSocketServer({ server, path: "/ws" })

sub.subscribe("messages", (err) => {
  if (err) console.error("Failed to subscribe to Redis channel: messages", err)
  else console.log("Subscribed to Redis channel: messages")
})

sub.on("message", (channel, message) => {
  if (channel !== "messages") return
  try {
    const parsed = JSON.parse(message) as { channel?: string; data?: unknown }
    if (parsed.channel && parsed.data) publish(parsed.channel, parsed.data)
  } catch (err) {
    console.error("Failed to parse Redis message:", err)
  }
})

wss.on("connection", (ws: WebSocket, req) => {
  const origin = req.headers.origin || ""
  if (allowedOrigins.length > 0 && origin && !allowedOrigins.includes(origin)) {
    ws.close(1008, "Origin not allowed")
    return
  }

  wsAlive.set(ws, true)

  ws.on("pong", () => {
    wsAlive.set(ws, true)
  })

  ws.on("message", (raw: RawData) => {
    if (rawByteLength(raw) > 2048) return

    let msg: Msg
    try {
      msg = JSON.parse(String(raw))
    } catch {
      return
    }

    if (msg.type === "subscribe" && msg.channel) {
      addSubscription(ws, msg.channel)
      ws.send(JSON.stringify({ type: "subscribed", channel: msg.channel }))
      return
    }

    if (msg.type === "unsubscribe" && msg.channel) {
      removeSubscription(ws, msg.channel)
      ws.send(JSON.stringify({ type: "unsubscribed", channel: msg.channel }))
      return
    }

    if (msg.type === "typing.start" && msg.channel && msg.user) {
      void pub.publish("messages", JSON.stringify({
        channel: msg.channel,
        data: { type: "typing", channel: msg.channel, user: msg.user, userId: msg.userId, active: true },
      }))
      return
    }

    if (msg.type === "typing.stop" && msg.channel && msg.user) {
      void pub.publish("messages", JSON.stringify({
        channel: msg.channel,
        data: { type: "typing", channel: msg.channel, user: msg.user, userId: msg.userId, active: false },
      }))
      return
    }
  })

  ws.on("close", () => {
    removeAllSubscriptions(ws)
    wsAlive.delete(ws)
  })
})

const heartbeatInterval = setInterval(() => {
  for (const ws of wss.clients) {
    const isAlive = wsAlive.get(ws) || false
    if (!isAlive) {
      removeAllSubscriptions(ws)
      ws.terminate()
      continue
    }
    wsAlive.set(ws, false)
    ws.ping()
  }
}, 30000)

server.listen(port, () => {
  console.log(`Realtime service listening on 0.0.0.0:${port}`)
})

async function shutdown(signal: string) {
  console.log(`Received ${signal}, shutting down realtime service`)
  clearInterval(heartbeatInterval)

  for (const timer of lingerTimers.values()) {
    clearTimeout(timer)
  }
  lingerTimers.clear()
  lingerUntil.clear()

  for (const ws of wss.clients) {
    try { ws.close(1001, "Server shutting down") } catch {}
  }

  await new Promise<void>((resolve) => {
    server.close(() => resolve())
  })

  await Promise.allSettled([sub.quit(), pub.quit()])
  process.exit(0)
}

process.once("SIGTERM", () => { void shutdown("SIGTERM") })
process.once("SIGINT", () => { void shutdown("SIGINT") })
