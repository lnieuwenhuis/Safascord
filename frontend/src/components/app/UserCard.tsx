import { Button } from "@/components/ui/button"
import { Headphones, Mic, Cog } from "lucide-react"
import { useState } from "react"
import UserSettings from "./UserSettings"
import { useAuth } from "@/hooks/useAuth"

export default function UserCard() {
  const [muted, setMuted] = useState(false)
  const [deaf, setDeaf] = useState(false)
  const [open, setOpen] = useState(false)
  const { user } = useAuth()
  const name = (user && (user.displayName || user.username)) || "You"
  return (
    <div className="flex h-16 items-center justify-between border-t border-white/10 bg-[#0b1220]/80 px-2 backdrop-blur supports-[backdrop-filter]:bg-[#0b1220]/60">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-full bg-blue-600" />
        <div className="min-w-0">
          <div className="text-sm font-medium">{name}</div>
          <div className="text-xs text-muted-foreground whitespace-nowrap">
            <span className="hidden sm:inline">Do Not Disturb</span>
            <span className="sm:hidden">DND</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="relative text-muted-foreground hover:text-foreground"
          onClick={() => setMuted((v) => !v)}
        >
          <Mic className="h-4 w-4" />
          {muted && <span className="absolute left-1/2 top-1/2 h-[2px] w-5 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-current" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="relative text-muted-foreground hover:text-foreground"
          onClick={() => setDeaf((v) => !v)}
        >
          <Headphones className="h-4 w-4" />
          {deaf && <span className="absolute left-1/2 top-1/2 h-[2px] w-5 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-current" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => setOpen(true)}
        >
          <Cog className="h-4 w-4" />
        </Button>
      </div>
      <UserSettings open={open} onClose={() => setOpen(false)} />
    </div>
  )
}
