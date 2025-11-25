import { WebSocketServer, WebSocket, RawData } from "ws"
import http from "http"

type Msg = { type: string; channel?: string; user?: string; userId?: string }

const port = Number(process.env.PORT || 4001)
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
  if (req.method === "POST" && url.pathname === "/publish") {
    let body = ""
    req.on("data", (chunk) => { body += chunk })
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body || "{}") as { channel?: string; data?: any }
        const channel = parsed.channel || ""
        if (channel && parsed.data) publish(channel, parsed.data)
        res.setHeader("Content-Type", "application/json")
        res.end(JSON.stringify({ ok: true }))
      } catch {
        res.statusCode = 400
        res.end("bad request")
      }
    })
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
      publish(msg.channel, { type: "typing", channel: msg.channel, user: msg.user, userId: msg.userId, active: true })
      return
    }
    if (msg.type === "typing.stop" && msg.channel && msg.user) {
      publish(msg.channel, { type: "typing", channel: msg.channel, user: msg.user, userId: msg.userId, active: false })
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
