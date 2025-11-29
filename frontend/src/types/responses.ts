import type { User, UserStatus } from "./user"
import type { Server } from "./server"
import type { Role } from "./role"
import type { Channel, ChannelSection, Category } from "./channel"
import type { Message } from "./message"

export interface AuthResponse {
  token?: string
  user?: User
  error?: string
  isNew?: boolean
}

export interface UserResponse {
  user?: User
  error?: string
}

export interface UserSummary {
  id: string
  username: string
  displayName: string
  avatarUrl: string
  status: UserStatus | string
  roleColor?: string
  discriminator: string
}

export interface UserGroup {
  title: string
  users: UserSummary[]
}

export interface UsersListResponse {
    groups: UserGroup[]
}

export interface ServerResponse {
  server?: Server
  error?: string
}

export interface ServersResponse {
  servers: Server[]
  error?: string
}

export interface RoleResponse {
  role?: Role
  error?: string
}

export interface RolesResponse {
  roles: Role[]
  error?: string
}

export interface ChannelResponse {
  channel?: Channel
  error?: string
}

export interface ChannelsResponse {
    sections: ChannelSection[]
}

export interface CategoryResponse {
  category?: Category
  error?: string
}

export interface MessageResponse {
    message: Message
}

export interface MessagesResponse {
    messages: Message[]
}

export interface SocketInfoResponse {
    exists: boolean
    wsUrl: string
}

export interface InviteInfo {
    code: string
    serverId: string
    serverName: string
    expired: boolean
    full: boolean
}

export interface InviteResponse {
    code?: string
    error?: string
    invite?: InviteInfo
}

export interface FileUploadResponse {
    url: string
    error?: string
}

export interface BasicResponse {
    ok?: boolean
    error?: string
    left?: boolean
    serverDeleted?: boolean
}

export interface FriendResponse {
  friends: UserSummary[]
  error?: string
}

export interface FriendRequest {
  id: string
  type: 'incoming' | 'outgoing'
  user: UserSummary
}

export interface FriendRequestsResponse {
  requests: FriendRequest[]
  error?: string
}

export interface DM {
  id: string
  user: UserSummary
}

export interface DMsResponse {
  dms: DM[]
  error?: string
}

export interface DMResponse {
  id?: string
  error?: string
}
