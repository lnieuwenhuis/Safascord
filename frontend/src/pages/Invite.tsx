import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import type { InviteInfo } from "@/types"

export default function Invite() {
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const [invite, setInvite] = useState<InviteInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null

  useEffect(() => {
    if (!code) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setError("Invalid invite code")
        setLoading(false)
        return
    }
    api.inviteInfo(code)
      .then(r => {
        if (r.error) {
            setError(r.error)
        } else if (r.code) {
            // Map backend response to InviteInfo structure
            const s = (r as { server: { id: string; name: string } }).server
            setInvite({
                code: r.code,
                serverId: s?.id,
                serverName: s?.name,
                expired: false,
                full: false
            })
        } else if (r.invite) {
            setInvite(r.invite)
        } else {
            setError("Invite not found or expired")
        }
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
      const res = await api.acceptInvite(token, invite.code)
      if (res.ok) {
        navigate(`/server/${invite.serverId}`)
      } else {
        setError(res.error || "Failed to join")
      }
    } catch {
      setError("Failed to join")
    }
  }

  if (loading) {
    return (
        <div className="flex h-screen w-full items-center justify-center bg-[#313338] text-white">
            Loading...
        </div>
    )
  }

  if (error) {
    return (
        <div className="flex h-screen w-full items-center justify-center bg-[#313338] text-white flex-col gap-4">
            <div className="text-xl font-bold text-destructive">Error</div>
            <div>{error}</div>
            <Button onClick={() => navigate("/")} variant="secondary">Go Home</Button>
        </div>
    )
  }

  return (
    <div className="flex h-screen w-full items-center justify-center bg-[#313338] text-white">
      <div className="w-full max-w-md rounded-lg bg-[#2b2d31] p-8 shadow-xl text-center">
        <div className="mb-4 text-sm font-bold uppercase text-[#949ba4]">You've been invited to join</div>
        <div className="mb-6 text-2xl font-bold">{invite?.serverName}</div>
        <div className="flex justify-center gap-4">
            <Button onClick={() => navigate("/")} variant="secondary" className="bg-[#313338] hover:bg-[#3f4147] text-white">No, thanks</Button>
            <Button onClick={handleJoin} variant="brand" className="bg-[#5865f2] hover:bg-[#4752c4] text-white">Join Server</Button>
        </div>
      </div>
    </div>
  )
}
