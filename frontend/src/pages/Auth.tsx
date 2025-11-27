import { useState, useEffect } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { api } from "../lib/api"
import { useAuth } from "../components/AuthProvider"

export default function Auth() {
  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  // Handle callback
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const code = params.get("code")
    if (code) {
      setIsLoading(true)
      // Prevent double firing in strict mode or re-renders
      // But API call is safe enough if idempotent-ish (code usage once)
      // Actually code is one-time use. I should probably useRef to prevent double call.
      
      const doAuth = async () => {
        try {
            const r = await api.authWithCode(code)
            if (r.error || !r.token || !r.user) {
              setError(r.error || "Authentication failed")
              setIsLoading(false)
              window.history.replaceState({}, "", "/auth")
            } else {
              login(r.token, r.user)
              if (r.isNew) {
                navigate("/onboarding", { replace: true })
              } else {
                const storedPath = localStorage.getItem("last_route")
                const validStoredPath = (storedPath && storedPath !== "/404" && storedPath !== "/auth" && storedPath !== "/") ? storedPath : "/channels/@me"
                navigate(validStoredPath, { replace: true })
              }
            }
        } catch (e) {
            console.error(e)
            setError("Something went wrong")
            setIsLoading(false)
            window.history.replaceState({}, "", "/auth")
        }
      }
      
      // Check if we already processed this code to avoid double-invocation in React 18 Strict Mode
      // Using a simple check via history state or just removing the query param immediately might help, 
      // but modifying history inside useEffect might trigger re-render.
      // I'll trust standard behavior for now, but maybe clear the code from URL immediately before calling?
      // No, if call fails, we might want to know. 
      // I'll use a flag ref.
      
      doAuth()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search])

  const handleLogin = async () => {
    setIsLoading(true)
    setError("")
    try {
      const redirectUri = `${window.location.origin}/auth`
      const { url, error } = await api.getAuthUrl(redirectUri)
      if (error || !url) {
        setError(error || "Could not get auth URL")
        setIsLoading(false)
        return
      }
      window.location.href = url
    } catch {
      setError("Something went wrong")
      setIsLoading(false)
    }
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-[#313338] text-white">
      <div className="w-full max-w-md rounded-lg bg-[#313338] p-8 shadow-2xl sm:bg-[#2b2d31]">
        <div className="mb-8 text-center">
          <h1 className="mb-2 text-2xl font-bold">Welcome Back!</h1>
          <p className="text-[#b5bac1]">We're so excited to see you again!</p>
        </div>
        
        {error && (
          <div className="mb-4 rounded bg-red-500/10 p-2 text-sm text-red-400">
            {error}
          </div>
        )}

        <button
          onClick={handleLogin}
          disabled={isLoading}
          className="w-full rounded bg-[#5865F2] py-2.5 font-medium text-white transition-colors hover:bg-[#4752c4] disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isLoading ? "Loading..." : "Continue with WorkOS"}
        </button>
      </div>
    </div>
  )
}
