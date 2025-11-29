import { createPortal } from "react-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useState } from "react"
import { api } from "@/lib/api"

export default function AddFriendModal({
  open,
  onClose,
  onSent
}: {
  open: boolean
  onClose: () => void
  onSent?: () => void
}) {
  const [username, setUsername] = useState("")
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  if (!open) return null

  const handleSubmit = async () => {
    const token = localStorage.getItem("token")
    if (!token || !username) return
    setStatus(null)
    try {
      setLoading(true)
      const res = await api.sendFriendRequest(token, { username })
      if (res.error) {
        setStatus(`Error: ${res.error}`)
      } else {
        setStatus("Friend request sent!")
        setUsername("")
        if (onSent) onSent()
        setTimeout(() => {
            onClose()
            setStatus(null)
        }, 1500)
      }
    } catch (e) {
      console.error(e)
      setStatus("Failed to send request")
    } finally {
      setLoading(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm supports-[backdrop-filter]:bg-black/50 p-4" onClick={onClose}>
      <div className="w-[440px] rounded-lg border border-border bg-card p-6 shadow-xl text-card-foreground" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold mb-2 uppercase text-sm text-foreground">Add Friend</h2>
        <p className="text-sm text-muted-foreground mb-6">You can add friends with their username#0000.</p>
        
        <div className="mb-4">
             <label className="text-xs font-bold text-muted-foreground uppercase mb-1.5 block">Username</label>
             <div className="flex gap-2">
                <div className="relative flex-1">
                    <Input 
                        placeholder="Username#0000" 
                        value={username} 
                        onChange={(e) => setUsername(e.target.value)} 
                        className="bg-muted/50 border-0"
                        autoFocus
                        onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                    />
                </div>
             </div>
        </div>

        {status && (
            <p className={`mb-4 text-sm ${status.startsWith("Error") || status.startsWith("Failed") ? "text-red-500" : "text-green-500"}`}>
                {status}
            </p>
        )}

        <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={!username || loading} variant="brand">Send Friend Request</Button>
        </div>
      </div>
    </div>,
    document.body
  )
}
