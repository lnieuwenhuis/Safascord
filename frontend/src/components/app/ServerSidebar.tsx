import { Button } from "@/components/ui/button"
import { useNavigate } from "react-router-dom"
import { setSelection } from "@/hooks/useSelection"
import { useEffect, useState } from "react"
import { api, getFullUrl } from "@/lib/api"
import ConfirmDialog from "./ConfirmDialog"
import CreateServerModal from "./CreateServerModal"
import EditServerModal from "./EditServerModal"
import type { Server } from "@/types"
import { Activity } from "lucide-react"

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
  const token = typeof window !== "undefined" ? localStorage.getItem("token") || "" : ""

  useEffect(() => {
    if (token) {
      api.me(token).then(r => setUserId(r.user?.id || null)).catch(() => {})
      api.servers(token).then((r) => setServers(r.servers)).catch(() => setServers([]))
    }
  }, [token])

  const activeServer = editId ? servers.find(s => s.id === editId) || null : null
  return (
    <aside className="flex h-dvh w-16 flex-col items-center gap-3 overflow-y-auto overflow-x-hidden border-r border-border bg-background px-2 py-3">
      <Button
        variant="brand"
        size="icon"
        className="rounded-2xl"
        onClick={() => navigate('/channels/@me')}
      >
        D
      </Button>
      <div className="h-px w-8 bg-white/10" />
      {servers.map(s => (
        <button
          key={s.id}
          className="flex h-12 w-12 items-center justify-center rounded-2xl bg-card text-xs hover:bg-card/80 overflow-hidden"
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
      <div className="h-px w-8 bg-white/10" />
      <button 
        className="flex h-12 w-12 items-center justify-center rounded-2xl bg-card text-xl hover:bg-card/80 text-green-400"
        onClick={() => navigate('/stats')}
        title="System Stats"
      >
        <Activity className="w-6 h-6" />
      </button>
      {menu && (
        <div className="fixed z-[120] rounded border border-border bg-popover shadow-md text-popover-foreground" style={{ left: menu.x, top: menu.y }} onMouseLeave={() => setMenu(null)}>
          {menu.id === "__home__" ? (
             <button className="block w-40 px-3 py-2 text-left hover:bg-accent hover:text-accent-foreground text-sm" onClick={() => { setCreateOpen(true); setMenu(null) }}>Create Server</button>
          ) : (
            <>
              {servers.find(s => s.id === menu.id)?.ownerId === userId ? (
                <>
                  <button className="block w-40 px-3 py-2 text-left hover:bg-accent hover:text-accent-foreground text-sm" onClick={() => { setEditOpen(true); setEditId(menu.id) }}>Edit Server</button>
                  <button className="block w-40 px-3 py-2 text-left hover:bg-accent hover:text-accent-foreground text-sm text-destructive" onClick={() => { setConfirmOpen(true); setEditId(menu.id) }}>Delete Server</button>
                </>
              ) : (
                <button className="block w-40 px-3 py-2 text-left hover:bg-accent hover:text-accent-foreground text-sm text-destructive" onClick={() => { setLeaveOpen(true); setEditId(menu.id) }}>Leave Server</button>
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
          if (!token) return
          if (editId) {
            await api.deleteServer(token, editId)
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
          if (!token || !editId) return
          const res = await api.leaveServer(token, editId)
          if (res.left) {
            setServers((prev) => prev.filter((x) => x.id !== editId))
            navigate('/channels/@me')
          }
        }}
      />
      <div className="mt-2">
        <button className="flex h-12 w-12 items-center justify-center rounded-2xl bg-card text-xl hover:bg-card/80" onClick={() => setCreateOpen(true)}>+</button>
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
    </aside>
  )
}
