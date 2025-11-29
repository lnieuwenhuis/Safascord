import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Hash, MessageSquare, Menu, Users } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { api, getFullUrl } from "@/lib/api"
import { useAuth } from "@/hooks/useAuth"
import { cn } from "@/lib/utils"
import UserProfileDialog from "./UserProfileDialog"
import type { Message } from "@/types"

interface ChatPanelProps {
  variant: "guild" | "dm"
  channelName: string
  guildName?: string
  guildId?: string
  onMobileMenu?: () => void
  onUserListToggle?: () => void
  showUserList?: boolean
}

export default function ChatPanel({ variant, channelName, guildName, guildId, onMobileMenu, onUserListToggle, showUserList }: ChatPanelProps) {
  const [msgs, setMsgs] = useState<Message[]>([])
  const [text, setText] = useState("")
  const [typing, setTyping] = useState<Set<string>>(new Set())
  const listRef = useRef<HTMLDivElement | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const idleRef = useRef<number | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [dmUser, setDmUser] = useState<{ username: string; displayName: string } | null>(null)
  const { user } = useAuth()
  const token = typeof window !== "undefined" ? (localStorage.getItem("token") || "") : ""
  
  useEffect(() => {
    if (variant === "dm" && channelName && token) {
      // Try to find the DM user name
      // This is a bit inefficient to fetch all DMs, but works for now without new API endpoints
      api.getDMs(token).then(res => {
        const dm = res.dms.find(d => d.id === channelName)
        if (dm) {
           setDmUser(dm.user)
        }
      }).catch(() => {})
    } else {
      setDmUser(null)
    }
  }, [variant, channelName, token])

  const display = (user && (user.displayName || user.username)) || "You"
  const myAvatar = user?.avatarUrl

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

  const [canSend, setCanSend] = useState(true)

  useEffect(() => {
    if (!channelName) return
    const token = localStorage.getItem("token") || ""
    // Pass serverId (guildId) if available to disambiguate channels with same name
    api.messages(token, channelName, 50, undefined, guildId).then((r) => {
      setMsgs(r.messages)
      setHasMore(r.messages.length >= 50)
    }).catch(() => {
      setMsgs([])
    })
    
    // Check channel permissions if in guild
     if (variant === "guild" && token && guildId) {
          api.channels(guildId, token).then(res => {
             // Find our channel
             // Flatten sections
            let found = false
            for (const s of res.sections) {
               const c = s.channels.find(x => x.name === channelName)
               if (c) {
                  setCanSend(c.canSendMessages ?? true)
                  found = true
                  break
               }
            }
            if (!found) setCanSend(true) // Default if not found?
         }).catch(e => {
            console.error(e)
            setCanSend(true)
         })
    } else {
       setCanSend(true)
    }
  }, [channelName, user?.id, variant, guildName, guildId, token])

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [msgs.length, channelName, variant])

  useEffect(() => {
    if (!channelName) return
    let cancelled = false
    let ws: WebSocket | null = null
    const prev = wsRef.current
    if (prev) {
      try { prev.close() } catch (e) { console.error(e) }
      wsRef.current = null
    }
    api.socketInfo(channelName).then((info) => {
      if (cancelled) return
      ws = new WebSocket(info.wsUrl)
      wsRef.current = ws
      ws.onopen = () => {
        ws?.send(JSON.stringify({ type: "subscribe", channel: channelName }))
      }
      ws.onmessage = (ev) => {
        let data: unknown
        try { data = JSON.parse(String(ev.data)) } catch { return }
        const d = data as { type?: string; channel?: string; user?: string; userAvatar?: string; userId?: string; active?: boolean; message?: { id: string; text: string; ts?: string }; roleColor?: string }
        if (d.type === "typing" && d.channel === channelName && d.user) {
          if (user?.id && d.userId === user.id) return
          const name = d.user
          setTyping((prev) => {
            const next = new Set(prev)
            if (d.active) next.add(name)
            else next.delete(name)
            return next
          })
        }
        if (d.type === "message" && d.channel === channelName && d.message) {
          setTyping((prev) => prev) // no-op, keep typing as-is
          setMsgs((prev) => {
            if (prev.some((x) => x.id === d.message!.id)) return prev
            return [...prev, { 
              id: d.message!.id, 
              user: d.user || "User", 
              userAvatar: d.userAvatar,
              userId: d.userId,
              text: d.message!.text, 
              ts: d.message!.ts || new Date().toISOString(),
              roleColor: d.roleColor
            }]
          })
          if (d.user) setTyping((prev) => { const next = new Set(prev); next.delete(d.user!); return next })
        }
      }
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null
      }
    }).catch(() => {})
    return () => {
      cancelled = true
      const cur = wsRef.current
      if (!cur) return
      try {
        if (cur.readyState === WebSocket.OPEN) {
          cur.send(JSON.stringify({ type: "unsubscribe", channel: channelName }))
        }
      } catch (e) { console.error(e) }
      try { cur.close() } catch (e) { console.error(e) }
      wsRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName])

  const send = async () => {
    const t = text.trim()
    if (!t) return
    setText("")
    // stop typing immediately when sending
    const ws = wsRef.current
    try {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "typing.stop", channel: channelName, user: display, userId: user?.id }))
      }
    } catch (e) { console.error(e) }
    try {
      if (token) {
        const r = await api.sendMessage(token, channelName, t, guildId)
        if ("error" in r) {
          console.error("Error sending message:", r.error)
          return
        }
        const ts = r.message.ts
        setMsgs((prev) => {
          if (prev.some((x) => x.id === r.message!.id)) return prev
          return [...prev, { id: r.message!.id, user: display, userAvatar: myAvatar || undefined, userId: user?.id, text: t, ts, roleColor: (r.message).roleColor }]
        })
      } else {
        setMsgs((prev) => [...prev, { id: String(Date.now()), user: display, text: t, ts: new Date().toISOString() }])
      }
    } catch {
      setMsgs((prev) => [...prev, { id: String(Date.now()), user: display, text: t, ts: new Date().toISOString() }])
    }
  }

  const onScroll = async () => {
    const el = listRef.current
    if (!el || loadingMore || !hasMore) return
    if (el.scrollTop <= 0) {
      setLoadingMore(true)
      const oldest = msgs[0]?.ts
      const token = localStorage.getItem("token") || ""
      try {
        const r = await api.messages(token, channelName, 50, oldest, guildId)
        setMsgs((prev) => [...r.messages, ...prev])
        setHasMore(r.messages.length >= 50)
      } finally {
        setLoadingMore(false)
      }
    }
  }

  return (
    <div className="min-h-0 flex flex-1 flex-col bg-background text-foreground">
      <div className="flex h-12 items-center justify-between border-b border-border px-4 shadow-sm">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="md:hidden mr-2 -ml-2 text-muted-foreground" onClick={onMobileMenu}>
            <Menu className="h-5 w-5" />
          </Button>
          {variant === "guild" ? (
            <Hash className="h-4 w-4 text-muted-foreground" />
          ) : (
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          )}
          <div className="text-sm font-semibold">
            {variant === "guild" && guildName ? <span className="text-muted-foreground">{guildName} · </span> : null}
            {variant === "guild" ? `#${channelName}` : (dmUser ? (dmUser.displayName || dmUser.username) : "Direct Message")}
          </div>
        </div>
        <div className="flex items-center">
          {variant === "guild" && (
            <Button 
              variant="ghost" 
              size="icon" 
              className={cn("text-muted-foreground", showUserList && "text-foreground bg-accent")} 
              onClick={onUserListToggle}
            >
              <Users className="h-5 w-5" />
            </Button>
          )}
        </div>
      </div>
      <div ref={listRef} onScroll={onScroll} className="flex-1 min-h-0 overflow-y-auto p-4">
        <div className="space-y-4">
          {(() => {
            type Group = { type: 'group'; user: string; userAvatar?: string; userId?: string; messages: { id: string; text: string; ts?: string }[]; roleColor?: string }
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
                    currentGroup.messages.push({ id: m.id, text: m.text, ts: m.ts })
                    continue
                 }
              }

              currentGroup = {
                 type: 'group',
                 user: m.user,
                 userAvatar: m.userAvatar,
                 userId: m.userId,
                 messages: [{ id: m.id, text: m.text, ts: m.ts }],
                 roleColor: m.roleColor
              }
              nodes.push(currentGroup)
            }

            return nodes.map((node) => {
              if (node.type === 'date') {
                 return (
                    <div key={`date-${node.id}`} className="relative flex items-center justify-center my-4">
                       <div className="absolute inset-0 flex items-center">
                          <div className="w-full border-t border-border" />
                       </div>
                       <div className="relative bg-background px-2 text-xs text-muted-foreground">
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
                <div key={first.id} className="flex items-start gap-3 group hover:bg-muted/50 -mx-4 px-4 py-0.5 mt-[17px]">
                  <div 
                    className="h-8 w-8 rounded-full bg-primary/20 mt-0.5 overflow-hidden shrink-0 cursor-pointer hover:opacity-80"
                    onClick={() => g.userId && setSelectedUserId(g.userId)}
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
                    <div className="flex items-baseline gap-2">
                      <div 
                        className="text-sm font-medium text-foreground hover:underline cursor-pointer"
                        onClick={() => g.userId && setSelectedUserId(g.userId)}
                        style={{ color: g.roleColor || undefined }}
                      >
                        {isMe && user.displayName ? user.displayName : g.user}
                      </div>
                      {first.ts && <div className="text-xs text-muted-foreground">{fmt(first.ts)}</div>}
                    </div>
                    <div className="text-sm text-foreground whitespace-pre-wrap wrap-break-words leading-snug">{first.text}</div>
                    {g.messages.slice(1).map((it) => (
                      <div key={it.id} className="mt-0.5 text-sm text-foreground whitespace-pre-wrap wrap-break-words leading-snug hover:bg-black/5 -mx-4 px-4 py-0.5 relative group/msg">
                         {it.text}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })
          })()}
        </div>
      </div>
      {typing.size > 0 && (
        <div className="px-4 pt-1 text-xs text-muted-foreground animate-pulse font-medium">{Array.from(typing).join(", ")} is typing…</div>
      )}
      <div className="flex h-16 items-center border-t border-border px-3 bg-background">
        <div className="flex w-full items-center gap-2">
          <Input
            className="border-0 bg-muted/50 focus-visible:ring-1 focus-visible:ring-ring"
            placeholder={!canSend ? "You do not have permission to send messages in this channel." : (variant === "guild" ? `Message #${channelName}` : `Message ${channelName}`)}
            disabled={!canSend}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              const ws = wsRef.current
              if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "typing.start", channel: channelName, user: display, userId: user?.id }))
                if (idleRef.current) clearTimeout(idleRef.current)
                idleRef.current = setTimeout(() => {
                  ws.send(JSON.stringify({ type: "typing.stop", channel: channelName, user: display, userId: user?.id }))
                  idleRef.current = null
                }, 1200)
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") send()
            }}
          />
          <Button variant="brand" onClick={send} disabled={!canSend}>Send</Button>
        </div>
      </div>

      <UserProfileDialog 
        userId={selectedUserId} 
        isOpen={!!selectedUserId} 
        onClose={() => setSelectedUserId(null)} 
      />
    </div>
  )
}
