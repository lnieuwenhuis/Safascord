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
const NOTIFICATION_LIMIT = 100
const FALLBACK_POLL_INTERVAL_MS = 2000

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, token } = useAuth()
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const notificationsRef = useRef<AppNotification[]>([])
  const wsRef = useRef<WebSocket | null>(null)
  const socketConnectedRef = useRef(false)
  const retryAttemptRef = useRef(0)
  const reconnectTimeoutRef = useRef<number | null>(null)

  const mergeNotifications = useCallback((incoming: AppNotification[]) => {
    setNotifications((prev) => {
      const incomingIds = new Set<string>()
      const prevById = new Map(prev.map((n) => [n.id, n]))

      const merged = incoming.map((n) => {
        incomingIds.add(n.id)
        const existing = prevById.get(n.id)
        if (!existing) return n
        // Preserve optimistic read state until backend catches up.
        return { ...n, read: existing.read || n.read }
      })

      for (const n of prev) {
        if (!incomingIds.has(n.id)) merged.push(n)
      }

      merged.sort((a, b) => {
        const aTs = Date.parse(a.ts)
        const bTs = Date.parse(b.ts)
        if (Number.isNaN(aTs) || Number.isNaN(bTs)) return 0
        return bTs - aTs
      })
      return merged.slice(0, NOTIFICATION_LIMIT)
    })
  }, [])

  const fetchNotifications = useCallback(async () => {
    if (!isAuthenticated || !user) return
    const authToken = token || localStorage.getItem("token") || ""
    if (!authToken) return
    try {
      const res = await api.getNotifications(authToken)
      if (res.notifications) mergeNotifications(res.notifications)
    } catch (e) {
      console.error("Failed to fetch notifications", e)
    }
  }, [isAuthenticated, user, token, mergeNotifications])

  useEffect(() => {
    if (!isAuthenticated || !user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNotifications([])
      return
    }
    void fetchNotifications()
  }, [isAuthenticated, user, fetchNotifications])

  // WebSocket Connection for Notifications
  useEffect(() => {
    if (!isAuthenticated || !user) {
       if (wsRef.current) {
         wsRef.current.close()
         wsRef.current = null
       }
       socketConnectedRef.current = false
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
          socketConnectedRef.current = true
          ws.send(JSON.stringify({ type: "subscribe", channel: userChannel }))
        }

        ws.onmessage = (ev) => {
          try {
            const data = JSON.parse(String(ev.data))
            if (data.type === "notification" && data.notification) {
              const n = data.notification as AppNotification
              setNotifications((prev) => {
                if (prev.some((existing) => existing.id === n.id)) return prev
                return [n, ...prev].slice(0, NOTIFICATION_LIMIT)
              })
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
          socketConnectedRef.current = false
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
      socketConnectedRef.current = false
    }
  }, [isAuthenticated, user])

  // If websocket delivery is unavailable, keep notifications fresh without requiring reload.
  useEffect(() => {
    if (!isAuthenticated || !user) return
    let cancelled = false

    const poll = async () => {
      if (cancelled || socketConnectedRef.current) return
      await fetchNotifications()
    }

    const interval = window.setInterval(() => {
      void poll()
    }, FALLBACK_POLL_INTERVAL_MS)

    const onForeground = () => {
      if (document.visibilityState !== "visible") return
      void poll()
    }

    document.addEventListener("visibilitychange", onForeground)
    window.addEventListener("focus", onForeground)

    void poll()

    return () => {
      cancelled = true
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", onForeground)
      window.removeEventListener("focus", onForeground)
    }
  }, [isAuthenticated, user, fetchNotifications])

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
