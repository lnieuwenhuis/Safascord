import type { 
  AuthResponse, 
  UserResponse, 
  ServersResponse, 
  ChannelsResponse, 
  UsersListResponse, 
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
  StatsSystemResponse
} from "@/types"

export const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? "http://localhost/api" : "/api")
export const WS_BASE = import.meta.env.VITE_WS_BASE || (import.meta.env.DEV ? "ws://localhost/ws" : `${window.location.protocol === "https:" ? "wss://" : "ws://"}${window.location.host}/ws`)

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
  if (!res.ok) throw new Error(String(res.status))
  return res.json()
}

async function get<T>(path: string, opts?: RequestInit): Promise<T> {
  return request<T>(path, opts)
}

export const api = {
  servers: (token?: string) => get<ServersResponse>("/servers", token ? { headers: { Authorization: `Bearer ${token}` } } : undefined),
  channels: (serverId?: string, token?: string) => get<ChannelsResponse>(`/channels${serverId ? `?serverId=${serverId}` : ""}`, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined),
  users: (serverId?: string) => get<UsersListResponse>(`/users${serverId ? `?serverId=${serverId}` : ""}`),
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
  getAuthUrl: async (redirectUri: string) => {
    return request<{ url: string; error?: string }>(`/auth/workos-url?redirectUri=${encodeURIComponent(redirectUri)}`)
  },
  authWithCode: async (code: string) => {
    return request<AuthResponse>("/auth/workos-callback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
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
    return request<RolesResponse>(`/servers/${serverId}/roles`, {
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
    return request<{ member: { roleId: string; roleName: string; roleColor: string; canManageRoles: boolean; roles?: { id: string; name: string; color: string; position: number }[] } | null }>(`/servers/${serverId}/members/${userId}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
  },
  getServerMembers: async (token: string, serverId: string) => {
    return request<{ members: { id: string; username: string; discriminator: string; displayName: string; avatarUrl: string; roles: string[]; muted: boolean }[] }>(`/servers/${serverId}/members`, {
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
  getNotifications: (token: string) => get<{ notifications: any[] }>("/notifications", { headers: { Authorization: `Bearer ${token}` } }),
  markNotificationRead: async (token: string, id: string) => {
    return request<BasicResponse>(`/notifications/${id}/read`, {
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
