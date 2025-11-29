import type { User } from "./user"

export interface Channel {
  id: string
  name: string
  category: string
  serverId?: string
}

export interface Category {
  id: string
  name: string
  serverId?: string
}

export interface ChannelSection {
  title: string
  channels: string[] // Seems to be channel names or IDs based on usage
}

export interface DMChannel {
  id: string
  user: User
}