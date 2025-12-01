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
  status?: UserStatus | string | null
  roleColor?: string
  discriminator?: string
  allowDmsFromStrangers?: boolean
  friendshipStatus?: 'none' | 'friends' | 'outgoing' | 'incoming' | 'blocked'
  friendRequestId?: string
}
