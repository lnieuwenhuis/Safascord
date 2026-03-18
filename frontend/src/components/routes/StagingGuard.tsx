import { useMemo, useState } from "react"
import type { FormEvent } from "react"
import { Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const STORAGE_PREFIX = "staging_guard_passed:"

function isStagingHost() {
  if (typeof window === "undefined") return false
  return window.location.hostname.startsWith("staging.")
}

function getConfiguredPassword() {
  return (
    (import.meta.env.VITE_STAGING_GUARD_PASSWORD as string | undefined) ||
    (import.meta.env.VITE_STAGING_PASSWORD as string | undefined) ||
    ""
  ).trim()
}

export default function StagingGuard({ children }: { children: React.ReactNode }) {
  const [attempt, setAttempt] = useState("")
  const [error, setError] = useState("")

  const staging = useMemo(() => isStagingHost(), [])
  const password = useMemo(() => getConfiguredPassword(), [])

  if (!staging) return <>{children}</>

  const key = `${STORAGE_PREFIX}${window.location.hostname}`
  const unlocked = sessionStorage.getItem(key) === "1"
  if (unlocked) return <>{children}</>

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!password) {
      setError("Staging guard is enabled but no password is configured.")
      return
    }
    if (attempt === password) {
      sessionStorage.setItem(key, "1")
      window.location.reload()
      return
    }
    setError("Incorrect password")
  }

  return (
    <div className="safas-page flex items-center justify-center px-5 py-10">
      <div className="safas-panel w-full max-w-md p-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl border border-cyan-300/40 bg-cyan-400/15 text-cyan-200">
            <Lock className="h-5 w-5" />
          </div>
          <div>
            <p className="safas-label">Staging Access</p>
            <h1 className="text-2xl font-extrabold text-slate-50">Restricted Environment</h1>
          </div>
        </div>
        <p className="mb-6 text-sm text-slate-300/75">
          This staging deployment is password protected.
        </p>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <Input
            type="password"
            value={attempt}
            onChange={(event) => {
              setAttempt(event.target.value)
              setError("")
            }}
            placeholder="Enter staging password"
            autoFocus
          />
          {error ? <p className="text-sm text-red-300">{error}</p> : null}
          <Button type="submit" className="w-full">
            Continue to staging
          </Button>
        </form>
      </div>
    </div>
  )
}
