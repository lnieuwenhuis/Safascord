import type { 
  AuthResponse, 
  UserResponse, 
  ServersResponse, 
  ChannelsResponse, 
  MessagesResponse, 
  SocketInfoResponse, 
  MessageResponse, 
  ServerResponse, 
  BasicResponse, 
  RolesResponse, 
  RoleResponse, 
  ChannelResponse, 
  CategoryResponse, 
  InviteResponse, 
  FileUploadResponse,
  FriendResponse,
  FriendRequestsResponse,
  DMsResponse,
  DMResponse,
  StatsSummaryResponse,
  StatsActivityResponse,
  StatsSystemResponse,
  UserGroup,
  Notification
} from "@/types"

const configuredApiBase = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "")
const configuredWsBase = (import.meta.env.VITE_WS_BASE as string | undefined)?.replace(/\/$/, "")

export const API_BASE = configuredApiBase || (import.meta.env.DEV ? "http://localhost:4000/api" : "/api")
export const WS_BASE = configuredWsBase || (import.meta.env.DEV ? "ws://localhost:4001/ws" : `${window.location.protocol === "https:" ? "wss://" : "ws://"}${window.location.host}/ws`)

export function getFullUrl(url: string | null | undefined): string | null {
  if (!url) return null
  if (url.startsWith("http") || url.startsWith("data:")) return url
  if (url.startsWith("/api") && API_BASE.endsWith("/api")) {
    return `${API_BASE.slice(0, -4)}${url}`
  }
  return `${API_BASE}${url}`
}

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, opts)
  if (res.status === 401) {
    if (typeof window !== "undefined") window.dispatchEvent(new Event("auth:unauthorized"))
  }
  const isJson = (res.headers.get("content-type") || "").includes("application/json")
  const payload = isJson ? await res.json() : await res.text()
  if (!res.ok) {
    const err = typeof payload === "object" && payload && "error" in payload
      ? (() => {
          const p = payload as { error?: string; reason?: string }
          const errorText = String(p.error || res.status)
          const reasonText = p.reason ? String(p.reason) : ""
          return reasonText ? `${errorText}: ${reasonText}` : errorText
        })()
      : String(payload || res.status)
    throw new Error(err)
  }
  const method = (opts?.method || "GET").toUpperCase()
  if (method !== "GET") {
    getResponseCache.clear()
  }
  return payload as T
}

const inflightGetRequests = new Map<string, Promise<unknown>>()
const getResponseCache = new Map<string, { expiresAt: number; value: unknown }>()
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function getCacheTtlMs(path: string): number {
  if (path === "/servers") return 3000
  return 0
}

function getAuthorizationHeader(headers?: HeadersInit): string {
  if (!headers) return ""
  if (headers instanceof Headers) return headers.get("Authorization") || ""
  if (Array.isArray(headers)) {
    const found = headers.find(([k]) => k.toLowerCase() === "authorization")
    return found?.[1] || ""
  }
  const auth = (headers as Record<string, string>)["Authorization"] || (headers as Record<string, string>)["authorization"]
  return auth || ""
}

async function get<T>(path: string, opts?: RequestInit): Promise<T> {
  const method = (opts?.method || "GET").toUpperCase()
  if (method !== "GET") return request<T>(path, opts)

  const auth = getAuthorizationHeader(opts?.headers)
  const key = `${path}::${auth}`
  const cacheTtlMs = getCacheTtlMs(path)
  if (cacheTtlMs > 0) {
    const cached = getResponseCache.get(key)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value as T
    }
  }

  const existing = inflightGetRequests.get(key) as Promise<T> | undefined
  if (existing) return existing

  const pending = request<T>(path, opts)
    .then((data) => {
      if (cacheTtlMs > 0) {
        getResponseCache.set(key, { value: data, expiresAt: Date.now() + cacheTtlMs })
      }
      return data
    })
    .finally(() => {
      inflightGetRequests.delete(key)
    })
  inflightGetRequests.set(key, pending)
  return pending
}

