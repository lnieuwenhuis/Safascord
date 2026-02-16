import { createPortal } from "react-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useState, useRef, useEffect } from "react"
import { api, getFullUrl } from "@/lib/api"
import { X, Plus, Trash2, GripVertical, Upload } from "lucide-react"
import type { Server, Role } from "@/types"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  DndContext, 
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export default function EditServerModal({
  open,
  onClose,
  onUpdated,
  initialData
}: {
  open: boolean
  onClose: () => void
  onUpdated: (server: Server) => void
  initialData: Server | null
}) {
  const [activeTab, setActiveTab] = useState("overview")
  
  // Lifted state from ServerOverview
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [iconUrl, setIconUrl] = useState("")
  const [bannerUrl, setBannerUrl] = useState("")
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (initialData) {
      setName(initialData.name)
      setDescription(initialData.description || "")
      setIconUrl(initialData.iconUrl || "")
      setBannerUrl(initialData.bannerUrl || "")
    }
  }, [initialData])

  if (!open || !initialData) return null

  const handleSave = async () => {
    const token = localStorage.getItem("token")
    if (!token || !name) return
    try {
      setLoading(true)
      const res = await api.renameServer(token, initialData.id, name, description, iconUrl, bannerUrl)
      if (res.server) {
        onUpdated(res.server)
        onClose() 
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-sm supports-[backdrop-filter]:bg-black/50 p-4" onClick={onClose}>
      <div className="flex h-[600px] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-slate-950 shadow-2xl border border-cyan-300/20" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-cyan-300/15 p-6">
          <div>
            <h2 className="text-lg font-semibold">{initialData.name} Settings</h2>
            <p className="text-sm text-slate-300/72">Manage your server settings and roles</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-cyan-300/15 px-6">
           <button 
             onClick={() => setActiveTab("overview")}
             className={`border-b-2 px-4 py-3 text-sm font-medium transition-colors ${activeTab === "overview" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
           >
             Overview
           </button>
           <button 
             onClick={() => setActiveTab("roles")}
             className={`border-b-2 px-4 py-3 text-sm font-medium transition-colors ${activeTab === "roles" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
           >
             Roles
           </button>
           <button 
             onClick={() => setActiveTab("members")}
             className={`border-b-2 px-4 py-3 text-sm font-medium transition-colors ${activeTab === "members" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
           >
             Members
           </button>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-hidden">
           {activeTab === "overview" && (
             <ServerOverview 
               name={name} setName={setName}
               description={description} setDescription={setDescription}
               iconUrl={iconUrl} setIconUrl={setIconUrl}
               bannerUrl={bannerUrl} setBannerUrl={setBannerUrl}
             />
           )}
           {activeTab === "roles" && <ServerRoles serverId={initialData.id} />}
           {activeTab === "members" && <ServerMembers serverId={initialData.id} />}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-4 border-t border-cyan-300/15 bg-slate-900/50 p-4">
           <Button variant="ghost" onClick={onClose}>Cancel</Button>
           <Button onClick={handleSave} disabled={!name || loading}>Save Changes</Button>
        </div>
      </div>
    </div>,
    document.body
  )
}

function ServerMembers({ serverId }: { serverId: string }) {
  const [members, setMembers] = useState<{ id: string; username: string; discriminator: string; displayName: string; avatarUrl: string; roles: string[]; muted: boolean }[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [search, setSearch] = useState("")
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null)

  useEffect(() => {
    loadMembers()
    loadRoles(serverId, setRoles)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId])

  const loadMembers = async () => {
    const token = localStorage.getItem("token")
    if (!token) return
    try {
      const res = await api.getServerMembers(token, serverId)
      if (res.members) setMembers(res.members)
    } catch (e) {
      console.error(e)
    }
  }

  const handleKick = async (userId: string) => {
    if (!confirm("Are you sure you want to kick this member?")) return
    const token = localStorage.getItem("token")
    if (!token) return
    try {
      const res = await api.kickMember(token, serverId, userId)
      if (res.ok) {
        setMembers(members.filter(m => m.id !== userId))
      } else {
        alert(res.error)
      }
    } catch (e) {
      console.error(e)
    }
  }

  const handleBan = async (userId: string) => {
    if (!confirm("Are you sure you want to ban this member?")) return
    const token = localStorage.getItem("token")
    if (!token) return
    try {
      const res = await api.banMember(token, serverId, userId)
      if (res.ok) {
        setMembers(members.filter(m => m.id !== userId))
      } else {
        alert(res.error)
      }
    } catch (e) {
      console.error(e)
    }
  }

  const handleMute = async (userId: string, currentMuted: boolean) => {
    const token = localStorage.getItem("token")
    if (!token) return
    try {
      const res = await api.muteMember(token, serverId, userId, !currentMuted)
      if (res.ok) {
        setMembers(members.map(m => m.id === userId ? { ...m, muted: !currentMuted } : m))
      } else {
        alert(res.error)
      }
    } catch (e) {
      console.error(e)
    }
  }

  const handleToggleRole = async (memberId: string, roleId: string, currentRoles: string[]) => {
    const token = localStorage.getItem("token")
    if (!token) return
    
    const hasRole = currentRoles.includes(roleId)
    const newRoles = hasRole 
      ? currentRoles.filter(r => r !== roleId)
      : [...currentRoles, roleId]
      
    try {
       await api.updateMemberRoles(token, serverId, memberId, newRoles)
       setMembers(members.map(m => m.id === memberId ? { ...m, roles: newRoles } : m))
    } catch (e) {
       console.error(e)
    }
  }

  const filteredMembers = members.filter(m => 
     m.username.toLowerCase().includes(search.toLowerCase()) || 
     m.displayName.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="flex h-full flex-col">
       <div className="p-4 border-b border-border">
          <Input 
            placeholder="Search members..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
       </div>
       <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {filteredMembers.map(m => (
            <div key={m.id} className="flex items-center justify-between p-3 rounded-md border border-border hover:bg-muted/50">
               <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-muted overflow-hidden">
                    {m.avatarUrl ? (
                      <img src={getFullUrl(m.avatarUrl) || m.avatarUrl} alt={m.username} className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center text-muted-foreground">?</div>
                    )}
                  </div>
                  <div>
                    <div className="font-medium flex items-center gap-1">
                       {m.displayName}
                       <span className="text-xs text-muted-foreground font-normal">{m.username}#{m.discriminator}</span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                       {m.roles.map(rid => {
                          const r = roles.find(role => role.id === rid)
                          if (!r) return null
                          return (
                             <div key={r.id} className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary flex items-center gap-1">
                                <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: r.color }} />
                                {r.name}
                             </div>
                          )
                       })}
                       {m.roles.length === 0 && <span className="text-xs text-muted-foreground">No roles</span>}
                    </div>
                  </div>
               </div>
               
               <div className="flex items-center gap-2">
                  <div className="relative">
                     <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => setOpenDropdownId(openDropdownId === m.id ? null : m.id)}
                     >
                        Roles
                     </Button>
                     {openDropdownId === m.id && (
                       <>
                         <div className="fixed inset-0 z-40" onClick={() => setOpenDropdownId(null)} />
                         <div className="absolute right-0 top-full mt-1 w-48 rounded-md border border-border bg-popover p-1 shadow-md z-50">
                            {roles.map(r => (
                               <div 
                                 key={r.id} 
                                 className="flex items-center gap-2 px-2 py-1.5 hover:bg-accent rounded cursor-pointer"
                                 onClick={() => handleToggleRole(m.id, r.id, m.roles)}
                               >
                                  <div className={`h-4 w-4 border rounded flex items-center justify-center ${m.roles.includes(r.id) ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground"}`}>
                                     {m.roles.includes(r.id) && <div className="h-2 w-2 bg-current rounded-full" />}
                                  </div>
                                  <div className="h-2 w-2 rounded-full" style={{ backgroundColor: r.color }} />
                                  <span className="text-sm">{r.name}</span>
                               </div>
                            ))}
                         </div>
                       </>
                     )}
                  </div>
                  <Button variant={m.muted ? "secondary" : "outline"} size="sm" onClick={() => handleMute(m.id, m.muted)}>
                             {m.muted ? "Unmute" : "Mute"}
                          </Button>
                          <Button variant="destructive" size="sm" onClick={() => handleKick(m.id)}>
                            Kick
                          </Button>
                          <Button variant="destructive" size="sm" onClick={() => handleBan(m.id)}>
                            Ban
                          </Button>
                       </div>
                    </div>
                  ))}
       </div>
    </div>
  )
}

