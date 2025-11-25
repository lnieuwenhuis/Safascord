import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { useState } from "react"
import { api } from "@/lib/api"
import { useAuth } from "@/hooks/useAuth"
import { Mail, Lock, User as UserIcon, Monitor } from "lucide-react"

export default function Auth() {
  const navigate = useNavigate()
  const location = useLocation() as { state?: { from?: Location } }
  const from = location.state?.from?.pathname || "/channels/@me"
  const { login } = useAuth()
  
  const [mode, setMode] = useState<"login" | "register">("login")
  const [identifier, setIdentifier] = useState("")
  const [password, setPassword] = useState("")
  const [username, setUsername] = useState("")
  const [email, setEmail] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  const submit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    setError("")
    setIsLoading(true)
    
    try {
      if (mode === "login") {
        const r = await api.login(identifier, password)
        if (r.error || !r.token || !r.user) { 
          setError(r.error || "Invalid credentials")
          setIsLoading(false)
          return 
        }
        login(r.token, r.user)
        navigate(from, { replace: true })
      } else {
        const r = await api.register(username, email, password, displayName || undefined)
        if (r.error || !r.token || !r.user) { 
          setError(r.error || "Registration failed")
          setIsLoading(false)
          return 
        }
        login(r.token, r.user)
        navigate(from, { replace: true })
      }
    } catch {
      setError("Something went wrong. Please try again.")
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background p-4 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]"></div>
      <div className="absolute left-0 top-0 -z-10 h-[500px] w-[500px] -translate-x-[30%] -translate-y-[20%] rounded-full bg-primary/20 opacity-50 blur-[80px]"></div>
      <div className="absolute right-0 bottom-0 -z-10 h-[500px] w-[500px] translate-x-[30%] translate-y-[20%] rounded-full bg-primary/10 opacity-50 blur-[80px]"></div>

      <div className="relative w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center space-y-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
            <Monitor className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            {mode === "login" ? "Welcome back" : "Create an account"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {mode === "login" 
              ? "Enter your credentials to access your account" 
              : "Enter your details to get started"}
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4 rounded-xl border border-border bg-card/50 p-6 shadow-xl backdrop-blur-sm">
          {mode === "login" ? (
            <>
              <div className="space-y-2">
                <div className="relative">
                  <UserIcon className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input 
                    placeholder="Username or email" 
                    className="pl-9"
                    value={identifier} 
                    onChange={(e) => setIdentifier(e.target.value)} 
                    autoFocus
                  />
                </div>
              </div>
              <div className="space-y-2">
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input 
                    type="password" 
                    placeholder="Password" 
                    className="pl-9"
                    value={password} 
                    onChange={(e) => setPassword(e.target.value)} 
                  />
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <div className="relative">
                  <UserIcon className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input 
                    placeholder="Username" 
                    className="pl-9"
                    value={username} 
                    onChange={(e) => setUsername(e.target.value)} 
                    autoFocus
                  />
                </div>
              </div>
              <div className="space-y-2">
                <div className="relative">
                  <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input 
                    type="email" 
                    placeholder="Email" 
                    className="pl-9"
                    value={email} 
                    onChange={(e) => setEmail(e.target.value)} 
                  />
                </div>
              </div>
              <div className="space-y-2">
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input 
                    type="password" 
                    placeholder="Password" 
                    className="pl-9"
                    value={password} 
                    onChange={(e) => setPassword(e.target.value)} 
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Input 
                  placeholder="Display name (optional)" 
                  value={displayName} 
                  onChange={(e) => setDisplayName(e.target.value)} 
                />
              </div>
            </>
          )}

          {error && <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">{error}</div>}

          <Button type="submit" className="w-full font-medium" disabled={isLoading}>
            {isLoading ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              mode === "login" ? "Sign in" : "Create account"
            )}
          </Button>

          <div className="text-center text-sm text-muted-foreground">
            {mode === "login" ? "No account? " : "Already have an account? "}
            <button 
              type="button"
              className="font-medium text-primary hover:underline" 
              onClick={() => {
                setMode(mode === "login" ? "register" : "login")
                setError("")
              }}
            >
              {mode === "login" ? "Register" : "Sign in"}
            </button>
          </div>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          <Link to="/" className="hover:text-foreground transition-colors">
            &larr; Back to Home
          </Link>
        </p>
      </div>
    </div>
  )
}
