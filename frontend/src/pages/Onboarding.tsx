import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "../components/AuthProvider"
import { api } from "../lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export default function Onboarding() {
  const { user, updateUser, isAuthenticated, isLoading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")

  const [username, setUsername] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [bio, setBio] = useState("")

  useEffect(() => {
     if (!authLoading && !isAuthenticated) {
         navigate("/auth")
     }
     if (user) {
         // Only set initial values if state is empty
         setUsername(prev => prev || user.username)
         setDisplayName(prev => prev || (user.displayName || user.username))
     }
  }, [user, isAuthenticated, authLoading, navigate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return
    setIsLoading(true)
    setError("")

    try {
      const token = localStorage.getItem("token")
      if (!token) throw new Error("No token")

      const res = await api.updateProfile(token, {
        username,
        displayName,
        bio
      })

      if (res.error) {
        setError(res.error)
        setIsLoading(false)
        return
      }

      if (res.user) {
        updateUser(res.user)
        // Navigate to home or stored path
        const storedPath = localStorage.getItem("last_route")
        const validStoredPath = (storedPath && storedPath !== "/404" && storedPath !== "/auth" && storedPath !== "/") ? storedPath : "/channels/@me"
        navigate(validStoredPath, { replace: true })
      }
    } catch (err) {
      console.error(err)
      setError("Failed to update profile")
      setIsLoading(false)
    }
  }
  
  if (authLoading) return <div className="flex h-screen items-center justify-center bg-[#313338] text-white">Loading...</div>

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-[#313338] text-white">
      <div className="w-full max-w-md rounded-lg bg-[#313338] p-8 shadow-2xl sm:bg-[#2b2d31]">
        <div className="mb-8 text-center">
          <h1 className="mb-2 text-2xl font-bold">Welcome!</h1>
          <p className="text-[#b5bac1]">Let's set up your profile before we jump in.</p>
        </div>

        {error && (
          <div className="mb-4 rounded bg-red-500/10 p-2 text-sm text-red-400">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="username" className="text-xs font-bold uppercase text-[#b5bac1]">
              Username
            </label>
            <Input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="bg-[#1e1f22] border-none text-white focus-visible:ring-offset-0 focus-visible:ring-[#5865F2]"
              required
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="displayName" className="text-xs font-bold uppercase text-[#b5bac1]">
              Display Name
            </label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="bg-[#1e1f22] border-none text-white focus-visible:ring-offset-0 focus-visible:ring-[#5865F2]"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="bio" className="text-xs font-bold uppercase text-[#b5bac1]">
              About Me
            </label>
            <textarea
              id="bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Tell us about yourself..."
              className="flex min-h-[100px] w-full rounded-md bg-[#1e1f22] px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#5865F2] disabled:cursor-not-allowed disabled:opacity-50 resize-none text-white"
            />
          </div>

          <Button
            type="submit"
            disabled={isLoading}
            className="w-full bg-[#5865F2] hover:bg-[#4752c4] text-white font-medium py-2.5"
          >
            {isLoading ? "Saving..." : "Complete Setup"}
          </Button>
        </form>
      </div>
    </div>
  )
}
