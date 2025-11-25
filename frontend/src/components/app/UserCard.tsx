import { Button } from "@/components/ui/button"
import { Headphones, Mic, Cog } from "lucide-react"

export default function UserCard() {
  return (
    <div className="border-t border-white/10 bg-[#0b1220]/80 p-2 backdrop-blur supports-[backdrop-filter]:bg-[#0b1220]/60">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-blue-600" />
          <div>
            <div className="text-sm font-medium">You</div>
            <div className="text-xs text-muted-foreground">Do Not Disturb</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
            <Mic className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
            <Headphones className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
            <Cog className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

