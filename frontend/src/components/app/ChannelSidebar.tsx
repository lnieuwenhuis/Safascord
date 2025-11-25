import UserCard from "./UserCard"
import { useNavigate } from "react-router-dom"
import { setSelection } from "@/hooks/useSelection"
import { Hash, Plus } from "lucide-react"
import { useEffect, useState } from "react"
import { api } from "@/lib/api"
import ConfirmDialog from "./ConfirmDialog"
import { Input } from "@/components/ui/input"

export default function ChannelSidebar({ guildId }: { guildId?: string }) {
  const navigate = useNavigate()
  const [sections, setSections] = useState<{ title: string; channels: string[] }[]>([])
  const [serverName, setServerName] = useState<string>("")
  const [menu, setMenu] = useState<{ channel: string; x: number; y: number } | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [editName, setEditName] = useState("")
  const [editChannel, setEditChannel] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmAction, setConfirmAction] = useState<"rename" | "delete" | "create" | null>(null)
  const [newChannelName, setNewChannelName] = useState("")
  const [newChannelCategory, setNewChannelCategory] = useState("FST")
  const token = typeof window !== "undefined" ? localStorage.getItem("token") || "" : ""
  useEffect(() => {
    api.channels(guildId).then((r) => setSections(r.sections)).catch(() => setSections([
      { title: "Admin", channels: ["announcements", "rulebook"] },
      { title: "Staff", channels: ["roles", "moderation"] },
      { title: "FST", channels: ["chat-room", "memes", "media", "real-f1", "pets"] },
    ]))
  }, [guildId])
  useEffect(() => {
    if (!guildId) return
    api.servers(token).then((r) => {
      const s = r.servers.find((x) => String(x.id) === String(guildId))
      setServerName(s?.name || "")
    }).catch(() => setServerName(""))
  }, [guildId, token])
  return (
    <aside className="flex h-dvh w-full flex-col border-r border-white/10 bg-[#0b1220]">
      <div className="px-3 py-3">
        <div className="mb-3 flex items-center justify-between px-2">
          <div className="text-sm font-semibold">{serverName}</div>
          <div className="relative">
            <button className="flex h-6 w-6 items-center justify-center rounded bg-white/10" onClick={(e) => {
              e.preventDefault();
              setMenu({ channel: "__header__", x: e.clientX, y: e.clientY })
            }}>
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="space-y-4">
          {sections.map((s, i) => (
            <div key={i}>
              <div className="px-2 text-xs uppercase text-muted-foreground">{s.title}</div>
              <ul className="mt-1 space-y-1">
                {s.channels.map((c) => (
                  <li
                    key={c}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-white/5"
                    onClick={() => {
                      if (guildId) setSelection({ channelId: c })
                      navigate('/server')
                    }}
                    onContextMenu={(e) => { e.preventDefault(); setMenu({ channel: c, x: e.clientX, y: e.clientY }); setEditName(c); setEditChannel(c) }}
                  >
                    <Hash className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-auto">
        <UserCard />
      </div>
      {menu && (
        <div className="fixed z-[120] rounded border border-white/10 bg-[#0b1220] shadow" style={{ left: menu.x, top: menu.y }} onMouseLeave={() => setMenu(null)}>
          {menu.channel === "__header__" ? (
            <>
              <button className="block w-40 px-3 py-2 text-left hover:bg-white/5" onClick={() => { setNewChannelName(""); setNewChannelCategory("FST"); setEditOpen(true); setConfirmAction("create") }}>Create Channel</button>
              <button className="block w-40 px-3 py-2 text-left hover:bg-white/5" onClick={async () => {
                setMenu(null)
                setEditOpen(true)
                setConfirmAction("create")
                setNewChannelName("")
                setNewChannelCategory("FST")
              }}>Create Category</button>
              <button className="block w-40 px-3 py-2 text-left hover:bg-white/5" onClick={async () => {
                setMenu(null)
                if (!guildId || !token) return
                const r = await api.createInvite(token, guildId)
                const link = `${window.location.origin}/invite/${r.code}`
                alert(`Invite link: ${link}`)
              }}>Invite People</button>
            </>
          ) : (
            <>
              <button className="block w-40 px-3 py-2 text-left hover:bg-white/5" onClick={() => { setEditOpen(true); setConfirmOpen(false); setConfirmAction("rename") }}>Edit name</button>
              <button className="block w-40 px-3 py-2 text-left hover:bg-white/5" onClick={() => { setConfirmOpen(true); setConfirmAction("delete") }}>Delete channel</button>
            </>
          )}
        </div>
      )}
      {editOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm supports-[backdrop-filter]:bg-black/50 p-4" onClick={() => setEditOpen(false)}>
          <div className="w-[420px] rounded-lg border border-white/10 bg-[#0b1220] p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-lg font-semibold">{confirmAction === "create" ? "Create channel" : "Edit channel name"}</div>
            {confirmAction === "create" ? (
              <>
                <div className="mt-2"><Input placeholder="Channel name" value={newChannelName} onChange={(e) => setNewChannelName(e.target.value)} /></div>
                <div className="mt-2"><Input placeholder="Category" value={newChannelCategory} onChange={(e) => setNewChannelCategory(e.target.value)} /></div>
              </>
            ) : (
              <div className="mt-2"><Input value={editName} onChange={(e) => setEditName(e.target.value)} /></div>
            )}
            <div className="mt-6 flex items-center justify-end gap-2">
              <button className="rounded border border-white/10 bg-transparent px-3 py-2" onClick={() => setEditOpen(false)}>Cancel</button>
              <button className="rounded bg-brand px-3 py-2" onClick={() => { setEditOpen(false); setConfirmOpen(true); if (confirmAction !== "create") setConfirmAction("rename") }}>Save</button>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirmOpen}
        title={confirmAction === "delete" ? "Delete channel" : confirmAction === "create" ? "Create channel" : "Confirm edit"}
        description={confirmAction === "delete" ? "This will remove the channel." : confirmAction === "create" ? "Create a new channel?" : `Rename channel to "${editName}"?`}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={async () => {
          setConfirmOpen(false)
          if (!token || !guildId) return
          if (confirmAction === "delete" && editChannel) {
            const idRes = await api.channelIdByName(guildId, editChannel)
            if (idRes.id) await api.deleteChannel(token, idRes.id)
            const res = await api.channels(guildId)
            setSections(res.sections)
          } else if (confirmAction === "rename" && editChannel) {
            const idRes = await api.channelIdByName(guildId, editChannel)
            if (idRes.id) await api.renameChannel(token, idRes.id, editName)
            const res = await api.channels(guildId)
            setSections(res.sections)
          } else if (confirmAction === "create") {
            if (editOpen) {
              // fallback no-op
            }
            if (newChannelName && guildId) {
              await api.createChannel(token, guildId, newChannelName, newChannelCategory || "FST")
            } else if (guildId && newChannelCategory) {
              await api.createCategory(token, guildId, newChannelCategory)
            }
            const res = await api.channels(guildId)
            setSections(res.sections)
          }
        }}
      />
    </aside>
  )
}
