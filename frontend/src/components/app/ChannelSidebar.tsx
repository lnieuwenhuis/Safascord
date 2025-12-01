import UserCard from "./UserCard"
import { useNavigate } from "react-router-dom"
import { setSelection } from "@/hooks/useSelection"
import { Hash, Plus } from "lucide-react"
import { useEffect, useState } from "react"
import { api, getFullUrl } from "@/lib/api"
import ConfirmDialog from "./ConfirmDialog"
import { Input } from "@/components/ui/input"
import type { Server, ChannelSection } from "@/types"
import ChannelModal from "./ChannelModal"

export default function ChannelSidebar({ guildId, activeChannelId }: { guildId?: string, activeChannelId?: string }) {
  const navigate = useNavigate()
  const [sections, setSections] = useState<ChannelSection[]>([])
  const [server, setServer] = useState<Server | null>(null)
  const [menu, setMenu] = useState<{ channel: string; x: number; y: number } | null>(null)
  
  // Modals
  const [createChannelOpen, setCreateChannelOpen] = useState(false)
  const [createCategoryOpen, setCreateCategoryOpen] = useState(false)
  const [editChannelId, setEditChannelId] = useState<string | null>(null)
  const [editChannelName, setEditChannelName] = useState("")
  
  const [editChannel, setEditChannel] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmAction, setConfirmAction] = useState<"delete" | null>(null)
  
  const [newCategoryName, setNewCategoryName] = useState("")
  
  const token = typeof window !== "undefined" ? localStorage.getItem("token") || "" : ""
  
  useEffect(() => {
    loadChannels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guildId])
  
  const loadChannels = () => {
    api.channels(guildId, token).then((r) => {
      setSections(r.sections)
    }).catch(() => setSections([
      { title: "Admin", channels: [{ id: "1", name: "announcements", type: "text" }, { id: "2", name: "rulebook", type: "text" }] },
      { title: "Staff", channels: [{ id: "3", name: "roles", type: "text" }, { id: "4", name: "moderation", type: "text" }] },
      { title: "FST", channels: [{ id: "5", name: "chat-room", type: "text" }, { id: "6", name: "memes", type: "text" }, { id: "7", name: "media", type: "text" }, { id: "8", name: "real-f1", type: "text" }, { id: "9", name: "pets", type: "text" }] },
    ]))
  }

  useEffect(() => {
    if (!guildId) return
    api.servers(token).then((r) => {
      const s = r.servers.find((x) => String(x.id) === String(guildId))
      setServer(s || null)
    }).catch(() => setServer(null))
  }, [guildId, token])

  const handleEditChannel = async (channelName: string) => {
     if (!guildId) return
     try {
       const idRes = await api.channelIdByName(guildId, channelName)
       if (idRes.id) {
          setEditChannelId(idRes.id)
          setEditChannelName(channelName)
       }
     } catch (e) {
        console.error(e)
     }
  }

  return (
    <aside className="flex h-dvh w-full flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      {server?.bannerUrl && (
        <div className="w-full h-32 relative">
           <img src={getFullUrl(server.bannerUrl) || server.bannerUrl} alt="Banner" className="w-full h-full object-cover" />
           <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        </div>
      )}
      <div className="px-3 py-3">
        <div className="mb-3 flex items-center justify-between px-2">
          <div className="text-sm font-semibold">{server?.name}</div>
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
                    key={c.id}
                    className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1 ${c.name === activeChannelId ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'}`}
                    onClick={() => {
                      if (guildId) {
                        setSelection({ channelId: c.name })
                        navigate(`/server/${guildId}/channel/${c.name}`)
                      }
                    }}
                    onContextMenu={(e) => { 
                      e.preventDefault(); 
                      setMenu({ channel: c.name, x: e.clientX, y: e.clientY }); 
                      setEditChannel(c.name) 
                    }}
                  >
                    <Hash className={`h-4 w-4 ${c.name === activeChannelId ? 'text-sidebar-accent-foreground' : 'text-muted-foreground'}`} />
                    <span className="text-sm">{c.name}</span>
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
        <div className="fixed z-[120] rounded border border-border bg-popover shadow-md text-popover-foreground" style={{ left: menu.x, top: menu.y }} onMouseLeave={() => setMenu(null)}>
          {menu.channel === "__header__" ? (
            <>
              <button className="block w-40 px-3 py-2 text-left hover:bg-accent hover:text-accent-foreground text-sm" onClick={() => { 
                 setCreateChannelOpen(true); 
                 setMenu(null)
              }}>Create Channel</button>
              <button className="block w-40 px-3 py-2 text-left hover:bg-accent hover:text-accent-foreground text-sm" onClick={() => {
                 setCreateCategoryOpen(true);
                 setNewCategoryName("");
                 setMenu(null)
              }}>Create Category</button>
              <button className="block w-40 px-3 py-2 text-left hover:bg-accent hover:text-accent-foreground text-sm" onClick={async () => {
                setMenu(null)
                if (!guildId || !token) return
                try {
                  const r = await api.createInvite(token, guildId)
                  if (r.code) {
                    const link = `${window.location.origin}/invite/${r.code}`
                    await navigator.clipboard.writeText(link)
                    alert(`Invite link copied to clipboard: ${link}`)
                  } else {
                    alert("Failed to create invite link")
                  }
                } catch (e) {
                  console.error("Invite creation error:", e)
                  alert("Failed to create invite link")
                }
              }}>Invite People</button>
            </>
          ) : (
            <>
              <button className="block w-40 px-3 py-2 text-left hover:bg-accent hover:text-accent-foreground text-sm" onClick={() => { 
                 setMenu(null)
                 handleEditChannel(menu.channel)
              }}>Edit Channel</button>
              <button className="block w-40 px-3 py-2 text-left hover:bg-accent hover:text-accent-foreground text-sm text-destructive" onClick={() => { 
                 setMenu(null)
                 setConfirmOpen(true); 
                 setConfirmAction("delete") 
              }}>Delete channel</button>
            </>
          )}
        </div>
      )}
      
      {/* Create/Edit Channel Modal */}
      <ChannelModal 
         open={createChannelOpen || !!editChannelId}
         onClose={() => { setCreateChannelOpen(false); setEditChannelId(null) }}
         serverId={guildId || ""}
         initialData={editChannelId ? { id: editChannelId, name: editChannelName } : undefined}
         onSuccess={() => loadChannels()}
      />

      {/* Create Category Modal */}
      {createCategoryOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm supports-[backdrop-filter]:bg-black/50 p-4" onClick={() => setCreateCategoryOpen(false)}>
          <div className="w-[420px] rounded-lg border border-border bg-card p-4 shadow-xl text-card-foreground" onClick={(e) => e.stopPropagation()}>
            <div className="text-lg font-semibold">Create Category</div>
            <div className="mt-2"><Input placeholder="Category Name" value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} /></div>
            <div className="mt-6 flex items-center justify-end gap-2">
              <button className="rounded border border-white/10 bg-transparent px-3 py-2" onClick={() => setCreateCategoryOpen(false)}>Cancel</button>
              <button className="rounded bg-brand px-3 py-2" onClick={async () => { 
                 if (!guildId || !newCategoryName) return
                 await api.createCategory(token, guildId, newCategoryName)
                 loadChannels()
                 setCreateCategoryOpen(false)
              }}>Create</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={"Delete channel"}
        description={"This will remove the channel."}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={async () => {
          setConfirmOpen(false)
          if (!token || !guildId) return
          if (confirmAction === "delete" && editChannel) {
            const idRes = await api.channelIdByName(guildId, editChannel)
            if (idRes.id) await api.deleteChannel(token, idRes.id)
            loadChannels()
          }
        }}
      />
    </aside>
  )
}
