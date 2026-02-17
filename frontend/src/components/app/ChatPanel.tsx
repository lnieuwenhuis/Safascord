import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Hash, MessageSquare, Menu, Users, Pencil, Trash, Plus, X, FileIcon } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { api, getFullUrl } from "@/lib/api"
import { useAuth } from "@/hooks/useAuth"
import { cn } from "@/lib/utils"
import { useNotifications } from "../NotificationProvider"
import UserProfilePopover from "./UserProfilePopover"
import type { Message, UserSummary } from "@/types"
import { useAppCacheStore } from "@/stores/cacheStore"

interface ChatPanelProps {
  variant: "guild" | "dm"
  channelName: string
  channelId?: string
  guildName?: string
  guildId?: string
  onMobileMenu?: () => void
  onUserListToggle?: () => void
  showUserList?: boolean
  canSend?: boolean
  dmUser?: UserSummary
}

const PAGE_SIZE = 30
const INITIAL_FILL_MAX_PAGES = 4
const TOP_FETCH_THRESHOLD_PX = 72
const BOTTOM_STICKY_THRESHOLD_PX = 96
const LOAD_MORE_COOLDOWN_MS = 350

type AttachmentMode = "image" | "video" | "file"

function detectAttachmentMode(url: string): AttachmentMode {
  if (/\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?|$)/i.test(url)) return "image"
  if (/\.(mp4|webm|mov|m4v|ogg|ogv)(\?|$)/i.test(url)) return "video"
  return "file"
}

function MessageSkeletonRows({ count }: { count: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: count }).map((_, index) => (
        <div key={`skeleton-${index}`} className="flex animate-pulse items-start gap-3">
          <div className="h-8 w-8 rounded-full bg-slate-800" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3 w-32 rounded bg-slate-800/90" />
            <div className="h-3 w-[82%] rounded bg-slate-800/70" />
            <div className="h-3 w-[65%] rounded bg-slate-800/60" />
          </div>
        </div>
      ))}
    </div>
  )
}

function AttachmentBubble({ url }: { url: string }) {
  const resolvedUrl = getFullUrl(url) || url
  const guessedMode = detectAttachmentMode(resolvedUrl)
  const [mode, setMode] = useState<AttachmentMode>(guessedMode === "file" ? "image" : guessedMode)
  const [triedVideoFallback, setTriedVideoFallback] = useState(false)

  if (mode === "image") {
    return (
      <img
        src={resolvedUrl}
        alt="Attachment"
        className="max-h-80 max-w-sm rounded-md object-contain"
        loading="lazy"
        onError={() => {
          if (!triedVideoFallback) {
            setTriedVideoFallback(true)
            setMode("video")
            return
          }
          setMode("file")
        }}
      />
    )
  }

  if (mode === "video") {
    return (
      <video
        src={resolvedUrl}
        controls
        preload="metadata"
        className="max-h-80 max-w-sm rounded-md"
        onError={() => setMode("file")}
      />
    )
  }

  return (
    <a
      href={resolvedUrl}
      target="_blank"
      rel="noreferrer"
      className="flex w-fit items-center gap-2 rounded-xl border border-base-300 bg-base-200/60 p-2 text-blue-500 hover:underline"
    >
      <FileIcon className="h-4 w-4" />
      Download Attachment
    </a>
  )
}