export const api = {
  servers: (token?: string) => get<ServersResponse>("/servers", token ? { headers: { Authorization: `Bearer ${token}` } } : undefined),
  channels: (serverId?: string, token?: string) => get<ChannelsResponse>(`/channels${serverId ? `?serverId=${serverId}` : ""}`, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined),
  users: (serverId?: string, channelId?: string) => {
    const token = localStorage.getItem("token") || ""
    if (!token) return Promise.resolve({ groups: [] })
    if (serverId) return Promise.all([
      api.getServerMembers(token, serverId, channelId),
      api.getRoles(token, serverId),
    ]).then(([res, rolesRes]) => {
       // Group by roles
       // This logic should ideally be in the backend or a helper, but let's do it here to match existing interface
       // We need role names. The members endpoint returns roles as IDs.
       // We need to fetch roles to map IDs to names.
       // But UserList component expects groups.
       // Let's fetch roles too?
       // Or update getServerMembers to return groups?
       // Actually, `api.users` was a mock or older function?
       // Let's see where it was defined before.
       
       // It seems `api.users` is a custom helper we added.
       // Let's implement it properly.
             const roles = (rolesRes && rolesRes.roles) ? rolesRes.roles.sort((a, b) => a.position - b.position) : []
             const members = (res && res.members) ? res.members : []
             
             // Create map of roleId -> Role (unused but kept for future)
             // const roleMap = new Map(roles.map(r => [r.id, r]))
             
             // Group members
             // A member can have multiple roles. We usually group by their highest role.
             // Roles are sorted by position (asc? desc?). Discord sorts desc (highest position first).
             // Our backend sorts asc (0 is lowest?). Let's assume higher position = higher importance.
             
             // Sort roles desc
             const sortedRoles = [...roles].sort((a, b) => b.position - a.position)
             
             // Helper to find highest role for a member
             const getHighestRole = (memberRoles: string[]) => {
                 if (!memberRoles || memberRoles.length === 0) return null
                 for (const r of sortedRoles) {
                     if (memberRoles.includes(r.id)) return r
                 }
                 return null
             }
             
             const grouped = new Map<string, typeof members>()
             // Unused groups for now, but might be used if we implement hoists
             // const onlineMembers: typeof members = []
             // const offlineMembers: typeof members = []
             
             // Initialize groups for roles that should be hoisted (hoist=true)
             // We don't have 'hoist' property in our minimal role interface yet?
             // Let's assume all named roles are groups for now or just 'Online' / 'Offline' if we want simple.
             // But Discord groups by role.
             
             for (const r of sortedRoles) {
                 grouped.set(r.id, [])
             }
             grouped.set("online", [])
             grouped.set("offline", [])
 
             for (const m of members) {
               // We don't have online status in member object from getServerMembers yet (except maybe we do? check backend)
               // Backend returns: id, username, discriminator, displayName, avatarUrl, roles, muted
               // No status. We need status.
               // Update backend to return status?
               // Or assume online for now?
               // Let's put everyone in roles.
               
               const highest = getHighestRole(m.roles)
               if (highest) {
                   grouped.get(highest.id)?.push(m)
               } else {
                   grouped.get("online")?.push(m) // No role = online group (simplified)
               }
           }
           
           const result: UserGroup[] = []
           for (const r of sortedRoles) {
               const ms = grouped.get(r.id)
               if (ms && ms.length > 0) {
                   result.push({
                       id: r.id,
                       name: r.name,
                       color: r.color,
                       users: ms.map(x => ({ 
                           id: x.id, 
                           username: x.username, 
                           displayName: x.displayName, 
                           discriminator: x.discriminator,
                           avatarUrl: x.avatarUrl, 
                           status: "online", // placeholder
                           color: r.color 
                       }))
                   })
               }
           }
           
           const noRole = grouped.get("online")
           if (noRole && noRole.length > 0) {
               result.push({
                   id: "online",
                   name: "Online",
                   color: "#99aab5",
                   users: noRole.map(x => ({ 
                       id: x.id, 
                       username: x.username, 
                       displayName: x.displayName, 
                       discriminator: x.discriminator,
                       avatarUrl: x.avatarUrl, 
                       status: "online" 
                   }))
               })
           }
           
           // Filter out empty groups and ensure only users with access are shown
           // We already filtered users in the backend, so all users here have access.
           // Just filter out empty role groups.
           return { groups: result.filter(g => g.users.length > 0) }
    })
    return Promise.resolve({ groups: [] })
  },
  messages: (token: string, channel: string, limit = 50, before?: string, guildId?: string) => {
    let url = `/messages?channel=${encodeURIComponent(channel)}&limit=${limit}`
    if (before) url += `&before=${encodeURIComponent(before)}`
    if (guildId) url += `&serverId=${encodeURIComponent(guildId)}`
    return get<MessagesResponse>(url, { headers: { Authorization: `Bearer ${token}` } })
  },
  socketInfo: (channel: string) => get<SocketInfoResponse>(`/socket-info?channel=${encodeURIComponent(channel)}`),
  sendMessage: async (token: string, channel: string, content: string, guildId?: string, attachmentUrl?: string) => {
    return request<MessageResponse>("/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ channel, content, serverId: guildId, attachmentUrl }),
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
  authWithShoo: async (idToken: string) => {
    return request<AuthResponse>("/auth/shoo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
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
  createServer: async (token: string, name: string, description?: string, iconUrl?: string, bannerUrl?: string) => {
    return request<ServerResponse>("/servers", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name, description, iconUrl, bannerUrl }),
    })
  },
  renameServer: async (token: string, id: string, name?: string, description?: string, iconUrl?: string, bannerUrl?: string) => {
    return request<ServerResponse>(`/servers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name, description, iconUrl, bannerUrl }),
    })
  },
  deleteServer: async (token: string, id: string) => {
    return request<BasicResponse>(`/servers/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    })
  },
  leaveServer: async (token: string, id: string) => {
    return request<BasicResponse>(`/servers/${id}/members/me`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    })
  },
  getRoles: async (token: string, serverId: string) => {
    return get<RolesResponse>(`/servers/${serverId}/roles`, {
      headers: { Authorization: `Bearer ${token}` }
    })
  },
  createRole: async (token: string, serverId: string, data: { name: string; color: string; canManageChannels: boolean; canManageServer: boolean; canManageRoles: boolean; position?: number }) => {
    return request<RoleResponse>(`/servers/${serverId}/roles`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(data)
    })
  },
  updateRole: async (token: string, serverId: string, roleId: string, data: { name?: string; color?: string; position?: number; canManageChannels?: boolean; canManageServer?: boolean; canManageRoles?: boolean }) => {
    return request<RoleResponse>(`/servers/${serverId}/roles/${roleId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(data)
    })
  },
  updateMemberRole: async (token: string, serverId: string, userId: string, roleId: string) => {
    return request<BasicResponse>(`/servers/${serverId}/members/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ roleId })
    })
  },
  updateMemberRoles: async (token: string, serverId: string, userId: string, roles: string[]) => {
    return request<BasicResponse>(`/servers/${serverId}/members/${userId}/roles`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ roles })
    })
  },
  getMember: async (token: string, serverId: string, userId: string) => {
    return get<{ member: { roleId: string; roleName: string; roleColor: string; canManageRoles: boolean; roles?: { id: string; name: string; color: string; position: number }[] } | null }>(`/servers/${serverId}/members/${userId}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
  },
  getServerMembers: async (token: string, serverId: string, channelId?: string) => {
    const safeChannelId = channelId && UUID_RE.test(channelId) ? channelId : undefined
    const url = safeChannelId ? `/servers/${serverId}/members?channelId=${safeChannelId}` : `/servers/${serverId}/members`
    return get<{ members: { id: string; username: string; discriminator: string; displayName: string; avatarUrl: string; roles: string[]; muted: boolean }[] }>(url, {
      headers: { Authorization: `Bearer ${token}` }
    })
  },
  kickMember: async (token: string, serverId: string, userId: string) => {
    return request<BasicResponse>(`/servers/${serverId}/members/${userId}/kick`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    })
  },
  banMember: async (token: string, serverId: string, userId: string) => {
    return request<BasicResponse>(`/servers/${serverId}/members/${userId}/ban`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ userId })
    })
  },
  muteMember: async (token: string, serverId: string, userId: string, muted: boolean) => {
    return request<BasicResponse>(`/servers/${serverId}/members/${userId}/mute`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ muted })
    })
  },
  deleteRole: async (token: string, serverId: string, roleId: string) => {
    return request<BasicResponse>(`/servers/${serverId}/roles/${roleId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` }
    })
  },
  createChannel: async (token: string, serverId: string, name: string, category: string, permissions?: { roleId: string; canView: boolean; canSendMessages: boolean }[]) => {
    return request<ChannelResponse>("/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ serverId, name, category, permissions }),
    })
  },
  renameChannel: async (token: string, id: string, name: string, permissions?: { roleId: string; canView: boolean; canSendMessages: boolean }[]) => {
    return request<ChannelResponse>(`/channels/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name, permissions }),
    })
  },
  getChannelPermissions: async (token: string, id: string) => {
    return request<{ permissions: { roleId: string; canView: boolean; canSendMessages: boolean }[] }>(`/channels/${id}/permissions`, {
      headers: { Authorization: `Bearer ${token}` }
    })
  },
  deleteChannel: async (token: string, id: string) => {
    return request<BasicResponse>(`/channels/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    })
  },
  createCategory: async (token: string, serverId: string, name: string) => {
    return request<CategoryResponse>("/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ serverId, name }),
    })
  },
  renameCategory: async (token: string, id: string, name: string) => {
    return request<CategoryResponse>(`/categories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name }),
    })
  },
  deleteCategory: async (token: string, id: string) => {
    return request<BasicResponse>(`/categories/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    })
  },
  createInvite: async (token: string, serverId: string, opts?: { expiresInSeconds?: number; maxUses?: number }) => {
    return request<InviteResponse>(`/servers/${serverId}/invites`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(opts || {}),
    })
  },
  inviteInfo: async (code: string) => {
    return request<InviteResponse>(`/invites/${code}`)
  },
  acceptInvite: async (token: string, code: string) => {
    return request<{ success?: boolean; ok?: boolean; serverId?: string; error?: string }>(`/invites/${code}/accept`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    })
  },
  channelIdByName: (serverId: string, name: string) => get<{ id?: string; error?: string }>(`/channel-by-name?serverId=${encodeURIComponent(serverId)}&name=${encodeURIComponent(name)}`),
  uploadFile: async (token: string, file: File) => {
    const formData = new FormData()
    formData.append("file", file)
    return request<FileUploadResponse>("/upload", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    })
  },
  updateProfile: async (token: string, data: { bio?: string | null; bannerColor?: string | null; bannerUrl?: string | null; avatarUrl?: string | null; customBackgroundUrl?: string | null; customBackgroundOpacity?: number | null; status?: string | null; username?: string; displayName?: string; notificationsQuietMode?: boolean }) => {
    return request<UserResponse>("/me/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    })
  },
  getUserProfile: (token: string, userId: string) => get<UserResponse>(`/users/${userId}/profile`, { headers: { Authorization: `Bearer ${token}` } }),
  
  // Friend System
  getFriends: (token: string) => get<FriendResponse>("/friends", { headers: { Authorization: `Bearer ${token}` } }),
  getFriendRequests: (token: string) => get<FriendRequestsResponse>("/friends/requests", { headers: { Authorization: `Bearer ${token}` } }),
  sendFriendRequest: async (token: string, data: { username?: string; userId?: string }) => {
    return request<{ status?: string; error?: string }>("/friends/request", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(data)
    })
  },
  respondFriendRequest: async (token: string, requestId: string, action: 'accept' | 'decline') => {
    return request<BasicResponse>(`/friends/requests/${requestId}/${action}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    })
  },
  removeFriend: async (token: string, friendId: string) => {
    return request<BasicResponse>(`/friends/${friendId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` }
    })
  },
  
  // DM System
  getDMs: (token: string) => get<DMsResponse>("/dms", { headers: { Authorization: `Bearer ${token}` } }),
  createDM: async (token: string, userId: string) => {
    return request<DMResponse>("/dms", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ userId })
    })
  },

  // Notifications
  getNotifications: (token: string) => get<{ notifications: Notification[] }>("/notifications", { headers: { Authorization: `Bearer ${token}` } }),
  markNotificationRead: async (token: string, id: string) => {
    return request<BasicResponse>(`/notifications/${id}/read`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    })
  },
  markChannelNotificationsRead: async (token: string, channelId: string) => {
    return request<BasicResponse>(`/notifications/channel/${channelId}/read`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    })
  },
  markAllNotificationsRead: async (token: string) => {
    return request<BasicResponse>("/notifications/read-all", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    })
  },
  deleteNotification: async (token: string, id: string) => {
    return request<BasicResponse>(`/notifications/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` }
    })
  },

  // Messages
  deleteMessage: async (token: string, id: string) => {
    return request<BasicResponse>(`/messages/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` }
    })
  },
  editMessage: async (token: string, id: string, content: string) => {
    return request<MessageResponse>(`/messages/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ content })
    })
  },
  
  // Stats
  getStatsSummary: () => get<StatsSummaryResponse>("/stats/summary"),
  getStatsActivity: () => get<StatsActivityResponse>("/stats/activity"),
  getStatsSystem: () => get<StatsSystemResponse>("/stats/system"),
  getStatsMetrics: (range: string) => get<{ metrics: { time: string; cpu: string; memory: string; disk: string; latency: string }[] }>("/stats/metrics?range=" + range)
}