function ServerOverview({ 
  name, setName, 
  description, setDescription, 
  iconUrl, setIconUrl, 
  bannerUrl, setBannerUrl 
}: { 
  name: string; setName: (v: string) => void;
  description: string; setDescription: (v: string) => void;
  iconUrl: string; setIconUrl: (v: string) => void;
  bannerUrl: string; setBannerUrl: (v: string) => void;
}) {
  const [loading, setLoading] = useState(false)
  
  const iconInputRef = useRef<HTMLInputElement>(null)
  const bannerInputRef = useRef<HTMLInputElement>(null)

  const handleUpload = async (file: File, type: 'icon' | 'banner') => {
    const token = localStorage.getItem("token")
    if (!token) return
    try {
      setLoading(true)
      const res = await api.uploadFile(token, file)
      if (res.url) {
        if (type === 'icon') setIconUrl(res.url)
        else setBannerUrl(res.url)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  if (loading) return null

  return (
    <div className="h-full overflow-y-auto p-6">
        <div className="grid gap-8 md:grid-cols-[200px_1fr]">
          {/* Visuals */}
          <div className="flex flex-col items-center gap-6">
             {/* Icon */}
             <div className="group relative">
                <div 
                  className="h-32 w-32 overflow-hidden rounded-full bg-muted border-2 border-dashed border-muted-foreground/25 flex items-center justify-center cursor-pointer hover:border-primary transition-colors"
                  onClick={() => iconInputRef.current?.click()}
                >
                  {iconUrl ? (
                    <img src={getFullUrl(iconUrl) || iconUrl} alt="Server Icon" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex flex-col items-center text-muted-foreground">
                      <Upload className="h-6 w-6 mb-1" />
                      <span className="text-xs">Icon</span>
                    </div>
                  )}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100 rounded-full">
                     <span className="text-xs font-medium text-white">Change</span>
                  </div>
                  <input 
                    type="file" 
                    ref={iconInputRef} 
                    className="hidden" 
                    accept="image/*"
                    onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0], 'icon')}
                  />
                </div>
             </div>

             {/* Banner */}
             <div className="group relative w-full">
                <div className="text-xs font-bold uppercase text-muted-foreground mb-2 text-center">Banner</div>
                <div 
                  className="h-24 w-full overflow-hidden rounded-md bg-muted border-2 border-dashed border-muted-foreground/25 flex items-center justify-center cursor-pointer hover:border-primary transition-colors"
                  onClick={() => bannerInputRef.current?.click()}
                >
                  {bannerUrl ? (
                    <img src={getFullUrl(bannerUrl) || bannerUrl} alt="Server Banner" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex flex-col items-center text-muted-foreground">
                      <Upload className="h-4 w-4 mb-1" />
                      <span className="text-[10px]">Upload</span>
                    </div>
                  )}
                   <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100 rounded-md mt-6">
                     <span className="text-xs font-medium text-white">Change</span>
                  </div>
                  <input 
                    type="file" 
                    ref={bannerInputRef} 
                    className="hidden" 
                    accept="image/*"
                    onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0], 'banner')}
                  />
                </div>
             </div>
          </div>

          {/* Form */}
          <div className="space-y-6">
             <div className="space-y-2">
               <Label htmlFor="serverName">Server Name</Label>
               <Input id="serverName" value={name} onChange={(e) => setName(e.target.value)} />
             </div>

             <div className="space-y-2">
               <Label htmlFor="description">Description</Label>
               <Input id="description" value={description} onChange={(e) => setDescription(e.target.value)} />
             </div>
          </div>
        </div>
    </div>
  )
}

  const loadRoles = async (serverId: string, setRoles: (roles: Role[]) => void) => {
    const token = localStorage.getItem("token")
    if (!token) return
    const res = await api.getRoles(token, serverId)
    if (res.roles) {
      setRoles(res.roles)
    }
  }

