import React, { createContext, useContext, useEffect, useState, useCallback } from "react"
import { api } from "../lib/api"
import type { User } from "../types"

interface AuthContextType {
  isAuthenticated: boolean
  user: User | null
  login: (token: string, user: User) => void
  logout: () => void
  checkSession: () => Promise<void>
  updateUser: (user: User) => void
  isLoading: boolean
  token?: string | null
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  const logout = useCallback(() => {
    localStorage.removeItem("token")
    localStorage.removeItem("user")
    localStorage.removeItem("shoo_identity")
    setUser(null)
    setIsAuthenticated(false)
  }, [])

  const updateUser = useCallback((newUser: User) => {
    setUser(newUser)
    localStorage.setItem("user", JSON.stringify(newUser))
  }, [])

  const checkSession = useCallback(async () => {
    const token = localStorage.getItem("token")
    if (!token) {
      setIsAuthenticated(false)
      setUser(null)
      setIsLoading(false)
      return
    }

    const cachedUser = localStorage.getItem("user")
    if (cachedUser) {
      try {
        const parsed = JSON.parse(cachedUser) as User
        setUser((prev) => prev ?? parsed)
        setIsAuthenticated(true)
      } catch {
        // Ignore invalid cache and continue with API validation.
      }
    }

    try {
      const res = await api.me(token)
      if (res.error || !res.user) {
        logout()
      } else {
        setUser(res.user)
        setIsAuthenticated(true)
        localStorage.setItem("user", JSON.stringify(res.user))
      }
    } catch (err) {
      console.error("Session check failed", err)
      const message = err instanceof Error ? err.message.toLowerCase() : ""
      if (message.includes("unauthorized") || message.includes("forbidden") || message.includes("401")) {
        logout()
      } else if (localStorage.getItem("token")) {
        // Keep active session on transient API failures.
        setIsAuthenticated(true)
      }
    } finally {
      setIsLoading(false)
    }
  }, [logout])

  const login = useCallback((token: string, user: User) => {
    localStorage.setItem("token", token)
    localStorage.setItem("user", JSON.stringify(user))
    setUser(user)
    setIsAuthenticated(true)
  }, [])

  useEffect(() => {
    checkSession()
  }, [checkSession])

  useEffect(() => {
    const handleUnauthorized = () => {
      logout()
    }
    window.addEventListener("auth:unauthorized", handleUnauthorized)
    return () => window.removeEventListener("auth:unauthorized", handleUnauthorized)
  }, [logout])

  // Periodic session check (every 60s)
  useEffect(() => {
    if (!isAuthenticated) return
    const interval = setInterval(() => {
      checkSession()
    }, 60000)
    return () => clearInterval(interval)
  }, [isAuthenticated, checkSession])

  const token = isAuthenticated ? localStorage.getItem("token") : null

  return (
    <AuthContext.Provider value={{ isAuthenticated, user, login, logout, checkSession, updateUser, isLoading, token }}>
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
