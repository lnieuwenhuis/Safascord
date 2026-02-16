import { Button } from "@/components/ui/button"
import { useNavigate } from "react-router-dom"
import { getSelection, setSelection } from "@/hooks/useSelection"
import { useEffect, useState } from "react"
import { api, getFullUrl } from "@/lib/api"
import ConfirmDialog from "./ConfirmDialog"
import CreateServerModal from "./CreateServerModal"
import EditServerModal from "./EditServerModal"
import type { Server } from "@/types"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/useAuth"

import Inbox from "./Inbox"

export default function ServerSidebar() {
  const navigate = useNavigate()
  const [servers, setServers] = useState<Server[]>([])
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const { token } = useAuth()
  const authToken = token || (typeof window !== "undefined" ? localStorage.getItem("token") || "" : "")
  const activeServerId = getSelection().serverId

  useEffect(() => {
    if (authToken) {
      api.me(authToken).then(r => setUserId(r.user?.id || null)).catch(() => {})
      api.servers(authToken).then((r) => setServers(r.servers)).catch(() => setServers([]))
    }
  }, [authToken])

  const activeServer = editId ? servers.find(s => s.id === editId) || null : null
  return (
    <aside className="flex h-dvh w-16 flex-col items-center gap-2 overflow-y-auto overflow-x-visible border-r border-base-300/70 bg-base-100/70 px-2 py-3 backdrop-blur-sm">
      <Button
        variant="default"
        size="icon"
        className="rounded-2xl shadow-md"
        onClick={() => navigate('/channels/@me')}
      >
        C
      </Button>
      <div className="h-px w-8 bg-base-300" />
      {servers.map(s => (
        <button
          key={s.id}
          className={cn(
            "group relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl border text-xs font-semibold transition-all",
            activeServerId === s.id
              ? "border-primary bg-primary/10 text-primary shadow-md"
              : "border-base-300/70 bg-base-100 text-base-content/85 hover:border-primary/40 hover:bg-primary/5"
          )}
          onClick={() => {
            setSelection({ serverId: String(s.id), channelId: undefined })
            navigate('/server')
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            setMenu({ id: s.id, x: e.clientX, y: e.clientY })
            setEditId(s.id)
          }}
        >
          {s.iconUrl ? (
            <img src={getFullUrl(s.iconUrl) || s.iconUrl} alt={s.name} className="h-full w-full object-cover" />
          ) : (
            s.name.substring(0, 2)
          )}
        </button>
      ))}
      {menu && (
        <div className="menu fixed z-[120] w-44 rounded-box border border-base-300 bg-base-100 p-1 shadow-xl" style={{ left: menu.x, top: menu.y }} onMouseLeave={() => setMenu(null)}>
          {menu.id === "__home__" ? (
             <button className="btn btn-ghost btn-sm justify-start" onClick={() => { setCreateOpen(true); setMenu(null) }}>Create Server</button>
          ) : (
            <>
              {servers.find(s => s.id === menu.id)?.ownerId === userId ? (
                <>
                  <button className="btn btn-ghost btn-sm justify-start" onClick={() => { setEditOpen(true); setEditId(menu.id) }}>Edit Server</button>
                  <button className="btn btn-ghost btn-sm justify-start text-error" onClick={() => { setConfirmOpen(true); setEditId(menu.id) }}>Delete Server</button>
                </>
              ) : (
                <button className="btn btn-ghost btn-sm justify-start text-error" onClick={() => { setLeaveOpen(true); setEditId(menu.id) }}>Leave Server</button>
              )}
            </>
          )}
        </div>
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
            setServers((prev) => prev.filter((x) => x.id !== editId))
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
            setServers((prev) => prev.filter((x) => x.id !== editId))
            navigate('/channels/@me')
          }
        }}
      />
      <div className="mt-2">
        <button className="btn btn-circle btn-outline h-12 min-h-12 w-12 border-base-300 text-xl" onClick={() => setCreateOpen(true)}>+</button>
      </div>
      <CreateServerModal 
        open={createOpen} 
        onClose={() => setCreateOpen(false)} 
        onCreated={(s) => setServers((prev) => [...prev, s])} 
      />
      <EditServerModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onUpdated={(s) => setServers((prev) => prev.map((x) => x.id === s.id ? s : x))}
        initialData={activeServer}
      />
      <div className="mt-auto pb-2 relative z-50">
        <Inbox />
      </div>
    </aside>
  )
}
