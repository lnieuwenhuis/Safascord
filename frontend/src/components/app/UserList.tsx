import { useEffect, useState } from "react"
import { api, getFullUrl } from "@/lib/api"
import { useAuth } from "@/hooks/useAuth"
import { cn } from "@/lib/utils"
import UserProfilePopover from "./UserProfilePopover"
import type { User, UserGroup } from "@/types"

export default function UserList({ serverId, channelId, className }: { serverId?: string, channelId?: string, className?: string }) {
  const [groups, setGroups] = useState<UserGroup[]>([])
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [selectedUserRect, setSelectedUserRect] = useState<DOMRect | null>(null)
  const { user: currentUser } = useAuth()

  useEffect(() => {
    api.users(serverId, channelId).then((r) => {
      setGroups(r.groups)
    }).catch(() => setGroups([]))
  }, [serverId, channelId])

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
    <>
      <aside className={cn("flex h-full flex-col border-l border-cyan-300/15 bg-slate-950/86 p-3 text-slate-100 backdrop-blur-xl", className)}>
        <div className="flex-1 space-y-6 overflow-y-auto min-h-0">
          {groups.map((g, idx) => (
            <div key={idx}>
              <div className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-cyan-200/72">{g.name} — {g.users.length}</div>
              <ul className="space-y-0.5">
                {g.users.map((u) => {
                  // Check if this is the current user to show live updates
                  const isMe = currentUser && (u.username === currentUser.username)
                  const displayUser = isMe ? currentUser : u
                  
                  const avatarUrl = getFullUrl(displayUser.avatarUrl)
                  
                  const displayName = displayUser.displayName || displayUser.username
                  const status = (displayUser as User).status || "online"
                  // Ensure we have an ID to click on. If it's me, use my ID. If it's from list, it should have ID.
                  const userId = isMe ? currentUser.id : u.id

                  return (
                    <li 
                      key={u.username} 
                      className="group flex cursor-pointer items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 opacity-90 hover:border-cyan-300/25 hover:bg-cyan-400/10 hover:text-cyan-50 hover:opacity-100"
                      onClick={(e) => {
                        setSelectedUserId(userId)
                        setSelectedUserRect(e.currentTarget.getBoundingClientRect())
                      }}
                    >
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
                          "absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-[3px] border-slate-900 flex items-center justify-center",
                          statusColor(status)
                        )}>
                          {status === 'dnd' && <div className="h-0.5 w-1.5 bg-white" />}
                          {status === 'idle' && <div className="h-1.5 w-1.5 bg-sidebar rounded-full absolute top-0 left-0" />} 
                        </div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium leading-none truncate opacity-90 group-hover:opacity-100" title={displayName} style={{ color: u.roleColor || undefined }}>{displayName}</div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      </aside>

      <UserProfilePopover 
        userId={selectedUserId} 
        serverId={serverId}
        isOpen={!!selectedUserId} 
        onClose={() => setSelectedUserId(null)} 
        position={selectedUserRect}
      />
    </>
  )
}
