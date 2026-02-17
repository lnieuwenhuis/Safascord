import { Button } from "@/components/ui/button"
import { useNavigate } from "react-router-dom"
import { getSelection, setSelection } from "@/hooks/useSelection"
import { useEffect, useState } from "react"
import { api, getFullUrl } from "@/lib/api"
import ConfirmDialog from "./ConfirmDialog"
import CreateServerModal from "./CreateServerModal"
import EditServerModal from "./EditServerModal"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/useAuth"
import { createPortal } from "react-dom"
import { useAppCacheStore } from "@/stores/cacheStore"
import { useNotifications } from "../NotificationProvider"

import Inbox from "./Inbox"

export default function ServerSidebar() {
  const navigate = useNavigate()
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const servers = useAppCacheStore((state) => state.servers) || []
  const setCachedServers = useAppCacheStore((state) => state.setServers)
  const { notifications } = useNotifications()
  const { token, user } = useAuth()
  const authToken = token || (typeof window !== "undefined" ? localStorage.getItem("token") || "" : "")
  const userId = user?.id || null
  const activeServerId = getSelection().serverId

  const getUnreadCountForServer = (serverId: string) =>
    notifications.filter((n) => !n.read && n.serverId === serverId).length

  const dmUnreadCount = notifications.filter(
    (n) => !n.read && (n.sourceType === "dm" || n.channelType === "dm"),
  ).length

  useEffect(() => {
    let cancelled = false
    if (!authToken) return () => { cancelled = true }

    api.servers(authToken).then((r) => {
      if (cancelled) return
      setCachedServers(r.servers)
    }).catch(() => {})

    return () => {
      cancelled = true
    }
  }, [authToken, setCachedServers])

  const openMenu = (id: string, x: number, y: number) => {
    const menuWidth = 176
    const menuHeight = 120
    const maxX = Math.max(8, window.innerWidth - menuWidth - 8)
    const maxY = Math.max(8, window.innerHeight - menuHeight - 8)
    setMenu({
      id,
      x: Math.min(Math.max(8, x), maxX),
      y: Math.min(Math.max(8, y), maxY),
    })
  }

  const activeServer = editId ? servers.find(s => s.id === editId) || null : null
  return (
    <aside className="flex h-dvh w-16 flex-col items-center gap-2 overflow-y-auto overflow-x-visible bg-slate-950/88 px-2 py-3 text-slate-100">
      <div className="relative">
        <Button
          variant="default"
          size="icon"
          className="rounded-2xl border border-cyan-300/30 shadow-md"
          onClick={() => navigate('/channels/@me')}
        >
          C
        </Button>
        {dmUnreadCount > 0 && (
          <div className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white ring-2 ring-slate-950">
            {dmUnreadCount > 99 ? "99+" : dmUnreadCount}
          </div>
        )}
      </div>
      <div className="h-px w-8 bg-cyan-300/25" />
      {servers.map(s => {
        const unreadServer = getUnreadCountForServer(s.id)
        return (
        <div key={s.id} className="relative">
          <button
            className={cn(
              "group relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl border text-xs font-semibold transition-all",
              activeServerId === s.id
                ? "border-cyan-300/60 bg-cyan-400/18 text-cyan-100 shadow-md"
                : "border-cyan-300/25 bg-slate-900/80 text-slate-100/90 hover:border-cyan-300/45 hover:bg-cyan-400/10"
            )}
            onClick={() => {
              setSelection({ serverId: String(s.id), channelId: undefined })
              navigate('/server')
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              openMenu(s.id, e.clientX, e.clientY)
              setEditId(s.id)
            }}
          >
            {s.iconUrl ? (
              <img src={getFullUrl(s.iconUrl) || s.iconUrl} alt={s.name} className="h-full w-full object-cover" />
            ) : (
              s.name.substring(0, 2)
            )}
          </button>
          {unreadServer > 0 && (
            <div className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white ring-2 ring-slate-950">
              {unreadServer > 99 ? "99+" : unreadServer}
            </div>
          )}
        </div>
      )})}
      {menu && createPortal(
        <>
          <div className="fixed inset-0 z-[320]" onClick={() => setMenu(null)} />
          <div
            className="menu fixed z-[330] w-44 rounded-box border border-cyan-300/20 bg-slate-950 p-1 text-slate-100 shadow-xl"
            style={{ left: menu.x, top: menu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            {menu.id === "__home__" ? (
               <button className="btn btn-ghost btn-sm justify-start" onClick={() => { setCreateOpen(true); setMenu(null) }}>Create Server</button>
            ) : (
              <>
                {servers.find(s => s.id === menu.id)?.ownerId === userId ? (
                  <>
                    <button className="btn btn-ghost btn-sm justify-start" onClick={() => { setMenu(null); setEditOpen(true); setEditId(menu.id) }}>Edit Server</button>
                    <button className="btn btn-ghost btn-sm justify-start text-error" onClick={() => { setMenu(null); setConfirmOpen(true); setEditId(menu.id) }}>Delete Server</button>
                  </>
                ) : (
                  <button className="btn btn-ghost btn-sm justify-start text-error" onClick={() => { setMenu(null); setLeaveOpen(true); setEditId(menu.id) }}>Leave Server</button>
                )}
              </>
            )}
          </div>
        </>,
        document.body
      )}
      <ConfirmDialog
        open={confirmOpen}
        title="Delete server"
        description="This will remove the server and all its channels."
        onCancel={() => setConfirmOpen(false)}
        onConfirm={async () => {
          setConfirmOpen(false)
          if (!authToken) return
          if (editId) {
            await api.deleteServer(authToken, editId)
            setCachedServers(servers.filter((x) => x.id !== editId))
          }
        }}
      />
      <ConfirmDialog
        open={leaveOpen}
        title="Leave Server"
        description="Are you sure you want to leave this server?"
        onCancel={() => setLeaveOpen(false)}
        onConfirm={async () => {
          setLeaveOpen(false)
          if (!authToken || !editId) return
          const res = await api.leaveServer(authToken, editId)
          if (res.left) {
            setCachedServers(servers.filter((x) => x.id !== editId))
            navigate('/channels/@me')
          }
        }}
      />
      <div className="mt-2">
        <button className="btn btn-circle h-12 min-h-12 w-12 border border-cyan-300/35 bg-slate-900 text-xl text-cyan-100 hover:bg-cyan-400/20" onClick={() => setCreateOpen(true)}>+</button>
      </div>
      <CreateServerModal 
        open={createOpen} 
        onClose={() => setCreateOpen(false)} 
        onCreated={(s) => setCachedServers([...servers, s])} 
      />
      <EditServerModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onUpdated={(s) => setCachedServers(servers.map((x) => x.id === s.id ? s : x))}
        initialData={activeServer}
      />
      <div className="mt-auto pb-2 relative z-50">
        <Inbox />
      </div>
    </aside>
  )
}
