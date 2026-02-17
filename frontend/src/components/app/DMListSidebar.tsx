import { useEffect } from "react"
import UserCard from "./UserCard"
import { useNavigate } from "react-router-dom"
import { api } from "../../lib/api"
import { useAuth } from "../../hooks/useAuth"
import { useAppCacheStore } from "@/stores/cacheStore"

export default function DMListSidebar() {
  const navigate = useNavigate()
  const { token } = useAuth()
  const dms = useAppCacheStore((state) => state.dms) || []
  const setCachedDms = useAppCacheStore((state) => state.setDms)

  useEffect(() => {
    if (!token || dms.length > 0) return
    let cancelled = false
    api.getDMs(token).then(res => {
      if (cancelled) return
      if (res.dms) {
        setCachedDms(res.dms)
      }
    }).catch(console.error)
    return () => {
      cancelled = true
    }
  }, [token, dms.length, setCachedDms])

  return (
    <aside className="flex h-dvh w-full flex-col bg-slate-950/86 text-slate-100 backdrop-blur-xl">
      <div className="px-3 py-3">
        <div className="mb-3 rounded-xl border border-cyan-300/20 bg-slate-900/70 px-3 py-2 text-sm font-semibold">Direct Messages</div>
        <ul className="max-h-full space-y-1">
          {dms.map((dm) => (
            <li
              key={dm.id}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-slate-200/85 hover:border-cyan-300/30 hover:bg-cyan-400/10 hover:text-cyan-50"
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
                 <span className={`absolute bottom-0 right-0 h-2 w-2 rounded-full border border-slate-900 ${dm.user.status === 'online' ? 'bg-green-500' : 'bg-gray-500'}`} />
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
