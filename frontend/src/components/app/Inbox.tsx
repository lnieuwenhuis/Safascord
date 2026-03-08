import { useState, useRef, useEffect, useMemo } from "react"
import { useNotifications } from "../NotificationProvider"
import { useAuth } from "../../hooks/useAuth"
import { useNavigate } from "react-router-dom"
import { Bell, Check, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { createPortal } from "react-dom"
import { api } from "@/lib/api"
import { useAppCacheStore } from "@/stores/cacheStore"

function formatTimeAgo(date: Date) {
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000)
  let interval = seconds / 31536000
  if (interval > 1) return Math.floor(interval) + " years ago"
  interval = seconds / 2592000
  if (interval > 1) return Math.floor(interval) + " months ago"
  interval = seconds / 86400
  if (interval > 1) return Math.floor(interval) + " days ago"
  interval = seconds / 3600
  if (interval > 1) return Math.floor(interval) + " hours ago"
  interval = seconds / 60
  if (interval > 1) return Math.floor(interval) + " minutes ago"
  return Math.floor(seconds) + " seconds ago"
}

export default function Inbox() {
  const { notifications, unreadCount, markRead, markAllRead, deleteNotification } = useNotifications()
  const { user, token } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLDivElement>(null)
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)
  const cachedDms = useAppCacheStore((state) => state.dms)
  const setCachedDms = useAppCacheStore((state) => state.setDms)
  const authToken = token || (typeof window !== "undefined" ? localStorage.getItem("token") || "" : "")
  const dmCount = cachedDms?.length ?? 0

  useEffect(() => {
    if (!open || !authToken) return
    const needsDmNames = notifications.some((n) => (n.sourceType === "dm" || n.channelType === "dm") && !!n.channelId)
    if (!needsDmNames || dmCount > 0) return
    let cancelled = false

    api.getDMs(authToken).then((res) => {
      if (cancelled) return
      if (res.dms) setCachedDms(res.dms)
    }).catch(() => {})

    return () => {
      cancelled = true
    }
  }, [authToken, dmCount, notifications, open, setCachedDms])

  const dmNameByChannelId = useMemo(() => {
    const map: Record<string, string> = {}
    for (const dm of cachedDms ?? []) {
      map[dm.id] = dm.user.displayName || dm.user.username
    }
    return map
  }, [cachedDms])

  const getChannelLabel = (channelId?: string, sourceType?: string, channelType?: string, channelName?: string) => {
    if (!channelId) return null
    if (sourceType === "dm" || channelType === "dm") {
      return dmNameByChannelId[channelId] || channelName || "Direct Message"
    }
    return channelName || channelId
  }

  const getNotificationContent = (n: typeof notifications[number]) => {
    const base = n.content || "New notification"
    if (!n.channelId) return base

    const channelLabel = getChannelLabel(n.channelId, n.sourceType, n.channelType, n.channelName)
    if (!channelLabel) return base

    if (base.includes(n.channelId)) {
      return base.split(n.channelId).join(channelLabel)
    }

    if ((n.sourceType === "dm" || n.channelType === "dm") && !base.includes(channelLabel)) {
      return `${base} in ${channelLabel}`
    }

    return base
  }

  const getNotificationTarget = (n: typeof notifications[number]) => {
    if (!n.channelId) return null
    if (n.sourceType === "dm" || n.channelType === "dm") {
      return `/channels/@me/${n.channelId}`
    }
    if (n.serverId) {
      return `/server/${n.serverId}/channel/${n.channelId}`
    }
    return null
  }

  useEffect(() => {
    if (!open) return
    const updateAnchor = () => {
      if (triggerRef.current) {
        setAnchorRect(triggerRef.current.getBoundingClientRect())
      }
    }
    updateAnchor()
    window.addEventListener("resize", updateAnchor)
    window.addEventListener("scroll", updateAnchor, true)
    return () => {
      window.removeEventListener("resize", updateAnchor)
      window.removeEventListener("scroll", updateAnchor, true)
    }
  }, [open])

  const panelLeft = (() => {
    if (typeof window === "undefined" || !anchorRect) return 88
    return Math.min(anchorRect.right + 12, window.innerWidth - 336)
  })()

  const panelTop = (() => {
    if (typeof window === "undefined" || !anchorRect) return 20
    const panelHeight = 500
    return Math.min(Math.max(12, anchorRect.bottom - panelHeight), window.innerHeight - panelHeight - 12)
  })()

  return (
    <div className="relative">
      <div 
        ref={triggerRef}
        className="relative flex items-center justify-center w-12 h-12 mb-2 cursor-pointer group"
        onClick={() => setOpen(!open)}
      >
         <div className={cn(
           "flex items-center justify-center w-12 h-12 rounded-[24px] group-hover:rounded-[16px] transition-all duration-200",
           open ? "bg-cyan-400/20 text-cyan-100 rounded-[16px]" : "bg-slate-900 text-slate-100 hover:bg-cyan-400/20 hover:text-cyan-100",
           unreadCount > 0 && !open && !user?.notificationsQuietMode ? "animate-bounce" : ""
         )}>
           <Bell className="w-6 h-6" />
         </div>
         {unreadCount > 0 && (
           <div className="absolute bottom-0 right-0 flex items-center justify-center min-w-[20px] h-5 px-1 text-xs font-bold text-white bg-red-500 rounded-full ring-2 ring-background">
             {unreadCount > 99 ? "99+" : unreadCount}
           </div>
         )}
      </div>

      {open && createPortal(
        <>
          <div className="fixed inset-0 z-[230]" onClick={() => setOpen(false)} />
          <div
            className="fixed z-[240] flex max-h-[500px] w-80 flex-col overflow-hidden rounded-xl border border-cyan-300/20 bg-slate-950 shadow-xl"
            style={{ left: `${panelLeft}px`, top: `${panelTop}px` }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-cyan-300/15 bg-slate-950 p-4 shrink-0">
              <h4 className="font-semibold">Inbox</h4>
              <div className="flex gap-1">
                 <Button variant="ghost" size="icon" className="h-8 w-8" onClick={markAllRead} title="Mark all read">
                   <Check className="w-4 h-4" />
                 </Button>
              </div>
            </div>
            <div className="overflow-y-auto flex-1">
              {notifications.length === 0 ? (
                <div className="flex h-full min-h-[200px] flex-col items-center justify-center p-8 text-center text-muted-foreground">
                  <Bell className="mb-2 h-12 w-12 opacity-20" />
                  <p>No notifications</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {notifications.map(n => (
                    <div
                      key={n.id}
                      className={cn("p-4 transition-colors hover:bg-muted/50 cursor-pointer", !n.read && "bg-primary/5")}
                      onClick={() => {
                        const target = getNotificationTarget(n)
                        markRead(n.id)
                        if (target) {
                          navigate(target)
                        }
                        setOpen(false)
                      }}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="mb-1 text-sm text-foreground">{getNotificationContent(n)}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatTimeAgo(new Date(n.ts))}
                          </p>
                        </div>
                        <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {!n.read && (
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); markRead(n.id) }}>
                              <div className="h-2 w-2 rounded-full bg-primary" />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={(e) => { e.stopPropagation(); deleteNotification(n.id) }}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  )
}
