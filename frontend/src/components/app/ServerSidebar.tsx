import { Button } from "@/components/ui/button"
import { useNavigate } from "react-router-dom"
import { setSelection } from "@/hooks/useSelection"
import { useEffect, useState } from "react"
import { api } from "@/lib/api"
import ConfirmDialog from "./ConfirmDialog"
import { Input } from "@/components/ui/input"

export default function ServerSidebar() {
  const navigate = useNavigate()
  const [servers, setServers] = useState<{ id: string; name: string }[]>([])
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [editName, setEditName] = useState("")
  const [editId, setEditId] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmAction, setConfirmAction] = useState<"rename" | "delete" | null>(null)
  const token = typeof window !== "undefined" ? localStorage.getItem("token") || "" : ""
  useEffect(() => {
    api.servers(token).then((r) => setServers(r.servers)).catch(() => setServers([]))
  }, [token])
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
          className="flex h-12 w-12 items-center justify-center rounded-2xl bg-card text-xs hover:bg-card/80"
          onClick={() => {
            setSelection({ serverId: String(s.id), channelId: undefined })
            navigate('/server')
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            setMenu({ id: s.id, x: e.clientX, y: e.clientY })
            setEditName(s.name)
            setEditId(s.id)
          }}
        >
          {s.name}
        </button>
      ))}
      {menu && (
        <div className="fixed z-[120] rounded border border-border bg-popover shadow-md text-popover-foreground" style={{ left: menu.x, top: menu.y }} onMouseLeave={() => setMenu(null)}>
          <button className="block w-40 px-3 py-2 text-left hover:bg-accent hover:text-accent-foreground text-sm" onClick={() => { setEditOpen(true); setMenu(null); setConfirmAction("rename") }}>Edit name</button>
          <button className="block w-40 px-3 py-2 text-left hover:bg-accent hover:text-accent-foreground text-sm text-destructive" onClick={() => { setConfirmOpen(true); setMenu(null); setConfirmAction("delete") }}>Delete server</button>
        </div>
      )}
      {editOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm supports-[backdrop-filter]:bg-black/50 p-4" onClick={() => setEditOpen(false)}>
          <div className="w-[420px] rounded-lg border border-border bg-card p-4 shadow-xl text-card-foreground" onClick={(e) => e.stopPropagation()}>
            <div className="text-lg font-semibold">Edit server name</div>
            <div className="mt-2"><Input value={editName} onChange={(e) => setEditName(e.target.value)} /></div>
            <div className="mt-6 flex items-center justify-end gap-2">
              <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button variant="brand" onClick={() => { setEditOpen(false); setConfirmOpen(true); setConfirmAction("rename") }}>Save</Button>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirmOpen}
        title={confirmAction === "delete" ? "Delete server" : "Confirm edit"}
        description={confirmAction === "delete" ? "This will remove the server and all its channels." : (editId ? `Rename server to "${editName}"?` : `Create server named "${editName || 'new-server'}"?`)}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={async () => {
          setConfirmOpen(false)
          if (!token) return
          if (confirmAction === "delete" && editId) {
            await api.deleteServer(token, editId)
            setServers((prev) => prev.filter((x) => x.id !== editId))
          } else if (confirmAction === "rename" && editId) {
            const r = await api.renameServer(token, editId, editName)
            if (r.server) setServers((prev) => prev.map((x) => x.id === editId ? { ...x, name: r.server!.name } : x))
          } else if (confirmAction === "rename" && !editId) {
            const r = await api.createServer(token, editName || "new-server")
            if (r.server) setServers((prev) => [...prev, r.server!])
          }
        }}
      />
      <div className="mt-2">
        <button className="flex h-12 w-12 items-center justify-center rounded-2xl bg-card text-xl hover:bg-card/80" onClick={() => { setEditId(null); setEditName(""); setConfirmAction("rename"); setEditOpen(true) }}>+</button>
      </div>
    </aside>
  )
}
