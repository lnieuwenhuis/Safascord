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
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, token } = useAuth()
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const notificationsRef = useRef<AppNotification[]>([])
  const wsRef = useRef<WebSocket | null>(null)
  const retryAttemptRef = useRef(0)
  const reconnectTimeoutRef = useRef<number | null>(null)

  // Fetch initial notifications
  useEffect(() => {
    if (isAuthenticated && user) {
      const authToken = token || localStorage.getItem("token") || ""
      if (!authToken) return
      api.getNotifications(authToken).then(res => {
        if (res.notifications) {
           setNotifications(res.notifications)
        }
      }).catch(console.error)
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNotifications([])
    }
  }, [isAuthenticated, user, token])

  // WebSocket Connection for Notifications
  useEffect(() => {
    if (!isAuthenticated || !user) {
       if (wsRef.current) {
         wsRef.current.close()
         wsRef.current = null
       }
       if (reconnectTimeoutRef.current) {
         window.clearTimeout(reconnectTimeoutRef.current)
         reconnectTimeoutRef.current = null
       }
       return
    }

    let cancelled = false
    const userChannel = `user:${user.id}`

    const scheduleReconnect = () => {
      if (cancelled) return
      const delay = Math.min(1000 * (2 ** retryAttemptRef.current), 10000)
      retryAttemptRef.current += 1
      reconnectTimeoutRef.current = window.setTimeout(() => {
        connect()
      }, delay)
    }

    const connect = async () => {
      try {
        const info = await api.socketInfo(userChannel)
        if (cancelled) return

        const ws = new WebSocket(info.wsUrl)
        wsRef.current = ws

        ws.onopen = () => {
          retryAttemptRef.current = 0
          ws.send(JSON.stringify({ type: "subscribe", channel: userChannel }))
        }

        ws.onmessage = (ev) => {
          try {
            const data = JSON.parse(String(ev.data))
            if (data.type === "notification" && data.notification) {
              const n = data.notification as AppNotification
              setNotifications((prev) => [n, ...prev])
            }
          } catch (e) {
            console.error("Error processing notification:", e)
          }
        }

        ws.onerror = () => {
          try {
            ws.close()
          } catch (e) {
            console.error("Failed to close notifications socket", e)
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
      if (wsRef.current) wsRef.current.close()
    }
  }, [isAuthenticated, user])

  useEffect(() => {
    notificationsRef.current = notifications
  }, [notifications])

  const markRead = useCallback(async (id: string) => {
    const authToken = token || localStorage.getItem("token") || ""
    if (!authToken) return
    // Optimistic update
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
    await api.markNotificationRead(authToken, id)
  }, [token])

  const markChannelRead = useCallback(async (channelId: string) => {
    const authToken = token || localStorage.getItem("token") || ""
    if (!authToken || !UUID_RE.test(channelId)) return
    const hasUnread = notificationsRef.current.some((n) => n.channelId === channelId && !n.read)
    if (!hasUnread) return
    setNotifications(prev => prev.map(n => n.channelId === channelId ? { ...n, read: true } : n))
    await api.markChannelNotificationsRead(authToken, channelId)
  }, [token])

  const markAllRead = useCallback(async () => {
    const authToken = token || localStorage.getItem("token") || ""
    if (!authToken) return
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
    await api.markAllNotificationsRead(authToken)
  }, [token])

  const deleteNotification = useCallback(async (id: string) => {
    const authToken = token || localStorage.getItem("token") || ""
    if (!authToken) return
    setNotifications(prev => prev.filter(n => n.id !== id))
    await api.deleteNotification(authToken, id)
  }, [token])

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
