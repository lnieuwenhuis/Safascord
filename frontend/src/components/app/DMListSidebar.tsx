import { useEffect, useState } from "react"
import UserCard from "./UserCard"
import { useNavigate } from "react-router-dom"
import { api } from "../../lib/api"
import { useAuth } from "../../hooks/useAuth"

export default function DMListSidebar() {
  const navigate = useNavigate()
  const { token } = useAuth()
  const [dms, setDms] = useState<{ id: string; user: { username: string; displayName: string; avatarUrl?: string; status: string } }[]>([])

  useEffect(() => {
    if (!token) return
    api.getDMs(token).then(res => {
      if (res.dms) {
        setDms(res.dms)
      }
    }).catch(console.error)
  }, [token])

  return (
    <aside className="flex h-dvh w-full flex-col border-r border-sidebar-border bg-sidebar/95 text-sidebar-foreground backdrop-blur-sm">
      <div className="px-3 py-3">
        <div className="mb-3 rounded-xl border border-base-300/70 bg-base-100/60 px-3 py-2 text-sm font-semibold">Direct Messages</div>
        <ul className="max-h-full space-y-1">
          {dms.map((dm) => (
            <li
              key={dm.id}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 hover:border-base-300 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              onClick={() => navigate(`/channels/@me/${dm.id}`)}
            >
              <div className="relative h-6 w-6">
                 {dm.user.avatarUrl ? (
                    <img src={dm.user.avatarUrl} className="h-6 w-6 rounded-full object-cover" alt={dm.user.username} />
                 ) : (
                    <span className="flex h-full w-full items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
                        {dm.user.displayName?.[0] || dm.user.username[0]}
                    </span>
                 )}
                 <span className={`absolute bottom-0 right-0 h-2 w-2 rounded-full border border-sidebar-background ${dm.user.status === 'online' ? 'bg-green-500' : 'bg-gray-500'}`} />
              </div>
              <span className="text-sm truncate">{dm.user.displayName || dm.user.username}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-auto">
        <UserCard />
      </div>
    </aside>
  )
}
