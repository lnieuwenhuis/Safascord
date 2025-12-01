import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Hash, MessageSquare, Menu, Users, Pencil, Trash, Plus, X, FileIcon } from "lucide-react"
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
  
  // File upload state
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  
  // Editing state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState("")

  const { user } = useAuth()
  const token = typeof window !== "undefined" ? (localStorage.getItem("token") || "") : ""
  
  useEffect(() => {
    if (variant === "dm" && channelName && token) {
      // Try to find the DM user name
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

  const [showMentionMenu, setShowMentionMenu] = useState(false)
  const [mentionQuery, setMentionQuery] = useState("")
  const [members, setMembers] = useState<{id: string, username: string, displayName: string, avatarUrl: string}[]>([])
  const [mentionIndex, setMentionIndex] = useState(0)

  useEffect(() => {
    if (variant === "guild" && guildId && token) {
      api.getServerMembers(token, guildId).then(r => {
        setMembers(r.members)
      }).catch(() => setMembers([]))
    }
  }, [guildId, variant, token])

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
    } else {
      setShowMentionMenu(false)
    }

    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "typing.start", channel: channelName, user: display, userId: user?.id }))
      if (idleRef.current) clearTimeout(idleRef.current)
      idleRef.current = setTimeout(() => {
        ws.send(JSON.stringify({ type: "typing.stop", channel: channelName, user: display, userId: user?.id }))
        idleRef.current = null
      }, 1200)
    }
  }

  const filteredMembers = members.filter(m => 
    m.username.toLowerCase().includes(mentionQuery.toLowerCase()) || 
    m.displayName.toLowerCase().includes(mentionQuery.toLowerCase())
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
            // If no sections/channels returned, we assume no access or empty
            // If sections exist, check permissions for the specific channel
            // Flatten sections to find the channel
            for (const s of res.sections) {
               const c = s.channels.find(x => x.name === channelName)
               if (c) {
                  // If canSendMessages is undefined, it means no override, so it defaults to true/inherited
                  // But in our API, if the user has ANY role that allows sending, the backend should reflect that.
                  // The backend API logic for `channels` endpoint might need to be robust.
                  // For now, we trust the `canSendMessages` property from the API.
                  setCanSend(c.canSendMessages ?? true)
                  found = true
                  break
               }
            }
            // If channel not found in the list (maybe it's hidden), we can't send.
            if (!found) setCanSend(false) 
         }).catch(e => {
            console.error(e)
            // If API fails, default to true or false? False is safer.
            setCanSend(false)
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
        const d = data as { 
          type?: string; 
          channel?: string; 
          user?: string; 
          userAvatar?: string; 
          userId?: string; 
          active?: boolean; 
          message?: { id: string; text: string; attachmentUrl?: string; ts?: string }; 
          messageId?: string;
          roleColor?: string 
        }

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
              attachmentUrl: d.message!.attachmentUrl,
              ts: d.message!.ts || new Date().toISOString(),
              roleColor: d.roleColor
            }]
          })
          if (d.user) setTyping((prev) => { const next = new Set(prev); next.delete(d.user!); return next })
        }
        if (d.type === "message_delete" && d.channel === channelName && d.messageId) {
          setMsgs((prev) => prev.filter(m => m.id !== d.messageId))
        }
        if (d.type === "message_update" && d.channel === channelName && d.message) {
          setMsgs((prev) => prev.map(m => m.id === d.message!.id ? { ...m, text: d.message!.text } : m))
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

  const send = async () => {
    const t = text.trim()
    if (!t && !selectedFile) return
    setText("")
    // stop typing immediately when sending
    const ws = wsRef.current
    try {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "typing.stop", channel: channelName, user: display, userId: user?.id }))
      }
    } catch (e) { console.error(e) }
    
    let attachmentUrl: string | undefined
    if (selectedFile) {
       setIsUploading(true)
       try {
         const res = await api.uploadFile(token, selectedFile)
         if (res.url) attachmentUrl = res.url
         else alert("Upload failed")
       } catch {
         alert("Upload failed")
       } finally {
         setIsUploading(false)
         clearFile()
       }
       if (!attachmentUrl && !t) return // Upload failed and no text
    }

    try {
      if (token) {
        const r = await api.sendMessage(token, channelName, t, guildId, attachmentUrl)
        if ("error" in r) {
          console.error("Error sending message:", r.error)
          return
        }
        const ts = r.message.ts
        setMsgs((prev) => {
          if (prev.some((x) => x.id === r.message!.id)) return prev
          return [...prev, { id: r.message!.id, user: display, userAvatar: myAvatar || undefined, userId: user?.id, text: t, attachmentUrl: (r.message).attachmentUrl, ts, roleColor: (r.message).roleColor }]
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

                    {/* Messages Loop */}
                    {g.messages.map((it, idx) => {
                      const isEditing = editingId === it.id
                      const isMyMessage = isMe || (user && g.userId === user.id)
                      const isMentioned = user && it.text.includes(`@${user.username}`)

                      return (
                        <div key={it.id} className={cn("relative group/msg hover:bg-black/5 -mx-4 px-4 py-0.5", idx > 0 && "mt-0.5", isMentioned && "bg-blue-500/10 border-l-2 border-blue-500 hover:bg-blue-500/15")}>
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
                             <div className={cn("text-sm text-foreground whitespace-pre-wrap wrap-break-words leading-snug pr-12", isMentioned && "bg-blue-500/10 p-0.5 rounded inline-block w-full")}>
                                {it.text.split(/(@[a-zA-Z0-9_]+)/g).map((part, i) => {
                                    if (part.startsWith('@')) {
                                        const isMe = user && part === `@${user.username}`
                                        return <span key={i} className={cn("bg-primary/10 text-primary rounded px-0.5 font-medium", isMe && "bg-yellow-500/20 text-yellow-200")}>{part}</span>
                                    }
                                    return part
                                })}
                             </div>
                          )}
                          
                          {it.attachmentUrl && (
                             <div className="mt-2">
                                {it.attachmentUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                                   <img src={getFullUrl(it.attachmentUrl) || ""} alt="Attachment" className="max-w-sm max-h-80 rounded-md object-contain" />
                                ) : it.attachmentUrl.match(/\.(mp4|webm|mov)$/i) ? (
                                   <video src={getFullUrl(it.attachmentUrl) || ""} controls className="max-w-sm max-h-80 rounded-md" />
                                ) : (
                                   <a href={getFullUrl(it.attachmentUrl) || ""} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-blue-400 hover:underline bg-secondary/20 p-2 rounded w-fit">
                                      <FileIcon className="h-4 w-4" />
                                      Download Attachment
                                   </a>
                                )}
                             </div>
                          )}
                          
                          {!isEditing && isMyMessage && (
                            <div className="absolute right-4 top-0 hidden group-hover/msg:flex items-center bg-background border rounded shadow-sm z-10">
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
        <div className="px-4 pt-1 text-xs text-muted-foreground animate-pulse font-medium">{Array.from(typing).join(", ")} is typing…</div>
      )}
      <div className="flex h-auto min-h-16 flex-col justify-center border-t border-border px-3 bg-background py-2">
        {selectedFile && (
           <div className="flex items-center gap-2 bg-muted/50 p-2 rounded mb-2">
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
               <div className="absolute bottom-full left-0 w-64 bg-popover border border-border rounded-md shadow-lg mb-2 overflow-hidden z-50">
                 <div className="text-xs font-bold text-muted-foreground px-3 py-2 bg-muted/50">MEMBERS MATCHING @{mentionQuery}</div>
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
              className="border-0 bg-muted/50 focus-visible:ring-1 focus-visible:ring-ring"
              placeholder={!canSend ? "You do not have permission to send messages in this channel." : (variant === "guild" ? `Message #${channelName}` : `Message ${dmUser ? (dmUser.displayName || dmUser.username) : "Direct Message"}`)}
              disabled={!canSend || isUploading}
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
          <Button variant="brand" onClick={send} disabled={!canSend}>Send</Button>
        </div>
        {text.length > 4000 && (
          <div className={cn("text-xs text-right px-1 mt-1", text.length >= 5000 ? "text-destructive" : "text-muted-foreground")}>
            {text.length}/5000
          </div>
        )}
      </div>

      <UserProfileDialog 
        userId={selectedUserId} 
        isOpen={!!selectedUserId} 
        onClose={() => setSelectedUserId(null)} 
      />
    </div>
  )
}
