import Fastify from "fastify"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5432/safascord_test"

const { checkDatabaseConnection, checkRedisConnection, s3Send } = vi.hoisted(() => ({
  checkDatabaseConnection: vi.fn(),
  checkRedisConnection: vi.fn(),
  s3Send: vi.fn(),
}))

vi.mock("../lib/db.js", () => ({
  pool: { query: vi.fn() },
  checkDatabaseConnection,
}))

vi.mock("../lib/redis.js", () => ({
  checkRedisConnection,
}))

vi.mock("../lib/s3.js", () => ({
  s3: { send: s3Send },
  BUCKET_NAME: "uploads",
}))

vi.mock("../lib/auth.js", () => ({
  requireAdminUser: vi.fn().mockResolvedValue(null),
}))

import { miscRoutes } from "./misc.js"

async function createTestApp() {
  const app = Fastify({ logger: false })
  await app.register(miscRoutes)
  return app
}

describe("miscRoutes", () => {
  beforeEach(() => {
    process.env.ENABLE_DEBUG_ROUTES = "false"
    process.env.REALTIME_BASE_HTTP = "http://realtime.test"
    checkDatabaseConnection.mockResolvedValue(undefined)
    checkRedisConnection.mockResolvedValue(undefined)
    s3Send.mockResolvedValue(undefined)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("returns API health details", async () => {
    const app = await createTestApp()

    const response = await app.inject({ method: "GET", url: "/api/health" })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      ok: true,
      service: "api",
    })

    await app.close()
  })

  it("reports readiness when all dependencies are healthy", async () => {
    const app = await createTestApp()

    const response = await app.inject({ method: "GET", url: "/api/ready" })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      ok: true,
      checks: {
        database: true,
        redis: true,
        storage: true,
        realtime: true,
      },
    })

    await app.close()
  })

  it("fails readiness if a dependency check fails", async () => {
    checkRedisConnection.mockRejectedValueOnce(new Error("redis unavailable"))
    const app = await createTestApp()

    const response = await app.inject({ method: "GET", url: "/api/ready" })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({
      ok: false,
      checks: {
        database: true,
        redis: false,
        storage: true,
        realtime: true,
      },
    })

    await app.close()
  })
})
