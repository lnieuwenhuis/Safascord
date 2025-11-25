import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { useState } from "react"
import { api } from "@/lib/api"

export default function Auth() {
  const navigate = useNavigate()
  const location = useLocation() as { state?: { from?: Location } }
  const from = location.state?.from?.pathname || "/channels/@me"
  const [mode, setMode] = useState<"login" | "register">("login")
  const [identifier, setIdentifier] = useState("")
  const [password, setPassword] = useState("")
  const [username, setUsername] = useState("")
  const [email, setEmail] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [error, setError] = useState("")
  const submit = async () => {
    setError("")
    try {
      if (mode === "login") {
        const r = await api.login(identifier, password)
        if (r.error || !r.token || !r.user) { setError(r.error || "Invalid credentials"); return }
        localStorage.setItem("token", r.token)
        localStorage.setItem("user", JSON.stringify(r.user))
        navigate(from, { replace: true })
      } else {
        const r = await api.register(username, email, password, displayName || undefined)
        if (r.error || !r.token || !r.user) { setError(r.error || "Registration failed"); return }
        localStorage.setItem("token", r.token)
        localStorage.setItem("user", JSON.stringify(r.user))
        navigate(from, { replace: true })
      }
    } catch {
      setError("Something went wrong")
    }
  }
  return (
    <div className="min-h-dvh bg-gradient-to-b from-[#0a0f1a] to-[#0b1b2e]">
      <div className="mx-auto max-w-md px-6 py-24">
        <h1 className="text-center text-3xl font-bold">{mode === "login" ? "Sign in" : "Create account"}</h1>
        <div className="mt-8 grid gap-4">
          {mode === "login" ? (
            <>
              <Input placeholder="Username or email" value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
              <Input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
              {error && <div className="text-sm text-red-500">{error}</div>}
              <Button variant="brand" onClick={submit}>Sign in</Button>
              <div className="text-center text-xs text-muted-foreground">No account? <button className="underline" onClick={() => setMode("register")}>Register</button></div>
            </>
          ) : (
            <>
              <Input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
              <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
              <Input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <Input placeholder="Display name (optional)" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              {error && <div className="text-sm text-red-500">{error}</div>}
              <Button variant="brand" onClick={submit}>Create account</Button>
              <div className="text-center text-xs text-muted-foreground">Have an account? <button className="underline" onClick={() => setMode("login")}>Sign in</button></div>
            </>
          )}
          <Link to="/">
            <Button variant="outline">Back to Home</Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
