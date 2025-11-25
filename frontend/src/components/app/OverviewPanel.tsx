import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { UserPlus } from "lucide-react"

const friends = Array.from({ length: 20 }).map((_, i) => ({ id: i, name: `Friend ${i + 1}`, status: i % 3 === 0 ? "Online" : i % 3 === 1 ? "Idle" : "Do Not Disturb" }))

export default function OverviewPanel() {
  return (
    <div className="flex flex-1 flex-col bg-background text-foreground">
      <div className="flex h-12 items-center justify-between border-b border-border px-4 shadow-sm">
        <div className="text-sm font-semibold">Friends</div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="h-8 px-2">Friends</Button>
          <Button variant="outline" className="h-8 px-2">Online</Button>
          <Button variant="outline" className="h-8 px-2">All</Button>
          <Button variant="outline" className="h-8 px-2">Pending</Button>
          <Button variant="brand" size="sm" className="h-8 px-3">
            <UserPlus className="mr-2 h-4 w-4" /> Add Friend
          </Button>
        </div>
      </div>
      <div className="border-b border-border p-3">
        <Input placeholder="Search" className="bg-muted/50 border-0" />
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        <ul className="space-y-1">
          {friends.map((f) => (
            <li key={f.id} className="flex items-center justify-between rounded px-3 py-2 hover:bg-muted/50 cursor-pointer">
              <div className="flex items-center gap-3">
                <span className="h-8 w-8 rounded-full bg-primary" />
                <div>
                  <div className="text-sm font-medium">{f.name}</div>
                  <div className="text-xs text-muted-foreground">{f.status}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded bg-muted" />
                <div className="h-8 w-8 rounded bg-muted" />
                <div className="h-8 w-8 rounded bg-muted" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

