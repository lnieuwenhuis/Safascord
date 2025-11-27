import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Hash, MessageSquare, Menu, Users } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { api, getFullUrl } from "@/lib/api"
import { useAuth } from "@/hooks/useAuth"
import { cn } from "@/lib/utils"

interface ChatPanelProps {
  variant: "guild" | "dm"
  channelName: string
  guildName?: string
  onMobileMenu?: () => void
  onUserListToggle?: () => void
  showUserList?: boolean
}

export default function ChatPanel({ variant, channelName, guildName, onMobileMenu, onUserListToggle, showUserList }: ChatPanelProps) {
  const [msgs, setMsgs] = useState<{ id: string; user: string; userAvatar?: string; userId?: string; text: string; ts?: string }[]>([])
  const [text, setText] = useState("")
  const [typing, setTyping] = useState<Set<string>>(new Set())
  const listRef = useRef<HTMLDivElement | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const idleRef = useRef<number | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const { user } = useAuth()
  const token = typeof window !== "undefined" ? (localStorage.getItem("token") || "") : ""
  
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

  useEffect(() => {
    if (!channelName) return
    api.messages(channelName, 50).then((r) => {
      setMsgs(r.messages)
      setHasMore(r.messages.length >= 50)
    }).catch(() => setMsgs(Array.from({ length: 24 }).map((_, i) => ({ id: String(i), user: `User ${i % 5}`, text: `Message ${i + 1}` }))))
  }, [channelName, user?.id])

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
        const d = data as { type?: string; channel?: string; user?: string; userAvatar?: string; userId?: string; active?: boolean; message?: { id: string; text: string; ts?: string } }
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
              ts: d.message!.ts 
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
        const r = await api.sendMessage(token, channelName, t)
        if ("error" in r) {
          console.error("Error sending message:", r.error)
          return
        }
        const ts = r.message.ts
        setMsgs((prev) => {
          if (prev.some((x) => x.id === r.message!.id)) return prev
          return [...prev, { id: r.message!.id, user: display, userAvatar: myAvatar || undefined, userId: user?.id, text: t, ts }]
        })
      } else {
        setMsgs((prev) => [...prev, { id: String(Date.now()), user: display, text: t }])
      }
    } catch {
      setMsgs((prev) => [...prev, { id: String(Date.now()), user: display, text: t }])
    }
  }

  const onScroll = async () => {
    const el = listRef.current
    if (!el || loadingMore || !hasMore) return
    if (el.scrollTop <= 0) {
      setLoadingMore(true)
      const oldest = msgs[0]?.ts
      try {
        const r = await api.messages(channelName, 50, oldest)
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
            {variant === "guild" ? `#${channelName}` : channelName}
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
            type Group = { type: 'group'; user: string; userAvatar?: string; userId?: string; messages: { id: string; text: string; ts?: string }[] }
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
                 messages: [{ id: m.id, text: m.text, ts: m.ts }]
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
                  <div className="h-8 w-8 rounded-full bg-primary/20 mt-0.5 overflow-hidden shrink-0 cursor-pointer hover:opacity-80">
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
                      <div className="text-sm font-medium text-foreground hover:underline cursor-pointer">
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
            placeholder={variant === "guild" ? `Message #${channelName}` : `Message ${channelName}`}
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
          <Button variant="brand" onClick={send}>Send</Button>
        </div>
      </div>
    </div>
  )
}
