import { create } from "zustand"
import type { ChannelSection, DM, Message, Server } from "@/types"

const MAX_CHANNEL_MESSAGE_CACHES = 50

type MessageCacheEntry = {
  messages: Message[]
  hasMore: boolean
  oldestTimestamp?: string
  loaded: boolean
  updatedAt: number
}

type CacheState = {
  ownerId?: string
  servers?: Server[]
  dms?: DM[]
  channelsByServer: Record<string, ChannelSection[]>
  messagesByChannel: Record<string, MessageCacheEntry>
  myRoleColorByServer: Record<string, string | undefined>
  setOwner: (ownerId?: string) => void
  clearAll: () => void
  setServers: (servers: Server[]) => void
  setDms: (dms: DM[]) => void
  setServerChannels: (serverId: string, sections: ChannelSection[]) => void
  setChannelMessages: (
    channelId: string,
    payload: { messages: Message[]; hasMore: boolean; oldestTimestamp?: string; loaded?: boolean }
  ) => void
  setMyRoleColorForServer: (serverId: string, color?: string) => void
}

function trimMessageCache(
  input: Record<string, MessageCacheEntry>,
  keepKey: string,
): Record<string, MessageCacheEntry> {
  const keys = Object.keys(input)
  if (keys.length <= MAX_CHANNEL_MESSAGE_CACHES) return input
  const sorted = keys.sort((a, b) => input[a].updatedAt - input[b].updatedAt)
  const oldest = sorted.find((key) => key !== keepKey)
  if (!oldest) return input

  const trimmed = { ...input }
  delete trimmed[oldest]
  return trimmed
}

const initialState = {
  ownerId: undefined as string | undefined,
  servers: undefined as Server[] | undefined,
  dms: undefined as DM[] | undefined,
  channelsByServer: {} as Record<string, ChannelSection[]>,
  messagesByChannel: {} as Record<string, MessageCacheEntry>,
  myRoleColorByServer: {} as Record<string, string | undefined>,
}

export const useAppCacheStore = create<CacheState>((set) => ({
  ...initialState,
  setOwner: (ownerId) =>
    set((state) => {
      if (state.ownerId === ownerId) return state
      return { ...initialState, ownerId }
    }),
  clearAll: () => set({ ...initialState }),
  setServers: (servers) => set({ servers }),
  setDms: (dms) => set({ dms }),
  setServerChannels: (serverId, sections) =>
    set((state) => ({
      channelsByServer: { ...state.channelsByServer, [serverId]: sections },
    })),
  setChannelMessages: (channelId, payload) =>
    set((state) => {
      const nextMessagesByChannel = {
        ...state.messagesByChannel,
        [channelId]: {
          messages: payload.messages,
          hasMore: payload.hasMore,
          oldestTimestamp: payload.oldestTimestamp,
          loaded: payload.loaded ?? true,
          updatedAt: Date.now(),
        },
      }

      return {
        messagesByChannel: trimMessageCache(nextMessagesByChannel, channelId),
      }
    }),
  setMyRoleColorForServer: (serverId, color) =>
    set((state) => ({
      myRoleColorByServer: { ...state.myRoleColorByServer, [serverId]: color },
    })),
}))
