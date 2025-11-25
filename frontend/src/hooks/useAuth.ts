export function useAuth() {
  const isAuthenticated = typeof window !== "undefined" && localStorage.getItem("auth") === "1"
  return { isAuthenticated }
}

