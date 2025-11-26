import { useEffect, useState } from "react"
import { api, getFullUrl } from "@/lib/api"
import { useAuth } from "@/hooks/useAuth"
import { cn } from "@/lib/utils"

type UserItem = { username: string; displayName: string; avatarUrl?: string; status?: string }

export default function UserList({ serverId }: { serverId?: string }) {
  const [groups, setGroups] = useState<{ title: string; users: UserItem[] }[]>([])
  const { user: currentUser } = useAuth()

  useEffect(() => {
    api.users(serverId).then((r) => {
      setGroups(r.groups)
    }).catch(() => setGroups([]))
  }, [serverId])

  const statusColor = (status: string) => {
    switch (status) {
      case "online": return "bg-green-500"
      case "idle": return "bg-yellow-500"
      case "dnd": return "bg-red-500"
      case "invisible": return "bg-gray-500"
      default: return "bg-green-500"
    }
  }

  return (
    <aside className="hidden w-60 flex-col border-l border-sidebar-border bg-sidebar p-3 text-sidebar-foreground lg:flex">
      <div className="space-y-6 overflow-y-auto">
        {groups.map((g, idx) => (
          <div key={idx}>
            <div className="text-xs font-bold uppercase text-muted-foreground mb-2">{g.title} — {g.users.length}</div>
            <ul className="space-y-0.5">
              {g.users.map((u) => {
                // Check if this is the current user to show live updates
                const isMe = currentUser && (u.username === currentUser.username)
                const displayUser = isMe ? currentUser : u
                
                const avatarUrl = getFullUrl(displayUser.avatarUrl)
                
                const displayName = displayUser.displayName || displayUser.username
                const status = (displayUser as UserItem).status || "online"

                return (
                  <li key={u.username} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground cursor-pointer group opacity-90 hover:opacity-100">
                    <div className="relative">
                      <div className="h-8 w-8 overflow-hidden rounded-full bg-primary/20">
                         {avatarUrl ? (
                           <img src={avatarUrl} alt={displayName} className="h-full w-full object-cover block" />
                         ) : (
                           <div className="h-full w-full bg-primary flex items-center justify-center text-[10px] text-primary-foreground font-bold">
                             {displayName.substring(0, 2).toUpperCase()}
                           </div>
                         )}
                      </div>
                      <div className={cn(
                        "absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-[3px] border-sidebar flex items-center justify-center",
                        statusColor(status)
                      )}>
                        {status === 'dnd' && <div className="h-0.5 w-1.5 bg-white" />}
                        {status === 'idle' && <div className="h-1.5 w-1.5 bg-sidebar rounded-full absolute top-0 left-0" />} 
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium leading-none truncate opacity-90 group-hover:opacity-100">{displayName}</div>
                      {/* <div className="text-xs text-muted-foreground truncate">{status}</div> */}
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </aside>
  )
}
