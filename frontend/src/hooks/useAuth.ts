export function useAuth() {
  const isAuthenticated = typeof window !== "undefined" && !!localStorage.getItem("token")
  const userRaw = typeof window !== "undefined" ? localStorage.getItem("user") : null
  const user = userRaw ? JSON.parse(userRaw) : null
  return { isAuthenticated, user }
}
