import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react"
import { useAuth } from "../hooks/useAuth"
import { api } from "../lib/api"
import type { Notification as AppNotification } from "../types"

interface NotificationContextType {
  notifications: AppNotification[]
  unreadCount: number
  markRead: (id: string) => void
  markChannelRead: (channelId: string) => void
  markAllRead: () => void
  deleteNotification: (id: string) => void
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined)

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated } = useAuth()
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const wsRef = useRef<WebSocket | null>(null)
  const [retryCount, setRetryCount] = useState(0)

  // Fetch initial notifications
  useEffect(() => {
    if (isAuthenticated && user) {
      const token = localStorage.getItem("token") || ""
      api.getNotifications(token).then(res => {
        if (res.notifications) {
           setNotifications(res.notifications)
        }
      }).catch(console.error)
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNotifications([])
    }
  }, [isAuthenticated, user])

  // WebSocket Connection for Notifications
  useEffect(() => {
    if (!isAuthenticated || !user) {
       if (wsRef.current) {
         wsRef.current.close()
         wsRef.current = null
       }
       return
    }

    let ws: WebSocket | null = null
    
    // We use the same WS endpoint, but subscribe to `user:${userId}`
    // We need to get the WS URL first. We can reuse the logic from ChatPanel or just assume the endpoint.
    // Let's use api.socketInfo to get the URL, passing a dummy channel or our user channel.
    // The backend socket-info endpoint just returns the base WS URL essentially.
    
    const userChannel = `user:${user.id}`
    
    api.socketInfo(userChannel).then(info => {
       ws = new WebSocket(info.wsUrl)
       wsRef.current = ws
       
       ws.onopen = () => {
         ws?.send(JSON.stringify({ type: "subscribe", channel: userChannel }))
       }
       
       ws.onmessage = (ev) => {
         try {
           const data = JSON.parse(String(ev.data))
          if (data.type === "notification" && data.notification) {
            const n = data.notification as AppNotification
            setNotifications(prev => [n, ...prev])
            
            // Play sound or visual cue if not quiet mode
             // The notification object has a `quiet` property from backend based on user settings
             if (!n.quiet) {
                // We can trigger a sound here if desired
                // new Audio('/notification.mp3').play().catch(() => {})
             }
           }
         } catch (e) {
           console.error("Error processing notification:", e)
         }
       }
       
       ws.onclose = () => {
         // Simple retry logic
         setTimeout(() => setRetryCount(c => c + 1), 3000)
       }
    })

    return () => {
      if (wsRef.current) wsRef.current.close()
    }
  }, [isAuthenticated, user, retryCount])

  const markRead = useCallback(async (id: string) => {
    const token = localStorage.getItem("token") || ""
    // Optimistic update
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
    await api.markNotificationRead(token, id)
  }, [])

  const markChannelRead = useCallback(async (channelId: string) => {
    const token = localStorage.getItem("token") || ""
    setNotifications(prev => prev.map(n => n.channelId === channelId ? { ...n, read: true } : n))
    await api.markChannelNotificationsRead(token, channelId)
  }, [])

  const markAllRead = useCallback(async () => {
    const token = localStorage.getItem("token") || ""
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
    await api.markAllNotificationsRead(token)
  }, [])

  const deleteNotification = useCallback(async (id: string) => {
    const token = localStorage.getItem("token") || ""
    setNotifications(prev => prev.filter(n => n.id !== id))
    await api.deleteNotification(token, id)
  }, [])

  const unreadCount = notifications.filter(n => !n.read).length

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, markRead, markChannelRead, markAllRead, deleteNotification }}>
      {children}
    </NotificationContext.Provider>
  )
}

//eslint-disable-next-line react-refresh/only-export-components
export function useNotifications() {
  const context = useContext(NotificationContext)
  if (!context) throw new Error("useNotifications must be used within NotificationProvider")
  return context
}
