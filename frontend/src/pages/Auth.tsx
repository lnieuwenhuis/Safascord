import { useEffect, useMemo, useRef, useState } from "react"
import { createShooAuth } from "@shoojs/auth"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { api } from "../lib/api"
import { useAuth } from "../components/AuthProvider"

export default function Auth() {
  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [identityToken, setIdentityToken] = useState<string | null>(null)
  const { login } = useAuth()
  const navigate = useNavigate()
  const processedTokenRef = useRef<string | null>(null)

  const shoo = useMemo(() => createShooAuth({
    shooBaseUrl: import.meta.env.VITE_SHOO_BASE_URL || "https://shoo.dev",
    callbackPath: "/auth",
    fallbackPath: "/channels/@me",
    requestPii: true,
  }), [])

  useEffect(() => {
    let active = true

    const setup = async () => {
      try {
        if (shoo.parseCallback()) {
          await shoo.finishSignIn({ redirectAfter: false, clearCallbackParams: true })
        }
        if (!active) return
        const identity = shoo.getIdentity()
        setIdentityToken(identity.token || null)
      } catch (e) {
        console.error(e)
        if (active) {
          setError("Shoo sign-in failed. Please try again.")
          setIsLoading(false)
          setIdentityToken(null)
        }
      }
    }

    setup()
    return () => {
      active = false
    }
  }, [shoo])

  useEffect(() => {
    if (!identityToken) return
    if (processedTokenRef.current === identityToken) return

    processedTokenRef.current = identityToken

    const exchangeToken = async () => {
      setIsLoading(true)
      setError("")
      try {
        const result = await api.authWithShoo(identityToken)
        if (result.error || !result.token || !result.user) {
          setError(result.error || "Authentication failed")
          setIsLoading(false)
          processedTokenRef.current = null
          return
        }

        login(result.token, result.user)
        if (result.isNew) {
          navigate("/onboarding", { replace: true })
          return
        }

        const storedPath = localStorage.getItem("last_route")
        const validStoredPath = storedPath && storedPath !== "/404" && storedPath !== "/auth" && storedPath !== "/"
          ? storedPath
          : "/channels/@me"
        navigate(validStoredPath, { replace: true })
      } catch (e) {
        console.error(e)
        setError("Something went wrong")
        setIsLoading(false)
        processedTokenRef.current = null
      }
    }

    exchangeToken()
  }, [identityToken, login, navigate])

  const handleLogin = async () => {
    setError("")
    setIsLoading(true)
    const returnTo = localStorage.getItem("last_route") || "/channels/@me"
    try {
      await shoo.startSignIn({ requestPii: true, returnTo })
    } catch (e) {
      console.error(e)
      setError("Could not start Shoo sign-in")
      setIsLoading(false)
    }
  }

  const pending = isLoading

  return (
    <div className="relative flex min-h-dvh w-screen items-center justify-center px-5 py-12">
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-base-200/60 via-base-100 to-base-100" />
      <div className="card w-full max-w-md border border-base-300/70 bg-base-100/90 shadow-2xl backdrop-blur-sm">
        <div className="card-body gap-6 p-8">
          <div className="space-y-2 text-center">
            <div className="badge badge-outline badge-primary border-primary/30 px-3 py-2 text-[11px] tracking-[0.2em]">
              AUTHENTICATION
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Welcome back</h1>
            <p className="text-base-content/60">Sign in securely with Shoo to continue.</p>
          </div>

          {error && (
            <div className="alert alert-error py-2 text-sm">
              <span>{error}</span>
            </div>
          )}

          <Button onClick={handleLogin} disabled={pending} size="lg" className="w-full rounded-xl">
            {pending ? <span className="loading loading-spinner loading-sm" /> : null}
            {pending ? "Authenticating..." : "Continue with Shoo"}
          </Button>

          <p className="text-center text-xs text-base-content/55">
            Identity verification is powered by Shoo.
          </p>
        </div>
      </div>
    </div>
  )
}
