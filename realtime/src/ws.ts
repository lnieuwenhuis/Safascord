import { WebSocketServer, WebSocket, RawData } from "ws"
import http from "http"
import Redis, { Cluster } from "ioredis"

type Msg = { type: string; channel?: string; user?: string; userId?: string }

const port = Number(process.env.PORT || 4001)

// Redis Setup (Standalone or Cluster)
let redis: Redis | Cluster
if (process.env.REDIS_CLUSTER_NODES) {
  redis = new Redis.Cluster(process.env.REDIS_CLUSTER_NODES.split(","))
} else {
  redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379")
}

redis.subscribe("messages", (err) => {
  if (err) console.error("Failed to subscribe to Redis:", err)
  else console.log("Subscribed to Redis channel: messages")
})

redis.on("message", (channel, message) => {
  if (channel === "messages") {
    try {
      const parsed = JSON.parse(message) as { channel?: string; data?: any }
      if (parsed.channel && parsed.data) {
        publish(parsed.channel, parsed.data)
      }
    } catch (err) {
      console.error("Failed to parse Redis message:", err)
    }
  }
})

const server = http.createServer((req, res) => {
  if (!req.url) {
    res.statusCode = 404
    res.end("not found")
    return
  }
  const url = new URL(req.url, `http://localhost:${port}`)
  if (req.method === "GET" && url.pathname === "/health") {
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify({ ok: true }))
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

const subs = new Map<string, Set<WebSocket>>()
const lingerUntil = new Map<string, number>()
const lingerTimers = new Map<string, NodeJS.Timeout>()

function scheduleLinger(channel: string) {
  const until = Date.now() + 3000
  lingerUntil.set(channel, until)
  const existing = lingerTimers.get(channel)
  if (existing) clearTimeout(existing)
  const t = setTimeout(() => {
    lingerUntil.delete(channel)
    lingerTimers.delete(channel)
  }, 3000)
  lingerTimers.set(channel, t)
}

function publish(channel: string, data: any) {
  const set = subs.get(channel)
  if (!set) return
  const payload = JSON.stringify(data)
  for (const ws of set) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload)
  }
}

wss.on("connection", (ws: WebSocket) => {
  ws.on("message", (raw: RawData) => {
    let msg: Msg
    try { msg = JSON.parse(String(raw)) } catch { return }
    if (msg.type === "subscribe" && msg.channel) {
      const set = subs.get(msg.channel) || new Set<WebSocket>()
      set.add(ws)
      subs.set(msg.channel, set)
      const lt = lingerTimers.get(msg.channel)
      if (lt) { clearTimeout(lt); lingerTimers.delete(msg.channel) }
      lingerUntil.delete(msg.channel)
      ws.send(JSON.stringify({ type: "subscribed", channel: msg.channel }))
      return
    }
    if (msg.type === "unsubscribe" && msg.channel) {
      const set = subs.get(msg.channel)
      set?.delete(ws)
      if (set && set.size === 0) scheduleLinger(msg.channel)
      ws.send(JSON.stringify({ type: "unsubscribed", channel: msg.channel }))
      return
    }
    if (msg.type === "typing.start" && msg.channel && msg.user) {
      try {
        redis.publish("messages", JSON.stringify({ channel: msg.channel, data: { type: "typing", channel: msg.channel, user: msg.user, userId: msg.userId, active: true } }))
      } catch {}
      return
    }
    if (msg.type === "typing.stop" && msg.channel && msg.user) {
      try {
        redis.publish("messages", JSON.stringify({ channel: msg.channel, data: { type: "typing", channel: msg.channel, user: msg.user, userId: msg.userId, active: false } }))
      } catch {}
      return
    }
  })
  ws.on("close", () => {
    for (const [channel, set] of subs.entries()) {
      const removed = set.delete(ws)
      if (removed && set.size === 0) scheduleLinger(channel)
    }
  })
})

server.listen(port)
