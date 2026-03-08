import { EventEmitter } from "node:events"
import jwt from "jsonwebtoken"
import { WebSocket } from "ws"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  REALTIME_TICKET_AUDIENCE,
  REALTIME_TICKET_ISSUER,
  createRealtimeService,
  rawByteLength,
  verifyRealtimeTicket,
  type RealtimePubSubClient,
} from "./service.js"

class FakeRedisClient extends EventEmitter implements RealtimePubSubClient {
  status = "ready"
  publishes: Array<{ channel: string; message: string }> = []
  subscriptions: string[] = []

  subscribe(channel: string, callback?: (err: Error | null) => void) {
    this.subscriptions.push(channel)
    callback?.(null)
  }

  publish(channel: string, message: string) {
    this.publishes.push({ channel, message })
    return Promise.resolve(1)
  }

  quit() {
    this.status = "end"
    return Promise.resolve("OK")
  }
}

function waitForMessage(ws: WebSocket) {
  return new Promise<string>((resolve, reject) => {
    ws.once("message", (data) => resolve(String(data)))
    ws.once("error", reject)
  })
}

function waitForOpen(ws: WebSocket) {
  return new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve())
    ws.once("error", reject)
  })
}

describe("realtime helpers", () => {
  it("verifies signed realtime tickets", () => {
    const token = jwt.sign(
      {
        sub: "user-1",
        username: "lars",
        scope: "realtime",
        channel: "dm-1",
        aud: REALTIME_TICKET_AUDIENCE,
        iss: REALTIME_TICKET_ISSUER,
      },
      "test-secret",
      { expiresIn: "2m" },
    )

    expect(verifyRealtimeTicket(token, "test-secret")).toMatchObject({
      sub: "user-1",
      username: "lars",
      scope: "realtime",
      channel: "dm-1",
    })
  })

  it("measures raw websocket payload size", () => {
    expect(rawByteLength("hello")).toBe(5)
    expect(rawByteLength(new TextEncoder().encode("hello").buffer)).toBe(5)
    expect(rawByteLength([Buffer.from("hi"), Buffer.from("there")])).toBe(7)
  })
})

describe("realtime service", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("serves health and accepts authenticated websocket subscriptions", async () => {
    const sub = new FakeRedisClient()
    const pub = new FakeRedisClient()
    const logger = { log: vi.fn(), error: vi.fn() }
    const service = createRealtimeService({
      port: 0,
      allowedOrigins: [],
      jwtSecret: "test-secret",
      sub,
      pub,
      heartbeatMs: 1_000,
      logger,
    })

    await service.listen()

    const address = service.server.address()
    if (!address || typeof address === "string") {
      throw new Error("Expected an ephemeral TCP port")
    }

    const healthResponse = await fetch(`http://127.0.0.1:${address.port}/health`)
    expect(healthResponse.ok).toBe(true)
    await expect(healthResponse.json()).resolves.toMatchObject({ ok: true })

    const readyResponse = await fetch(`http://127.0.0.1:${address.port}/ready`)
    expect(readyResponse.status).toBe(200)

    const ticket = jwt.sign(
      {
        sub: "user-1",
        username: "lars",
        displayName: "Lars",
        scope: "realtime",
        channel: "dm-1",
        aud: REALTIME_TICKET_AUDIENCE,
        iss: REALTIME_TICKET_ISSUER,
      },
      "test-secret",
      { expiresIn: "2m" },
    )
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws?ticket=${ticket}`)

    await waitForOpen(ws)
    ws.send(JSON.stringify({ type: "subscribe" }))
    await expect(waitForMessage(ws)).resolves.toBe(JSON.stringify({ type: "subscribed", channel: "dm-1" }))

    ws.send(JSON.stringify({ type: "typing.start" }))
    await vi.waitFor(() => {
      expect(pub.publishes).toHaveLength(1)
    })

    ws.close()
    await service.shutdown("test")
  })
})
