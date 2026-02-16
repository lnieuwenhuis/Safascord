import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { ArrowRight, Users } from "lucide-react"
import { api, getFullUrl } from "@/lib/api"
import { Button } from "@/components/ui/button"
import type { InviteInfo } from "@/types"

export default function Invite() {
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const [invite, setInvite] = useState<InviteInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(Boolean(code))
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null

  useEffect(() => {
    if (!code) return

    api.inviteInfo(code)
      .then((response) => {
        if (response.error) {
          setError(response.error)
          return
        }

        if (response.code && response.server) {
          setInvite({
            code: response.code,
            serverId: response.server.id,
            serverName: response.server.name,
            serverIcon: response.server.iconUrl,
            serverBanner: response.server.bannerUrl,
            expired: false,
            full: false,
          })
          return
        }

        if (response.invite) {
          setInvite(response.invite)
          return
        }

        setError("Invite not found or expired")
      })
      .catch(() => setError("Failed to load invite"))
      .finally(() => setLoading(false))
  }, [code])

  const handleJoin = async () => {
    if (!token) {
      navigate("/auth")
      return
    }
    if (!invite) return

    try {
      const response = await api.acceptInvite(token, invite.code)
      if (response.success || response.ok) {
        navigate(`/server/${invite.serverId}`)
      } else {
        setError(response.error || "Failed to join server")
      }
    } catch {
      setError("Failed to join server")
    }
  }

  if (!code) {
    return (
      <div className="safas-page flex items-center justify-center px-4">
        <div className="safas-panel w-full max-w-md p-7 text-center">
          <p className="safas-label mb-3">Invite Error</p>
          <h1 className="text-2xl font-bold text-slate-100">Invalid invite code</h1>
          <p className="mt-3 text-slate-300/75">The link is missing a valid invite code.</p>
          <div className="mt-7">
            <Button onClick={() => navigate("/")} variant="outline">Back to home</Button>
          </div>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="safas-page flex items-center justify-center">
        <div className="safas-panel px-6 py-5 text-sm text-slate-200">Loading invite...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="safas-page flex items-center justify-center px-4">
        <div className="safas-panel w-full max-w-md p-7 text-center">
          <p className="safas-label mb-3">Invite Error</p>
          <h1 className="text-2xl font-bold text-slate-100">Unable to open invite</h1>
          <p className="mt-3 text-slate-300/75">{error}</p>
          <div className="mt-7">
            <Button onClick={() => navigate("/")} variant="outline">Back to home</Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="safas-page relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      {invite?.serverBanner ? (
        <div className="absolute inset-0 -z-10">
          <img
            src={getFullUrl(invite.serverBanner) || ""}
            alt=""
            className="h-full w-full object-cover opacity-30 blur-2xl"
          />
        </div>
      ) : null}

      <div className="safas-panel w-full max-w-lg p-8 text-center">
        <p className="safas-label mb-4">Server Invite</p>
        {invite?.serverIcon ? (
          <div className="mx-auto mb-4 h-20 w-20 overflow-hidden rounded-2xl border border-cyan-300/30">
            <img src={getFullUrl(invite.serverIcon) || ""} alt={invite.serverName} className="h-full w-full object-cover" />
          </div>
        ) : (
          <div className="mx-auto mb-4 grid h-20 w-20 place-items-center rounded-2xl border border-cyan-300/30 bg-cyan-400/15 text-xl font-bold text-cyan-100">
            {invite?.serverName.slice(0, 2).toUpperCase()}
          </div>
        )}

        <h1 className="text-3xl font-extrabold text-slate-100">{invite?.serverName}</h1>
        <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200/90">
          <Users className="h-3.5 w-3.5" />
          You were invited
        </div>

        <p className="mt-4 text-slate-300/75">
          Join this server to start chatting, browsing channels and collaborating in realtime.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button variant="outline" onClick={() => navigate("/")}>No thanks</Button>
          <Button onClick={handleJoin}>
            Join Server
            <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
