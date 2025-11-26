export const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost/api"
export const WS_BASE = import.meta.env.VITE_WS_BASE || "ws://localhost/ws"

export function getFullUrl(url: string | null | undefined): string | null {
  if (!url) return null
  if (url.startsWith("http") || url.startsWith("data:")) return url
  if (url.startsWith("/api") && API_BASE.endsWith("/api")) {
    return `${API_BASE.slice(0, -4)}${url}`
  }
  return `${API_BASE}${url}`
}

export type User = { 
  id: string; 
  username: string; 
  email?: string | null; 
  displayName?: string | null;
  bio?: string | null;
  bannerColor?: string | null;
  bannerUrl?: string | null;
  avatarUrl?: string | null;
  status?: string | null;
}
export type AuthResponse = { token?: string; user?: User; error?: string }
export type UserResponse = { user?: User; error?: string }

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, opts)
  if (res.status === 401) {
    if (typeof window !== "undefined") window.dispatchEvent(new Event("auth:unauthorized"))
  }
  if (!res.ok) throw new Error(String(res.status))
  return res.json()
}

async function get<T>(path: string, opts?: RequestInit): Promise<T> {
  return request<T>(path, opts)
}

export const api = {
  servers: (token?: string) => get<{ servers: { id: string; name: string }[] }>("/servers", token ? { headers: { Authorization: `Bearer ${token}` } } : undefined),
  channels: (serverId?: string) => get<{ sections: { title: string; channels: string[] }[] }>(`/channels${serverId ? `?serverId=${serverId}` : ""}`),
  users: (serverId?: string) => get<{ groups: { title: string; users: { username: string; displayName: string; avatarUrl: string; status: string }[] }[] }>(`/users${serverId ? `?serverId=${serverId}` : ""}`),
  messages: (channel: string, limit = 50, before?: string) => get<{ messages: { id: string; user: string; userAvatar?: string; userId?: string; text: string; ts: string }[] }>(`/messages?channel=${encodeURIComponent(channel)}&limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ""}`),
  socketInfo: (channel: string) => get<{ exists: boolean; wsUrl: string }>(`/socket-info?channel=${encodeURIComponent(channel)}`),
  sendMessage: async (token: string, channel: string, content: string) => {
    return request<{ message: { id: string; text: string; ts: string } }>("/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ channel, content }),
    })
  },
  register: async (username: string, email: string, password: string, displayName?: string) => {
    return request<AuthResponse>("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, email, password, displayName }),
    })
  },
  login: async (identifier: string, password: string) => {
    return request<AuthResponse>("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password }),
    })
  },
  me: (token: string) => get<UserResponse>("/me", { headers: { Authorization: `Bearer ${token}` } }),
  updateDisplayName: async (token: string, displayName: string) => {
    return request<UserResponse>("/me/display-name", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ displayName }),
    })
  },
  createServer: async (token: string, name: string) => {
    return request<{ server?: { id: string; name: string }; error?: string }>("/servers", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name }),
    })
  },
  renameServer: async (token: string, id: string, name: string) => {
    return request<{ server?: { id: string; name: string }; error?: string }>(`/servers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name }),
    })
  },
  deleteServer: async (token: string, id: string) => {
    return request<{ ok?: boolean; error?: string }>(`/servers/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    })
  },
  createChannel: async (token: string, serverId: string, name: string, category: string) => {
    return request<{ channel?: { id: string; name: string; category: string }; error?: string }>("/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ serverId, name, category }),
    })
  },
  renameChannel: async (token: string, id: string, name: string) => {
    return request<{ channel?: { id: string; name: string }; error?: string }>(`/channels/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name }),
    })
  },
  deleteChannel: async (token: string, id: string) => {
    return request<{ ok?: boolean; error?: string }>(`/channels/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    })
  },
  createCategory: async (token: string, serverId: string, name: string) => {
    return request<{ category?: { id: string; name: string }; error?: string }>("/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ serverId, name }),
    })
  },
  renameCategory: async (token: string, id: string, name: string) => {
    return request<{ category?: { id: string; name: string }; error?: string }>(`/categories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name }),
    })
  },
  deleteCategory: async (token: string, id: string) => {
    return request<{ ok?: boolean; error?: string }>(`/categories/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    })
  },
  createInvite: async (token: string, serverId: string, opts?: { expiresInSeconds?: number; maxUses?: number }) => {
    return request<{ code?: string; error?: string }>(`/servers/${serverId}/invites`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(opts || {}),
    })
  },
  inviteInfo: async (code: string) => {
    return request<{ invite?: { code: string; serverId: string; serverName: string; expired: boolean; full: boolean } }>(`/invites/${code}`)
  },
  acceptInvite: async (token: string, code: string) => {
    return request<{ ok?: boolean; error?: string }>(`/invites/${code}/accept`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    })
  },
  channelIdByName: (serverId: string, name: string) => get<{ id?: string; error?: string }>(`/channel-by-name?serverId=${encodeURIComponent(serverId)}&name=${encodeURIComponent(name)}`),
  uploadFile: async (token: string, file: File) => {
    const formData = new FormData()
    formData.append("file", file)
    return request<{ url: string; error?: string }>("/upload", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    })
  },
  updateProfile: async (token: string, data: { bio?: string | null; bannerColor?: string | null; bannerUrl?: string | null; avatarUrl?: string | null; status?: string | null }) => {
    return request<UserResponse>("/me/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    })
  },
}
