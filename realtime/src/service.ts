import http from "http"
import jwt from "jsonwebtoken"
import { RawData, WebSocket, WebSocketServer } from "ws"

export type Msg = {
  type: string
  channel?: string
}

export type RealtimeTicketPayload = {
  sub: string
  username?: string
  displayName?: string
  avatarUrl?: string
  scope: "realtime"
  channel: string
}

export type RealtimePubSubClient = {
  status?: string
  on(event: string, listener: (...args: unknown[]) => void): unknown
  subscribe(...args: unknown[]): unknown
  publish(channel: string, message: string): Promise<unknown> | unknown
  quit(): Promise<unknown> | unknown
}

export type RealtimeServiceOptions = {
  port?: number
  allowedOrigins?: string[]
  jwtSecret: string
  sub: RealtimePubSubClient
  pub: RealtimePubSubClient
  lingerMs?: number
  heartbeatMs?: number
  logger?: Pick<Console, "log" | "error">
}

export const DEFAULT_JWT_SECRET = "dev_change_me"
export const MIN_JWT_SECRET_LENGTH = 32
export const REALTIME_TICKET_AUDIENCE = "realtime"
export const REALTIME_TICKET_ISSUER = "api"

export function readJwtSecret(value = process.env.JWT_SECRET || DEFAULT_JWT_SECRET) {
  return value.trim()
}

export function isStrongJwtSecret(secret: string) {
  return secret !== DEFAULT_JWT_SECRET && secret.length >= MIN_JWT_SECRET_LENGTH
}

export function readAllowedOrigins(value = process.env.WS_ALLOWED_ORIGINS || "") {
  return value
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
}

export function isProductionLike() {
  const env = (process.env.NODE_ENV || process.env.APP_ENV || process.env.ENVIRONMENT || "").toLowerCase()
  return env === "production" || env === "staging"
}

export function assertRealtimeRuntimeConfig(jwtSecret: string) {
  if (isProductionLike() && !isStrongJwtSecret(jwtSecret)) {
    throw new Error(
      `JWT_SECRET must be set to a strong value with at least ${MIN_JWT_SECRET_LENGTH} characters in production-like environments`,
    )
  }
}

export function verifyRealtimeTicket(token: string, jwtSecret: string) {
  const payload = jwt.verify(token, jwtSecret, {
    audience: REALTIME_TICKET_AUDIENCE,
    issuer: REALTIME_TICKET_ISSUER,
  }) as jwt.JwtPayload | string

  if (
    typeof payload === "string" ||
    payload.scope !== "realtime" ||
    typeof payload.sub !== "string" ||
    typeof payload.channel !== "string"
  ) {
    throw new Error("Invalid realtime ticket")
  }

  return {
    sub: payload.sub,
    username: typeof payload.username === "string" ? payload.username : undefined,
    displayName: typeof payload.displayName === "string" ? payload.displayName : undefined,
    avatarUrl: typeof payload.avatarUrl === "string" ? payload.avatarUrl : undefined,
    scope: "realtime" as const,
    channel: payload.channel,
  }
}

export function rawByteLength(raw: RawData): number {
  if (typeof raw === "string") return Buffer.byteLength(raw)
  if (raw instanceof ArrayBuffer) return raw.byteLength
  if (Array.isArray(raw)) return raw.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  return raw.byteLength
}

