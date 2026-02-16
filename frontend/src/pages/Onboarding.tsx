import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "../components/AuthProvider"
import { api } from "../lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { User } from "@/types"

export default function Onboarding() {
  const { user, updateUser, isAuthenticated, isLoading: authLoading, token } = useAuth()
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
      const authToken = token || localStorage.getItem("token")
      if (!authToken) throw new Error("No token")

      const res = await api.updateProfile(authToken, {
        username,
        displayName,
        bio
      })

      if (res.error) {
        setError(res.error)
        setIsLoading(false)
        return
      }

      const updatedUser = res.user || ((res as User).id ? (res as User) : null)

      if (updatedUser) {
        updateUser(updatedUser)
        const storedPath = localStorage.getItem("last_route")
        const validStoredPath = (storedPath && storedPath !== "/404" && storedPath !== "/auth" && storedPath !== "/" && storedPath !== "/onboarding") ? storedPath : "/channels/@me"
        navigate(validStoredPath, { replace: true })
      } else {
        setIsLoading(false)
        setError("Unexpected response from server")
      }
    } catch (err) {
      console.error(err)
      setError("Failed to update profile")
      setIsLoading(false)
    }
  }
  
  if (authLoading) return (
    <div className="safas-page flex h-screen items-center justify-center">
      <div className="animate-pulse text-muted-foreground">Loading...</div>
    </div>
  )

  return (
    <div className="safas-page flex min-h-screen items-center justify-center p-4">
      <Card className="safas-panel relative z-10 w-full max-w-md border-cyan-300/20 bg-slate-900/70 shadow-xl">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-cyan-300/30 bg-cyan-400/10 text-cyan-200">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          </div>
          <CardTitle className="text-2xl font-bold text-slate-100">Welcome!</CardTitle>
          <CardDescription className="text-slate-300/72">Let's set up your profile before we jump in.</CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="mb-4 rounded-xl border border-red-300/30 bg-red-400/15 p-3 text-sm text-red-100">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="johndoe"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="displayName">Display Name</Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="John Doe"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bio">About Me</Label>
              <Textarea
                id="bio"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Tell us a bit about yourself..."
                className="min-h-[100px] resize-none"
              />
            </div>

            <Button
              type="submit"
              disabled={isLoading}
              className="w-full"
            >
              {isLoading ? "Saving..." : "Complete Setup"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
