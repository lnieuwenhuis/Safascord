export const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost/api"
export const WS_BASE = import.meta.env.VITE_WS_BASE || "ws://localhost/ws"

export type User = { id: string; username: string; email?: string | null; displayName?: string | null }
export type AuthResponse = { token?: string; user?: User; error?: string }
export type UserResponse = { user?: User; error?: string }

async function get<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, opts)
  if (!res.ok) throw new Error(String(res.status))
  return res.json()
}

export const api = {
  servers: (token?: string) => get<{ servers: { id: string; name: string }[] }>("/servers", token ? { headers: { Authorization: `Bearer ${token}` } } : undefined),
  channels: (serverId?: string) => get<{ sections: { title: string; channels: string[] }[] }>(`/channels${serverId ? `?serverId=${serverId}` : ""}`),
  users: (serverId?: string) => get<{ groups: { title: string; users: string[] }[] }>(`/users${serverId ? `?serverId=${serverId}` : ""}`),
  messages: (channel: string, limit = 50, before?: string) => get<{ messages: { id: string; user: string; text: string; ts: string }[] }>(`/messages?channel=${encodeURIComponent(channel)}&limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ""}`),
  socketInfo: (channel: string) => get<{ exists: boolean; wsUrl: string }>(`/socket-info?channel=${encodeURIComponent(channel)}`),
  sendMessage: async (token: string, channel: string, content: string) => {
    const res = await fetch(`${API_BASE}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ channel, content }),
    })
    if (!res.ok) throw new Error(String(res.status))
    return res.json() as Promise<{ message: { id: string; text: string; ts: string } }>
  },
  register: async (username: string, email: string, password: string, displayName?: string) => {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, email, password, displayName }),
    })
    if (!res.ok) throw new Error(String(res.status))
    return res.json() as Promise<AuthResponse>
  },
  login: async (identifier: string, password: string) => {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password }),
    })
    if (!res.ok) throw new Error(String(res.status))
    return res.json() as Promise<AuthResponse>
  },
  me: (token: string) => get<UserResponse>("/me", { headers: { Authorization: `Bearer ${token}` } }),
  updateDisplayName: async (token: string, displayName: string) => {
    const res = await fetch(`${API_BASE}/me/display-name`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ displayName }),
    })
    if (!res.ok) throw new Error(String(res.status))
    return res.json() as Promise<UserResponse>
  },
  createServer: async (token: string, name: string) => {
    const res = await fetch(`${API_BASE}/servers`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) throw new Error(String(res.status))
    return res.json() as Promise<{ server?: { id: string; name: string }; error?: string }>
  },
  renameServer: async (token: string, id: string, name: string) => {
    const res = await fetch(`${API_BASE}/servers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) throw new Error(String(res.status))
    return res.json() as Promise<{ server?: { id: string; name: string }; error?: string }>
  },
  deleteServer: async (token: string, id: string) => {
    const res = await fetch(`${API_BASE}/servers/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(String(res.status))
    return res.json() as Promise<{ ok?: boolean; error?: string }>
  },
  createChannel: async (token: string, serverId: string, name: string, category: string) => {
    const res = await fetch(`${API_BASE}/channels`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ serverId, name, category }),
    })
    if (!res.ok) throw new Error(String(res.status))
    return res.json() as Promise<{ channel?: { id: string; name: string; category: string }; error?: string }>
  },
  renameChannel: async (token: string, id: string, name: string) => {
    const res = await fetch(`${API_BASE}/channels/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) throw new Error(String(res.status))
    return res.json() as Promise<{ channel?: { id: string; name: string }; error?: string }>
  },
  deleteChannel: async (token: string, id: string) => {
    const res = await fetch(`${API_BASE}/channels/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(String(res.status))
    return res.json() as Promise<{ ok?: boolean; error?: string }>
  },
  createCategory: async (token: string, serverId: string, name: string) => {
    const res = await fetch(`${API_BASE}/categories`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ serverId, name }),
    })
    if (!res.ok) throw new Error(String(res.status))
    return res.json() as Promise<{ category?: { id: string; name: string }; error?: string }>
  },
  renameCategory: async (token: string, id: string, name: string) => {
    const res = await fetch(`${API_BASE}/categories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) throw new Error(String(res.status))
    return res.json() as Promise<{ category?: { id: string; name: string }; error?: string }>
  },
  deleteCategory: async (token: string, id: string) => {
    const res = await fetch(`${API_BASE}/categories/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(String(res.status))
    return res.json() as Promise<{ ok?: boolean; error?: string }>
  },
  createInvite: async (token: string, serverId: string, opts?: { expiresInSeconds?: number; maxUses?: number }) => {
    const res = await fetch(`${API_BASE}/servers/${serverId}/invites`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(opts || {}),
    })
    if (!res.ok) throw new Error(String(res.status))
    return res.json() as Promise<{ code?: string; error?: string }>
  },
  inviteInfo: async (code: string) => {
    const res = await fetch(`${API_BASE}/invites/${code}`)
    if (!res.ok) throw new Error(String(res.status))
    return res.json() as Promise<{ invite?: { code: string; serverId: string; serverName: string; expired: boolean; full: boolean } }>
  },
  acceptInvite: async (token: string, code: string) => {
    const res = await fetch(`${API_BASE}/invites/${code}/accept`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(String(res.status))
    return res.json() as Promise<{ ok?: boolean; error?: string }>
  },
  channelIdByName: (serverId: string, name: string) => get<{ id?: string; error?: string }>(`/channel-by-name?serverId=${encodeURIComponent(serverId)}&name=${encodeURIComponent(name)}`),
}