function ServerRoles({ serverId }: { serverId: string }) {
  const [roles, setRoles] = useState<Role[]>([])
  const [editingRole, setEditingRole] = useState<Role | null>(null)
  const [loading, setLoading] = useState(false)
  
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    loadRoles(serverId, setRoles)
  }, [serverId])
  
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (over && active.id !== over.id) {
      setRoles((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over.id);
        
        const newItems = arrayMove(items, oldIndex, newIndex);
        
        // Update positions in backend
        const token = localStorage.getItem("token");
        if (token) {
           newItems.forEach((role, index) => {
               if (role.position !== index) {
                   api.updateRole(token, serverId, role.id, { position: index });
               }
           });
        }
        
        return newItems.map((item, index) => ({ ...item, position: index }));
      });
    }
  }
  
  const handleCreate = async () => {
    const token = localStorage.getItem("token")
    if (!token) return
    setLoading(true)
    const res = await api.createRole(
      token, 
      serverId, 
      { name: "new role", color: "#99aab5", canManageChannels: false, canManageServer: false, canManageRoles: false, position: roles.length }
    )
    if (res.role) {
       setRoles([...roles, res.role])
       setEditingRole(res.role)
    }
    setLoading(false)
  }

  const handleSave = async () => {
     if (!editingRole) return
     const token = localStorage.getItem("token")
     if (!token) return
     setLoading(true)
     const res = await api.updateRole(token, serverId, editingRole.id, editingRole)
     const updatedRole = res.role
     if (updatedRole) {
        setRoles(roles.map(r => r.id === editingRole.id ? updatedRole : r))
     }
     setLoading(false)
  }
  
  const handleDelete = async (id: string) => {
     const token = localStorage.getItem("token")
     if (!token) return
     if (!confirm("Are you sure you want to delete this role?")) return
     setLoading(true)
     const res = await api.deleteRole(token, serverId, id)
     if (res.ok) {
        setRoles(roles.filter(r => r.id !== id))
        if (editingRole?.id === id) setEditingRole(null)
     } else if (res.error) {
        alert(res.error)
     }
     setLoading(false)
  }

  return (
    <div className="flex h-full">
       {/* Role List */}
       <div className="w-[240px] flex flex-col border-r border-border bg-muted/10">
          <div className="p-4 border-b border-border">
             <Button onClick={handleCreate} disabled={loading} variant="outline" size="sm" className="w-full gap-2">
                 <Plus className="h-3 w-3" /> Create Role
             </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
             <DndContext 
               sensors={sensors}
               collisionDetection={closestCenter}
               onDragEnd={handleDragEnd}
             >
               <SortableContext 
                 items={roles.map(r => r.id)}
                 strategy={verticalListSortingStrategy}
               >
                 {roles.map(r => (
                   <SortableRoleItem 
                     key={r.id} 
                     role={r} 
                     isActive={editingRole?.id === r.id}
                     onClick={() => setEditingRole(r)}
                   />
                 ))}
               </SortableContext>
             </DndContext>
          </div>
       </div>
       
       {/* Edit Panel */}
       <div className="flex-1 flex flex-col bg-background">
          {editingRole ? (
             <>
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    <div className="grid gap-6 md:grid-cols-2">
                       <div className="space-y-2">
                          <Label>Role Name</Label>
                          <Input 
                            value={editingRole.name}
                            onChange={e => setEditingRole({...editingRole, name: e.target.value})}
                          />
                       </div>
                       <div className="space-y-2">
                          <Label>Role Color</Label>
                          <div className="flex gap-2">
                             <input 
                               type="color" 
                               value={editingRole.color}
                               onChange={e => setEditingRole({...editingRole, color: e.target.value})}
                               className="h-10 w-14 rounded border border-border bg-background p-1 cursor-pointer"
                             />
                             <Input 
                               value={editingRole.color}
                               onChange={e => setEditingRole({...editingRole, color: e.target.value})}
                               className="font-mono"
                             />
                          </div>
                       </div>
                    </div>
                    
                    <div className="h-px bg-border" />
                    
                    <div className="space-y-4">
                       <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Permissions</h3>
                       
                       <PermissionToggle 
                           label="Manage Channels" 
                           desc="Allow members to create, edit, or delete channels."
                           checked={!!editingRole.canManageChannels}
                           onChange={v => setEditingRole({...editingRole, canManageChannels: v})}
                       />
                       <div className="h-px bg-border/50" />
                       <PermissionToggle 
                           label="Manage Server" 
                           desc="Allow members to edit this server's name, description, icon, and banner."
                           checked={!!editingRole.canManageServer}
                           onChange={v => setEditingRole({...editingRole, canManageServer: v})}
                       />
                       <div className="h-px bg-border/50" />
                       <PermissionToggle 
                           label="Manage Roles" 
                           desc="Allow members to create, edit, and delete roles (below their own)."
                           checked={!!editingRole.canManageRoles}
                           onChange={v => setEditingRole({...editingRole, canManageRoles: v})}
                       />
                    </div>
                </div>
                
                <div className="p-4 border-t border-border bg-muted/20 flex justify-between items-center">
                   {editingRole.name !== "Owner" && (
                     <Button variant="destructive" size="sm" onClick={() => handleDelete(editingRole.id)} className="gap-2">
                       <Trash2 className="h-4 w-4" /> Delete Role
                     </Button>
                   )}
                   <div className={editingRole.name === "Owner" ? "ml-auto" : ""}>
                     <Button onClick={handleSave} disabled={loading}>Save Changes</Button>
                   </div>
                </div>
             </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-muted-foreground gap-2">
               <div className="text-4xl">🛡️</div>
               <div>Select a role to edit permissions</div>
            </div>
          )}
       </div>
    </div>
  )
}

function SortableRoleItem({ role, isActive, onClick }: { role: Role; isActive: boolean; onClick: () => void }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: role.id });
  
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  
  return (
    <div 
      ref={setNodeRef} 
      style={style} 
      className={`flex cursor-pointer items-center justify-between rounded px-3 py-2 hover:bg-accent/50 group transition-colors ${isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground"}`}
      onClick={onClick}
    >
        <div className="flex items-center gap-3 overflow-hidden flex-1">
          <div className="cursor-grab text-muted-foreground/50 hover:text-muted-foreground" {...attributes} {...listeners} onClick={(e) => e.stopPropagation()}>
             <GripVertical className="h-4 w-4" />
          </div>
          <div className="h-3 w-3 rounded-full flex-shrink-0 border border-border/50" style={{ backgroundColor: role.color }} />
          <span className={`text-sm truncate font-medium`}>{role.name}</span>
        </div>
    </div>
  )
}

function PermissionToggle({ label, desc, checked, onChange }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
       <div className="space-y-0.5">
          <div className="font-medium">{label}</div>
          <div className="text-xs text-muted-foreground">{desc}</div>
       </div>
       <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  )
}
