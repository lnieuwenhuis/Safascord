process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5432/safascord_test"

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"

const originalEnv = { ...process.env }
let auth: typeof import("./auth.js")

beforeAll(async () => {
  auth = await import("./auth.js")
})

afterEach(() => {
  process.env = { ...originalEnv }
})

afterAll(() => {
  process.env = { ...originalEnv }
})

describe("auth helpers", () => {
  it("extracts bearer tokens safely", () => {
    expect(auth.getBearerToken("Bearer token-123")).toBe("token-123")
    expect(auth.getBearerToken("bearer token-456")).toBe("token-456")
    expect(auth.getBearerToken("Basic abc")).toBeNull()
    expect(auth.getBearerToken(undefined)).toBeNull()
  })

  it("enforces secure production runtime config", () => {
    process.env.NODE_ENV = "production"
    process.env.JWT_SECRET = "dev_change_me"
    process.env.CORS_ORIGINS = "https://app.example.com"

    expect(() => auth.assertSecureRuntimeConfig()).toThrow(/JWT_SECRET/)

    process.env.JWT_SECRET = "super-secret"
    process.env.CORS_ORIGINS = ""
    expect(() => auth.assertSecureRuntimeConfig()).toThrow(/CORS_ORIGINS/)

    process.env.CORS_ORIGINS = "https://app.example.com"
    process.env.ENABLE_DEBUG_ROUTES = "true"
    expect(() => auth.assertSecureRuntimeConfig()).toThrow(/ENABLE_DEBUG_ROUTES/)

    process.env.ENABLE_DEBUG_ROUTES = "false"
    expect(() => auth.assertSecureRuntimeConfig()).not.toThrow()
  })

  it("round-trips realtime tickets", () => {
    const ticket = auth.signRealtimeTicket(
      { sub: "user-1", username: "lars", displayName: "Lars" },
      "channel-1",
      "test-secret",
    )

    expect(auth.verifyRealtimeTicket(ticket, "test-secret")).toMatchObject({
      sub: "user-1",
      username: "lars",
      displayName: "Lars",
      scope: "realtime",
      channel: "channel-1",
    })
  })
})