export default function ChatPanel({ variant, channelName, channelId, guildName, guildId, onMobileMenu, onUserListToggle, showUserList, canSend = true, dmUser }: ChatPanelProps) {
  const { markChannelRead } = useNotifications()
  const channelKey = channelId || channelName
  const setCachedChannelMessages = useAppCacheStore((state) => state.setChannelMessages)
  const cachedDms = useAppCacheStore((state) => state.dms)
  const myRoleColor = useAppCacheStore((state) => (guildId ? state.myRoleColorByServer[guildId] : undefined))
  const setMyRoleColorForServer = useAppCacheStore((state) => state.setMyRoleColorForServer)
  const [msgs, setMsgs] = useState<Message[]>([])
  const [text, setText] = useState("")
  const [typing, setTyping] = useState<Set<string>>(new Set())
  const listRef = useRef<HTMLDivElement | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const idleRef = useRef<number | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [loadingInitial, setLoadingInitial] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const loadingMoreRef = useRef(false)
  const isAtBottomRef = useRef(true)
  const lastLoadMoreAtRef = useRef(0)
  const oldestTimestampRef = useRef<string | undefined>(undefined)
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [selectedUserRect, setSelectedUserRect] = useState<DOMRect | null>(null)
  const [localDmUser, setLocalDmUser] = useState<{ username: string; displayName: string } | null>(null)
  
  // File upload state
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const reconnectTimeoutRef = useRef<number | null>(null)
  const reconnectAttemptsRef = useRef(0)
  
  // Editing state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState("")

  const { user } = useAuth()
  const token = typeof window !== "undefined" ? (localStorage.getItem("token") || "") : ""

  useEffect(() => {
    if (variant !== "guild" || !guildId || !token || !user?.id || myRoleColor) return
    let cancelled = false

    const loadMyRoleColor = async () => {
      try {
        const [rolesRes, membersRes] = await Promise.all([
          api.getRoles(token, guildId),
          api.getServerMembers(token, guildId),
        ])
        if (cancelled) return

        const me = (membersRes.members || []).find((member) => member.id === user.id)
        if (!me) return

        const roleById = new Map((rolesRes.roles || []).map((role) => [role.id, role]))
        let highest: { position: number; color?: string } | null = null
        for (const roleId of me.roles || []) {
          const role = roleById.get(roleId)
          if (!role) continue
          if (!highest || role.position > highest.position) {
            highest = { position: role.position, color: role.color }
          }
        }
        setMyRoleColorForServer(guildId, highest?.color)
      } catch {
        // No-op: role color fallback remains unset.
      }
    }

    void loadMyRoleColor()
    return () => {
      cancelled = true
    }
  }, [guildId, myRoleColor, setMyRoleColorForServer, token, user?.id, variant])

  useEffect(() => {
    if (channelKey) {
      markChannelRead(channelKey)
    }
  }, [channelKey, markChannelRead])
  
  useEffect(() => {
    setTyping(new Set())
    if (variant === "dm" && channelName && token) {
      const cachedDm = (cachedDms || []).find((dm) => dm.id === channelName)
      if (cachedDm) {
        setLocalDmUser(cachedDm.user)
        return
      }
      // Try to find the DM user name
      api.getDMs(token).then(res => {
        const dm = res.dms.find(d => d.id === channelName)
        if (dm) {
           setLocalDmUser(dm.user)
        }
      }).catch(() => {})
    } else {
      setLocalDmUser(null)
    }
  }, [variant, channelName, token, cachedDms])

  const [showMentionMenu, setShowMentionMenu] = useState(false)
  const [mentionQuery, setMentionQuery] = useState("")
  const [members, setMembers] = useState<{id: string, username: string, displayName: string, avatarUrl: string}[]>([])
  const [mentionIndex, setMentionIndex] = useState(0)
  const [membersLoaded, setMembersLoaded] = useState(false)
  const [membersLoading, setMembersLoading] = useState(false)

  useEffect(() => {
    setMembers([])
    setMembersLoaded(false)
    setMembersLoading(false)
  }, [guildId, channelId, variant])

  const loadMentionMembers = async () => {
    if (variant !== "guild" || !guildId || !token) return
    if (membersLoaded || membersLoading) return
    setMembersLoading(true)
    try {
      const r = await api.getServerMembers(token, guildId, channelId)
      setMembers(r.members || [])
      setMembersLoaded(true)
    } catch {
      setMembers([])
    } finally {
      setMembersLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showMentionMenu) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setMentionIndex(i => (i + 1) % filteredMembers.length)
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setMentionIndex(i => (i - 1 + filteredMembers.length) % filteredMembers.length)
        return
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault()
        insertMention(filteredMembers[mentionIndex])
        return
      }
      if (e.key === "Escape") {
        setShowMentionMenu(false)
        return
      }
    }
    if (e.key === "Enter") send()
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setText(val)
    
    // Detect mention
    const lastWord = val.split(" ").pop() || ""
    if (lastWord.startsWith("@")) {
      const query = lastWord.slice(1)
      setMentionQuery(query)
      setShowMentionMenu(true)
      setMentionIndex(0)
      if (!membersLoaded) {
        void loadMentionMembers()
      }
    } else {
      setShowMentionMenu(false)
    }

    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "typing.start", channel: channelKey, user: display, userId: user?.id }))
      if (idleRef.current) clearTimeout(idleRef.current)
      idleRef.current = setTimeout(() => {
        ws.send(JSON.stringify({ type: "typing.stop", channel: channelKey, user: display, userId: user?.id }))
        idleRef.current = null
      }, 1200)
    }
  }

  const filteredMembers = (members || []).filter(m => 
    (m.username || "").toLowerCase().includes(mentionQuery.toLowerCase()) || 
    (m.displayName || "").toLowerCase().includes(mentionQuery.toLowerCase())
  ).slice(0, 5)

  const insertMention = (member: { username: string }) => {
    const words = text.split(" ")
    words.pop()
    setText(words.join(" ") + (words.length > 0 ? " " : "") + `@${member.username} `)
    setShowMentionMenu(false)
    // focus input?
  }

  const display = (user && (user.displayName || user.username)) || "You"
  const myAvatar = user?.avatarUrl

  const isNearBottom = useCallback(() => {
    const el = listRef.current
    if (!el) return true
    const distance = el.scrollHeight - (el.scrollTop + el.clientHeight)
    return distance <= BOTTOM_STICKY_THRESHOLD_PX
  }, [])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = listRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior })
    isAtBottomRef.current = true
  }, [])

  const nextFrame = useCallback(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve())
  }), [])

  function fmt(ts?: string) {
    if (!ts) return ""
    try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) } catch { return "" }
  }

  const isSameDay = (d1: Date, d2: Date) => {
    return d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate()
  }

  const formatDateline = (date: Date) => {
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    if (isSameDay(date, today)) return "Today"
    if (isSameDay(date, yesterday)) return "Yesterday"
    
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  }

  const [canSendState, setCanSendState] = useState(true)
  const effectiveCanSend = canSend && canSendState

  const loadOlderMessages = useCallback(async () => {
    if (!channelKey || loadingInitial || !hasMore || loadingMoreRef.current) return
    if (Date.now() - lastLoadMoreAtRef.current < LOAD_MORE_COOLDOWN_MS) return

    const authToken = localStorage.getItem("token") || ""
    const before = oldestTimestampRef.current
    if (!before) return

    const el = listRef.current
    const previousScrollHeight = el?.scrollHeight ?? 0
    const previousScrollTop = el?.scrollTop ?? 0

    loadingMoreRef.current = true
    setLoadingMore(true)
    try {
      const response = await api.messages(authToken, channelKey, PAGE_SIZE, before, guildId)
      const older = response.messages || []
      if (older.length === 0) {
        setHasMore(false)
        return
      }

      setMsgs((prev) => {
        const seen = new Set(prev.map((msg) => msg.id))
        const filteredOlder = older.filter((msg) => !seen.has(msg.id))
        return [...filteredOlder, ...prev]
      })
      oldestTimestampRef.current = older[0]?.ts || oldestTimestampRef.current
      setHasMore(older.length >= PAGE_SIZE)

      await nextFrame()
      const list = listRef.current
      if (!list) return
      const nextScrollHeight = list.scrollHeight
      list.scrollTop = Math.max(0, previousScrollTop + (nextScrollHeight - previousScrollHeight))
    } catch (e) {
      console.error("Failed to load older messages", e)
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
      lastLoadMoreAtRef.current = Date.now()
    }
  }, [channelKey, guildId, hasMore, loadingInitial, nextFrame])

  useEffect(() => {
    if (!channelKey) return
    let cancelled = false
    const authToken = localStorage.getItem("token") || ""
    const cachedSnapshot = useAppCacheStore.getState().messagesByChannel[channelKey]
    const hasCachedSnapshot = !!cachedSnapshot?.loaded

    if (hasCachedSnapshot) {
      setMsgs(cachedSnapshot.messages)
      setHasMore(cachedSnapshot.hasMore)
      setLoadingInitial(false)
      oldestTimestampRef.current = cachedSnapshot.oldestTimestamp
      requestAnimationFrame(() => {
        scrollToBottom("auto")
      })
    } else {
      setMsgs([])
      setHasMore(true)
      setLoadingInitial(true)
      oldestTimestampRef.current = undefined
    }

    loadingMoreRef.current = false
    setLoadingMore(false)
    isAtBottomRef.current = true

    const loadInitialMessages = async () => {
      try {
        let merged: Message[] = []
        let before: string | undefined
        let more = true
        let pages = 0

        while (!cancelled && more && pages < INITIAL_FILL_MAX_PAGES) {
          const response = await api.messages(authToken, channelKey, PAGE_SIZE, before, guildId)
          const batch = response.messages || []
          merged = pages === 0 ? batch : [...batch, ...merged]
          more = batch.length >= PAGE_SIZE
          before = merged[0]?.ts

          setMsgs(merged)
          setHasMore(more)
          oldestTimestampRef.current = merged[0]?.ts
          pages += 1

          await nextFrame()
          const list = listRef.current
          if (!list) continue
          if (list.scrollHeight > list.clientHeight + 24) break
          if (batch.length === 0) break
        }

        if (!cancelled) {
          setCachedChannelMessages(channelKey, {
            messages: merged,
            hasMore: more,
            oldestTimestamp: merged[0]?.ts,
            loaded: true,
          })
        }
      } catch (e) {
        console.error("Failed to load messages", e)
        if (!cancelled) {
          if (!hasCachedSnapshot) {
            setMsgs([])
            setHasMore(false)
          }
        }
      } finally {
        if (!cancelled) {
          setLoadingInitial(false)
          if (!hasCachedSnapshot) {
            await nextFrame()
            scrollToBottom("auto")
          }
        }
      }
    }

    void loadInitialMessages()

    return () => {
      cancelled = true
    }
  }, [channelKey, guildId, nextFrame, scrollToBottom, setCachedChannelMessages])

  useEffect(() => {
    if (!channelKey || loadingInitial) return
    setCachedChannelMessages(channelKey, {
      messages: msgs,
      hasMore,
      oldestTimestamp: oldestTimestampRef.current,
      loaded: true,
    })
  }, [channelKey, hasMore, loadingInitial, msgs, setCachedChannelMessages])

  useEffect(() => {
    if (!channelKey) return
    const authToken = localStorage.getItem("token") || ""

    // Check channel permissions if in guild
    if (variant === "guild" && authToken && guildId) {
      api.channels(guildId, authToken).then((res) => {
        let found = false
        for (const section of res.sections) {
          const channel = section.channels.find((entry) => entry.name === channelName || entry.id === channelKey)
          if (!channel) continue
          setCanSendState(channel.canSendMessages ?? true)
          found = true
          break
        }
        if (!found) setCanSendState(false)
      }).catch((e) => {
        console.error(e)
        setCanSendState(false)
      })
    } else {
      setCanSendState(true)
    }
  }, [channelKey, channelName, guildId, variant])

  useEffect(() => {
    if (!channelKey) return
    let cancelled = false
    const prev = wsRef.current
    if (prev) {
      try { prev.close() } catch (e) { console.error(e) }
      wsRef.current = null
    }

    const scheduleReconnect = () => {
      if (cancelled) return
      const delay = Math.min(1000 * (2 ** reconnectAttemptsRef.current), 10000)
      reconnectAttemptsRef.current += 1
      reconnectTimeoutRef.current = window.setTimeout(() => {
        connect()
      }, delay)
    }

    const connect = async () => {
      try {
        const info = await api.socketInfo(channelKey)
        if (cancelled) return

        const ws = new WebSocket(info.wsUrl)
        wsRef.current = ws

        ws.onopen = () => {
          reconnectAttemptsRef.current = 0
          ws.send(JSON.stringify({ type: "subscribe", channel: channelKey }))
        }

        ws.onmessage = (ev) => {
          let data: unknown
          try { data = JSON.parse(String(ev.data)) } catch { return }
          const d = data as {
            type?: string
            channel?: string
            user?: string
            userAvatar?: string
            userId?: string
            active?: boolean
            message?: { id: string; text: string; attachmentUrl?: string; ts?: string }
            messageId?: string
            roleColor?: string
          }

          const sameChannel = d.channel === channelKey || d.channel === channelName

          if (d.type === "typing" && sameChannel && d.user) {
            if (user?.id && d.userId === user.id) return
            const name = d.user
            setTyping((prevTyping) => {
              const next = new Set(prevTyping)
              if (d.active) next.add(name)
              else next.delete(name)
              return next
            })
          }

          if (d.type === "message" && sameChannel && d.message) {
            const shouldAutoScroll = isNearBottom()
            setMsgs((prevMsgs) => {
              if (prevMsgs.some((x) => x.id === d.message!.id)) return prevMsgs
              const incomingMessage: Message = {
                id: d.message!.id,
                user: d.user || "User",
                userAvatar: d.userAvatar,
                userId: d.userId,
                text: d.message!.text,
                attachmentUrl: d.message!.attachmentUrl,
                ts: d.message!.ts || new Date().toISOString(),
                roleColor: d.roleColor || (variant === "guild" && d.userId === user?.id ? myRoleColor : undefined),
              }

              // Reconcile optimistic local messages immediately to avoid a temporary duplicate.
              if (d.userId && user?.id && d.userId === user.id) {
                for (let i = prevMsgs.length - 1; i >= 0; i -= 1) {
                  const candidate = prevMsgs[i]
                  if (!candidate.id.startsWith("local:")) continue
                  if (candidate.userId !== user.id) continue
                  if (candidate.text !== incomingMessage.text) continue
                  if ((candidate.attachmentUrl || "") !== (incomingMessage.attachmentUrl || "")) continue

                  const next = [...prevMsgs]
                  next[i] = incomingMessage
                  return next
                }
              }

              return [...prevMsgs, incomingMessage]
            })
            if (shouldAutoScroll) {
              requestAnimationFrame(() => {
                scrollToBottom("smooth")
              })
            }
            if (d.user) {
              setTyping((prevTyping) => {
                const next = new Set(prevTyping)
                next.delete(d.user!)
                return next
              })
            }
          }

          if (d.type === "message_delete" && sameChannel && d.messageId) {
            setMsgs((prevMsgs) => prevMsgs.filter((m) => m.id !== d.messageId))
          }

          if (d.type === "message_update" && sameChannel && d.message) {
            setMsgs((prevMsgs) => prevMsgs.map((m) => m.id === d.message!.id ? { ...m, text: d.message!.text } : m))
          }
        }

        ws.onerror = () => {
          try {
            ws.close()
          } catch (e) {
            console.error("Failed to close chat socket", e)
          }
        }

        ws.onclose = () => {
          if (wsRef.current === ws) wsRef.current = null
          scheduleReconnect()
        }
      } catch {
        scheduleReconnect()
      }
    }

    connect()
    return () => {
      cancelled = true
      if (reconnectTimeoutRef.current) {
        window.clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
      const cur = wsRef.current
      if (!cur) return
      try {
        if (cur.readyState === WebSocket.OPEN) {
          cur.send(JSON.stringify({ type: "unsubscribe", channel: channelKey }))
        }
      } catch (e) { console.error(e) }
      try { cur.close() } catch (e) { console.error(e) }
      wsRef.current = null
    }
  }, [channelKey, channelName, isNearBottom, myRoleColor, scrollToBottom, user?.id, variant])

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    if (file.size > 50 * 1024 * 1024) {
       alert("File too large (max 50MB)")
       return
    }
    
    setSelectedFile(file)
  }
  
  const clearFile = () => {
    setSelectedFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const applyMessagesUpdate = useCallback((updater: (prev: Message[]) => Message[]) => {
    setMsgs((prev) => {
      const next = updater(prev)
      setCachedChannelMessages(channelKey, {
        messages: next,
        hasMore,
        oldestTimestamp: oldestTimestampRef.current,
        loaded: true,
      })
      return next
    })
  }, [channelKey, hasMore, setCachedChannelMessages])

  const send = async () => {
    const t = text.trim()
    if (!t && !selectedFile) return
    setText("")
    // stop typing immediately when sending
    const ws = wsRef.current
    try {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "typing.stop", channel: channelKey, user: display, userId: user?.id }))
      }
    } catch (e) { console.error(e) }
    
    let attachmentUrl: string | undefined
    if (selectedFile) {
       setIsUploading(true)
       try {
         const res = await api.uploadFile(token, selectedFile)
         if (res.url) attachmentUrl = res.url
         else alert(res.error || "Upload failed")
       } catch (error) {
         const message = error instanceof Error ? error.message : "Upload failed"
         alert(message)
       } finally {
         setIsUploading(false)
         clearFile()
       }
       if (!attachmentUrl && !t) return // Upload failed and no text
    }

    let optimisticId: string | null = null
    try {
      const shouldAutoScroll = isNearBottom()
      if (token) {
        optimisticId = `local:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
        const optimisticTs = new Date().toISOString()
        const optimisticMessage: Message = {
          id: optimisticId,
          user: display,
          userAvatar: myAvatar || undefined,
          userId: user?.id,
          text: t,
          attachmentUrl,
          ts: optimisticTs,
          roleColor: variant === "guild" ? myRoleColor : undefined,
        }

        applyMessagesUpdate((prev) => [...prev, optimisticMessage])
        if (shouldAutoScroll) {
          requestAnimationFrame(() => {
            scrollToBottom("smooth")
          })
        }

        const r = await api.sendMessage(token, channelKey, t, guildId, attachmentUrl)
        if ("error" in r) {
          console.error("Error sending message:", r.error)
          applyMessagesUpdate((prev) => prev.filter((x) => x.id !== optimisticId))
          return
        }
        const confirmedMessage: Message = {
          id: r.message.id,
          user: display,
          userAvatar: myAvatar || undefined,
          userId: user?.id,
          text: t,
          attachmentUrl: r.message.attachmentUrl,
          ts: r.message.ts,
          roleColor: r.message.roleColor || (variant === "guild" ? myRoleColor : undefined),
        }

        applyMessagesUpdate((prev) => {
          const withoutOptimistic = prev.filter((x) => x.id !== optimisticId)
          if (withoutOptimistic.some((x) => x.id === confirmedMessage.id)) {
            return withoutOptimistic.map((x) =>
              x.id === confirmedMessage.id
                ? { ...x, roleColor: x.roleColor || confirmedMessage.roleColor }
                : x,
            )
          }
          return [...withoutOptimistic, confirmedMessage]
        })
      } else {
        applyMessagesUpdate((prev) => [...prev, { id: String(Date.now()), user: display, text: t, ts: new Date().toISOString() }])
      }
    } catch {
      if (optimisticId) {
        applyMessagesUpdate((prev) => prev.filter((x) => x.id !== optimisticId))
      }
    }
  }

  const onScroll = () => {
    const el = listRef.current
    if (!el) return
    isAtBottomRef.current = isNearBottom()
    if (el.scrollTop <= TOP_FETCH_THRESHOLD_PX) {
      void loadOlderMessages()
    }
  }

  const handleDelete = async (id: string) => {
    if (!token) return
    try {
      await api.deleteMessage(token, id)
      setMsgs(prev => prev.filter(m => m.id !== id))
    } catch (e) {
      console.error("Failed to delete message", e)
    }
  }

  const handleEdit = async (id: string, newContent: string) => {
    if (!token) return
    try {
      await api.editMessage(token, id, newContent)
      setMsgs(prev => prev.map(m => m.id === id ? { ...m, text: newContent } : m))
      setEditingId(null)
      setEditingText("")
    } catch (e) {
      console.error("Failed to edit message", e)
    }
  }

  const startEditing = (id: string, currentText: string) => {
    setEditingId(id)
    setEditingText(currentText)
  }

  return (
    <div className="h-full min-h-0 flex flex-col bg-slate-950/45 text-slate-100">
      <div className="flex h-12 items-center justify-between border-b border-cyan-300/12 bg-slate-950/75 px-4 shadow-sm backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="md:hidden mr-2 -ml-2 text-slate-300/75" onClick={onMobileMenu}>
            <Menu className="h-5 w-5" />
          </Button>
          {variant === "guild" ? (
            <Hash className="h-4 w-4 text-cyan-200/70" />
          ) : (
            <MessageSquare className="h-4 w-4 text-cyan-200/70" />
          )}
          <div className="text-sm font-semibold text-slate-100">
            {variant === "guild" && guildName ? <span className="text-slate-300/65">{guildName} · </span> : null}
            {variant === "guild" ? `#${channelName}` : (dmUser ? (dmUser.displayName || dmUser.username) : "Direct Message")}
          </div>
        </div>
        <div className="flex items-center">
          {variant === "guild" && (
            <Button 
              variant="ghost" 
              size="icon" 
              className={cn("text-slate-300/75", showUserList && "bg-cyan-400/20 text-cyan-100")} 
              onClick={onUserListToggle}
            >
              <Users className="h-5 w-5" />
            </Button>
          )}
        </div>
      </div>
      <div ref={listRef} onScroll={onScroll} className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
        <div className="space-y-4">
          {loadingInitial && msgs.length === 0 ? <MessageSkeletonRows count={7} /> : null}
          {loadingMore ? <MessageSkeletonRows count={2} /> : null}
          {!loadingInitial && msgs.length === 0 ? (
            <div className="rounded-xl border border-cyan-300/15 bg-slate-900/40 px-4 py-3 text-sm text-slate-300/70">
              No messages yet. Say hi.
            </div>
          ) : null}
          {msgs.length > 0 && (() => {
            type Group = { type: 'group'; user: string; userAvatar?: string; userId?: string; messages: { id: string; text: string; attachmentUrl?: string; ts?: string }[]; roleColor?: string }
            type DateSep = { type: 'date'; date: Date; id: string }
            const nodes: (Group | DateSep)[] = []
            
            let currentGroup: Group | null = null
            let lastDate: Date | null = null

            for (const m of msgs) {
              const mDate = m.ts ? new Date(m.ts) : new Date()
              let dateChanged = false

              if (!lastDate || (m.ts && !isSameDay(lastDate, mDate))) {
                 dateChanged = true
                 currentGroup = null
                 nodes.push({ type: 'date', date: mDate, id: m.id })
                 lastDate = mDate
              }

              if (currentGroup && currentGroup.user === m.user) {
                 const lastMsg = currentGroup.messages[currentGroup.messages.length - 1]
                 const lastTime = lastMsg.ts ? new Date(lastMsg.ts).getTime() : 0
                 const currTime = mDate.getTime()
                 
                 if (currTime - lastTime <= 5 * 60 * 1000 && !dateChanged) {
                    currentGroup.messages.push({ id: m.id, text: m.text, attachmentUrl: m.attachmentUrl, ts: m.ts })
                    continue
                 }
              }

              currentGroup = {
                 type: 'group',
                 user: m.user,
                 userAvatar: m.userAvatar,
                 userId: m.userId,
                 messages: [{ id: m.id, text: m.text, attachmentUrl: m.attachmentUrl, ts: m.ts }],
                 roleColor: m.roleColor
              }
              nodes.push(currentGroup)
            }

            return nodes.map((node) => {
              if (node.type === 'date') {
                 return (
                    <div key={`date-${node.id}`} className="relative flex items-center justify-center my-4">
                       <div className="absolute inset-0 flex items-center">
                          <div className="w-full border-t border-base-300" />
                       </div>
                       <div className="relative bg-slate-950/95 px-2 text-xs text-slate-300/60">
                          {formatDateline(node.date)}
                       </div>
                    </div>
                 )
              }

              const g = node as Group
              const first = g.messages[0]
              
              // Use current user avatar if userId matches
              const isMe = user && (g.userId === user.id || g.user === display)
              const avatarUrl = isMe && user.avatarUrl 
                ? getFullUrl(user.avatarUrl)
                : getFullUrl(g.userAvatar)

              return (
                <div key={first.id} className="group mt-[17px] flex items-start gap-3 -mx-4 px-4 py-0.5 hover:bg-cyan-400/5">
                  <div 
                    className="h-8 w-8 rounded-full bg-primary/20 mt-0.5 overflow-hidden shrink-0 cursor-pointer hover:opacity-80"
                    onClick={(e) => {
                      if (!g.userId) return
                      setSelectedUserId(g.userId)
                      setSelectedUserRect(e.currentTarget.getBoundingClientRect())
                    }}
                  >
                    {avatarUrl ? (
                      <img src={avatarUrl} alt={g.user} className="h-full w-full object-cover block" />
                    ) : (
                      <div className="h-full w-full bg-primary flex items-center justify-center text-[10px] text-primary-foreground font-bold">
                        {g.user.substring(0, 2).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    {/* Messages Loop */}
                    {g.messages.map((it, idx) => {
                      const isEditing = editingId === it.id
                      const isMyMessage = isMe || (user && g.userId === user.id)
                      const isMentioned = user && it.text.includes(`@${user.username}`)
                      const prevMsg = idx > 0 ? g.messages[idx - 1] : null
                      const prevIsMentioned = prevMsg && user && prevMsg.text.includes(`@${user.username}`)
                      const isConsecutiveMention = isMentioned && prevIsMentioned

                      return (
                        <div key={it.id} className={cn("relative group/msg -mx-4 px-4 py-0.5 hover:bg-cyan-400/5", idx > 0 && !isConsecutiveMention && "mt-0.5", isMentioned && "bg-blue-500/10 border-l-2 border-blue-500 hover:bg-blue-500/15 ml-[-3.75rem] pl-[3.75rem]")}>
                          {idx === 0 && (
                             <div className="flex items-baseline gap-2 mb-1">
                              <div 
                                className="text-sm font-medium text-foreground hover:underline cursor-pointer"
                                onClick={(e) => {
                                  if (!g.userId) return
                                  setSelectedUserId(g.userId)
                                  setSelectedUserRect(e.currentTarget.getBoundingClientRect())
                                }}
                                style={{ color: g.roleColor || undefined }}
                              >
                                 {isMe && user.displayName ? user.displayName : g.user}
                               </div>
                               {first.ts && <div className="text-xs text-slate-300/60">{fmt(first.ts)}</div>}
                             </div>
                          )}
                          
                          {isEditing ? (
                             <div className="flex gap-2 items-center py-1">
                               <Input 
                                 value={editingText} 
                                 onChange={e => setEditingText(e.target.value)}
                                 onKeyDown={e => {
                                   if (e.key === "Enter") handleEdit(it.id, editingText)
                                   if (e.key === "Escape") {
                                     setEditingId(null)
                                     setEditingText("")
                                   }
                                 }}
                                 className="h-8 text-sm"
                                 maxLength={5000}
                               />
                               <div className="text-xs text-muted-foreground">escape to cancel • enter to save</div>
                             </div>
                          ) : (
                             <div className="text-sm text-foreground whitespace-pre-wrap wrap-break-words leading-snug pr-12">
                                {it.text.split(/(@[a-zA-Z0-9_]+)/g).map((part, i) => {
                                    if (part.startsWith('@')) {
                                        return <span key={i} className={cn("bg-blue-500/30 text-blue-200 rounded px-0.5 font-medium")}>{part}</span>
                                    }
                                    return part
                                })}
                             </div>
                          )}
                          
                          {it.attachmentUrl && (
                            <div className="mt-2">
                              <AttachmentBubble url={it.attachmentUrl} />
                            </div>
                          )}
                          
                          {!isEditing && isMyMessage && (
                            <div className="absolute right-4 top-0 z-10 hidden items-center rounded-lg border border-cyan-300/20 bg-slate-950/90 shadow-sm group-hover/msg:flex">
                               <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => startEditing(it.id, it.text)}>
                                  <Pencil className="h-3 w-3" />
                               </Button>
                               <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive" onClick={() => handleDelete(it.id)}>
                                  <Trash className="h-3 w-3" />
                               </Button>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })
          })()}
        </div>
      </div>
      {typing.size > 0 && (
        <div className="px-4 pt-1 text-xs text-cyan-200/80 animate-pulse font-medium">{Array.from(typing).join(", ")} is typing…</div>
      )}
      <div className="flex h-auto min-h-16 flex-col justify-center border-t border-cyan-300/12 bg-slate-950/78 px-3 py-2 backdrop-blur-xl">
        {selectedFile && (
           <div className="mb-2 flex items-center gap-2 rounded-xl border border-cyan-300/20 bg-slate-900/75 p-2">
              {selectedFile.type.startsWith('image/') ? (
                 <img 
                    src={URL.createObjectURL(selectedFile)} 
                    alt="Preview" 
                    className="h-12 w-12 object-cover rounded" 
                    onLoad={(e) => URL.revokeObjectURL(e.currentTarget.src)}
                 />
              ) : (
                 <FileIcon className="h-8 w-8 text-muted-foreground" />
              )}
              <span className="text-xs truncate max-w-[200px]">{selectedFile.name}</span>
              <Button variant="ghost" size="icon" className="h-5 w-5 ml-auto" onClick={clearFile}>
                 <X className="h-3 w-3" />
              </Button>
           </div>
        )}
        <div className="flex w-full items-center gap-2">
          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            onChange={handleFileSelect}
            accept="image/*,video/*"
          />
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground" onClick={() => fileInputRef.current?.click()}>
            <Plus className="h-5 w-5" />
          </Button>
          <div className="relative w-full">
            {showMentionMenu && filteredMembers.length > 0 && (
               <div className="absolute bottom-full left-0 z-50 mb-2 w-64 overflow-hidden rounded-xl border border-cyan-300/20 bg-slate-950/95 shadow-lg">
                 <div className="bg-slate-900/80 px-3 py-2 text-xs font-bold text-cyan-200/80">MEMBERS MATCHING @{mentionQuery}</div>
                 {filteredMembers.map((m, i) => (
                   <button
                     key={m.id}
                     className={cn(
                       "w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground text-left",
                       i === mentionIndex && "bg-accent text-accent-foreground"
                     )}
                     onClick={() => insertMention(m)}
                   >
                     <div className="h-6 w-6 rounded-full bg-primary/20 overflow-hidden">
                       {m.avatarUrl ? (
                         <img src={getFullUrl(m.avatarUrl) || ""} alt={m.username} className="h-full w-full object-cover" />
                       ) : (
                         <div className="h-full w-full flex items-center justify-center text-[10px] font-bold bg-primary text-primary-foreground">
                           {m.username.substring(0, 2).toUpperCase()}
                         </div>
                       )}
                     </div>
                     <div className="flex flex-col">
                        <span className="font-medium">{m.displayName}</span>
                        <span className="text-xs text-muted-foreground">@{m.username}</span>
                     </div>
                   </button>
                 ))}
               </div>
            )}
            <Input
              className="border-cyan-300/20 bg-slate-900/70"
              placeholder={!effectiveCanSend ? "You do not have permission to send messages in this channel." : (variant === "guild" ? `Message #${channelName}` : `Message ${localDmUser ? (localDmUser.displayName || localDmUser.username) : "Direct Message"}`)}
              disabled={!effectiveCanSend || isUploading}
              value={text}
              maxLength={5000}
              onPaste={(e) => {
               const items = e.clipboardData?.items
               if (!items) return
               for (let i = 0; i < items.length; i++) {
                  if (items[i].type.indexOf("image") !== -1) {
                     e.preventDefault()
                     const file = items[i].getAsFile()
                     if (file) {
                        if (file.size > 50 * 1024 * 1024) {
                           alert("File too large (max 50MB)")
                           return
                        }
                        setSelectedFile(file)
                     }
                     return
                  }
               }
            }}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
          />
          </div>
          <Button onClick={send} disabled={!effectiveCanSend}>Send</Button>
        </div>
        {text.length > 4000 && (
          <div className={cn("text-xs text-right px-1 mt-1", text.length >= 5000 ? "text-destructive" : "text-muted-foreground")}>
            {text.length}/5000
          </div>
        )}
      </div>

      <UserProfilePopover
        userId={selectedUserId} 
        serverId={guildId}
        isOpen={!!selectedUserId && !!selectedUserRect}
        onClose={() => {
          setSelectedUserId(null)
          setSelectedUserRect(null)
        }}
        position={selectedUserRect}
      />
    </div>
  )
}