export function createRealtimeService({
  port = Number(process.env.PORT || 4001),
  allowedOrigins = readAllowedOrigins(),
  jwtSecret,
  sub,
  pub,
  lingerMs = 3000,
  heartbeatMs = 30000,
  logger = console,
}: RealtimeServiceOptions) {
  assertRealtimeRuntimeConfig(jwtSecret)

  const subs = new Map<string, Set<WebSocket>>()
  const wsChannels = new Map<WebSocket, Set<string>>()
  const wsAlive = new WeakMap<WebSocket, boolean>()
  const wsAuth = new WeakMap<WebSocket, RealtimeTicketPayload>()
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

  function scheduleLinger(channel: string) {
    const until = Date.now() + lingerMs
    lingerUntil.set(channel, until)
    const existing = lingerTimers.get(channel)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      const set = subs.get(channel)
      if (set && set.size === 0) subs.delete(channel)
      lingerUntil.delete(channel)
      lingerTimers.delete(channel)
    }, lingerMs)
    lingerTimers.set(channel, timer)
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

  function publish(channel: string, data: unknown) {
    const set = subs.get(channel)
    if (!set || set.size === 0) return
    const payload = JSON.stringify(data)
    for (const ws of set) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload)
    }
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
    res.statusCode = 404
    res.end("not found")
  })

  const wss = new WebSocketServer({ server, path: "/ws" })

  sub.on("error", (err) => {
    logger.error("Redis subscriber error:", err)
  })
  pub.on("error", (err) => {
    logger.error("Redis publisher error:", err)
  })

  sub.subscribe("messages", (err?: unknown) => {
    if (err) logger.error("Failed to subscribe to Redis channel: messages", err)
    else logger.log("Subscribed to Redis channel: messages")
  })

  sub.on("message", (channel, message) => {
    if (channel !== "messages") return
    try {
      const parsed = JSON.parse(String(message)) as { channel?: string; data?: unknown }
      if (parsed.channel && parsed.data) publish(parsed.channel, parsed.data)
    } catch (err) {
      logger.error("Failed to parse Redis message:", err)
    }
  })

  wss.on("connection", (ws: WebSocket, req) => {
    const origin = req.headers.origin || ""
    if (allowedOrigins.length > 0 && origin && !allowedOrigins.includes(origin)) {
      ws.close(1008, "Origin not allowed")
      return
    }

    try {
      const url = new URL(req.url || "", `http://localhost:${port}`)
      const ticket = url.searchParams.get("ticket") || ""
      const auth = verifyRealtimeTicket(ticket, jwtSecret)
      wsAuth.set(ws, auth)
    } catch {
      ws.close(1008, "Unauthorized")
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

      const auth = wsAuth.get(ws)
      if (!auth) {
        ws.close(1008, "Unauthorized")
        return
      }

      const scopedChannel = auth.channel

      if (msg.channel && msg.channel !== scopedChannel) {
        ws.close(1008, "Forbidden")
        return
      }

      if (msg.type === "subscribe") {
        addSubscription(ws, scopedChannel)
        ws.send(JSON.stringify({ type: "subscribed", channel: scopedChannel }))
        return
      }

      if (msg.type === "unsubscribe") {
        removeSubscription(ws, scopedChannel)
        ws.send(JSON.stringify({ type: "unsubscribed", channel: scopedChannel }))
        return
      }

      if (msg.type === "typing.start") {
        void pub.publish("messages", JSON.stringify({
          channel: scopedChannel,
          data: {
            type: "typing",
            channel: scopedChannel,
            user: auth.displayName || auth.username || "User",
            userId: auth.sub,
            active: true,
          },
        }))
        return
      }

      if (msg.type === "typing.stop") {
        void pub.publish("messages", JSON.stringify({
          channel: scopedChannel,
          data: {
            type: "typing",
            channel: scopedChannel,
            user: auth.displayName || auth.username || "User",
            userId: auth.sub,
            active: false,
          },
        }))
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
  }, heartbeatMs)

  async function listen() {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(port, () => {
        server.off("error", reject)
        resolve()
      })
    })
    logger.log(`Realtime service listening on 0.0.0.0:${port}`)
  }

  async function shutdown(signal = "SIGTERM") {
    logger.log(`Received ${signal}, shutting down realtime service`)
    clearInterval(heartbeatInterval)

    for (const timer of lingerTimers.values()) {
      clearTimeout(timer)
    }
    lingerTimers.clear()
    lingerUntil.clear()

    for (const ws of wss.clients) {
      try {
        ws.close(1001, "Server shutting down")
      } catch {
        // best-effort close
      }
    }

    await new Promise<void>((resolve) => {
      server.close(() => resolve())
    })

    await Promise.allSettled([Promise.resolve(sub.quit()), Promise.resolve(pub.quit())])
  }

  return {
    listen,
    shutdown,
    server,
    wss,
  }
}
