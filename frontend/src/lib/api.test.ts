import { afterEach, describe, expect, it, vi } from "vitest"
import { API_BASE, api, getFullUrl } from "./api"

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  })
}

describe("getFullUrl", () => {
  it("normalizes relative API urls against the configured base", () => {
    const apiOrigin = API_BASE.endsWith("/api") ? API_BASE.slice(0, -4) : API_BASE

    expect(getFullUrl("/api/uploads/file.png")).toBe(`${apiOrigin}/api/uploads/file.png`)
    expect(getFullUrl("/avatars/user.png")).toBe(`${API_BASE}/avatars/user.png`)
  })

  it("preserves absolute http urls and blocks unsafe schemes", () => {
    expect(getFullUrl("https://cdn.example.com/avatar.png")).toBe("https://cdn.example.com/avatar.png")
    expect(getFullUrl("javascript:alert(1)")).toBeNull()
    expect(getFullUrl("data:text/plain,test")).toBeNull()
  })
})

describe("api caching", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("reuses cached GET responses for identical authenticated requests", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ servers: [{ id: "server-1" }] }))
      .mockResolvedValueOnce(jsonResponse({ token: "new-token" }))
      .mockResolvedValueOnce(jsonResponse({ servers: [{ id: "server-1" }] }))

    vi.stubGlobal("fetch", fetchMock)

    await api.servers("token-1")
    await api.servers("token-1")
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await api.login("lars", "super-secret")
    await api.servers("token-1")
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("dispatches an auth event when the API returns 401", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(
      { error: "Unauthorized" },
      { status: 401 },
    ))
    const unauthorizedListener = vi.fn()

    window.addEventListener("auth:unauthorized", unauthorizedListener)
    vi.stubGlobal("fetch", fetchMock)

    await expect(api.servers("token-401")).rejects.toThrow("Unauthorized")
    expect(unauthorizedListener).toHaveBeenCalledTimes(1)

    window.removeEventListener("auth:unauthorized", unauthorizedListener)
  })
})
