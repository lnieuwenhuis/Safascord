import { useState, useRef, useEffect } from "react"
import { useNotifications } from "../NotificationProvider"
import { useAuth } from "../../hooks/useAuth"
import { Bell, Check, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

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
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [ref])

  return (
    <div className="relative" ref={ref}>
      <div 
        className="relative flex items-center justify-center w-12 h-12 mb-2 cursor-pointer group"
        onClick={() => setOpen(!open)}
      >
         <div className={cn(
           "flex items-center justify-center w-12 h-12 rounded-[24px] group-hover:rounded-[16px] transition-all duration-200",
           open ? "bg-primary text-primary-foreground rounded-[16px]" : "bg-background text-foreground hover:bg-primary hover:text-primary-foreground",
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

      {open && (
        <div className="absolute bottom-0 left-14 w-80 bg-card border border-border shadow-xl rounded-md overflow-hidden z-50 flex flex-col max-h-[500px]">
          <div className="flex items-center justify-between p-4 border-b border-border shrink-0 bg-card">
            <h4 className="font-semibold">Inbox</h4>
            <div className="flex gap-1">
               <Button variant="ghost" size="icon" className="h-8 w-8" onClick={markAllRead} title="Mark all read">
                 <Check className="w-4 h-4" />
               </Button>
            </div>
          </div>
          <div className="overflow-y-auto flex-1">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full p-8 text-center text-muted-foreground min-h-[200px]">
                <Bell className="w-12 h-12 mb-2 opacity-20" />
                <p>No notifications</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {notifications.map(n => (
                  <div key={n.id} className={cn("p-4 transition-colors hover:bg-muted/50", !n.read && "bg-primary/5")}>
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground mb-1">{n.content}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatTimeAgo(new Date(n.ts))}
                        </p>
                      </div>
                      <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {!n.read && (
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); markRead(n.id) }}>
                            <div className="w-2 h-2 bg-primary rounded-full" />
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
      )}
    </div>
  )
}
