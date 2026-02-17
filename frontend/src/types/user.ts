export type UserStatus = "online" | "idle" | "dnd" | "invisible"

export interface User {
  id: string
  username: string
  email?: string | null
  displayName?: string | null
  bio?: string | null
  bannerColor?: string | null
  bannerUrl?: string | null
  avatarUrl?: string | null
  customBackgroundUrl?: string | null
  customBackgroundOpacity?: number | null
  status?: UserStatus | string | null
  roleColor?: string
  discriminator?: string
  allowDmsFromStrangers?: boolean
  friendshipStatus?: 'none' | 'friends' | 'outgoing' | 'incoming' | 'blocked'
  friendRequestId?: string
  notificationsQuietMode?: boolean
}

export interface Notification {
  id: string
  type: 'mention' | 'message' | 'friend_request'
  sourceId: string
  sourceType: 'message' | 'friendship' | 'dm'
  channelId?: string
  channelName?: string
  channelType?: 'text' | 'dm' | string
  serverId?: string
  content?: string
  read: boolean
  ts: string
  quiet?: boolean
}
