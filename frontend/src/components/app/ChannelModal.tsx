
import { createPortal } from "react-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useState, useEffect } from "react"
import { api } from "@/lib/api"
import { X, Hash } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import type { Role } from "@/types"

interface ChannelPermission {
  roleId: string
  canView: boolean
  canSendMessages: boolean
}

export default function ChannelModal({
  open,
  onClose,
  serverId,
  initialData, // If provided, we are editing
  initialCategory, // For creating in a specific category
  onSuccess
}: {
  open: boolean
  onClose: () => void
  serverId: string
  initialData?: { id: string; name: string }
  initialCategory?: string
  onSuccess: () => void
}) {
  const [name, setName] = useState(initialData?.name || "")
  const [category, setCategory] = useState(initialCategory || "FST")
  const [activeTab, setActiveTab] = useState("general")
  const [roles, setRoles] = useState<Role[]>([])
  const [permissions, setPermissions] = useState<ChannelPermission[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    loadRoles()
    if (initialData) {
      setName(initialData.name)
      loadPermissions()
    } else {
      // Reset for create mode
      setName("")
      setCategory(initialCategory || "FST")
      setPermissions([])
      setActiveTab("general")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialData])

  const loadRoles = async () => {
    const token = localStorage.getItem("token")
    if (!token) return
    try {
      const res = await api.getRoles(token, serverId)
      if (res.roles) {
        setRoles(res.roles)
        // Initialize permissions if creating
        if (!initialData) {
           // By default, maybe we don't set any explicit permissions (public)
           // Or we can init with empty
        }
      }
    } catch (e) {
      console.error(e)
    }
  }

  const loadPermissions = async () => {
    if (!initialData) return
    const token = localStorage.getItem("token")
    if (!token) return
    try {
      const res = await api.getChannelPermissions(token, initialData.id)
      if (res.permissions) {
        setPermissions(res.permissions)
      }
    } catch (e) {
      console.error(e)
    }
  }

  const handleSave = async () => {
    const token = localStorage.getItem("token")
    if (!token || !name) return
    setLoading(true)
    try {
      if (initialData) {
        // Update
        await api.renameChannel(token, initialData.id, name, permissions)
      } else {
        // Create
        await api.createChannel(token, serverId, name, category, permissions)
      }
      onSuccess()
      onClose()
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const updatePermission = (roleId: string, type: 'view' | 'send', value: boolean) => {
      setPermissions(prev => {
          const existing = prev.find(p => p.roleId === roleId)
          if (existing) {
              return prev.map(p => p.roleId === roleId ? {
                  ...p,
                  canView: type === 'view' ? value : p.canView,
                  canSendMessages: type === 'send' ? value : p.canSendMessages
              } : p)
          } else {
              return [...prev, {
                  roleId,
                  canView: type === 'view' ? value : true,
                  canSendMessages: type === 'send' ? value : true
              }]
          }
      })
  }

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="flex h-[500px] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-slate-950 shadow-2xl border border-cyan-300/20" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-cyan-300/15 p-4">
           <h2 className="text-lg font-semibold">{initialData ? "Edit Channel" : "Create Channel"}</h2>
           <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <div className="flex border-b border-cyan-300/15 px-4">
           <button 
             onClick={() => setActiveTab("general")}
             className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${activeTab === "general" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
           >
             General
           </button>
           <button 
             onClick={() => setActiveTab("permissions")}
             className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${activeTab === "permissions" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
           >
             Permissions
           </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
           {activeTab === "general" && (
             <div className="space-y-4">
                <div className="space-y-2">
                   <Label>Channel Name</Label>
                   <div className="relative">
                      <Hash className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input className="pl-9" value={name} onChange={e => setName(e.target.value)} placeholder="new-channel" />
                   </div>
                </div>
                {!initialData && (
                  <div className="space-y-2">
                     <Label>Category</Label>
                     <Input value={category} onChange={e => setCategory(e.target.value)} />
                  </div>
                )}
             </div>
           )}

           {activeTab === "permissions" && (
             <div className="space-y-4">
                <p className="text-xs text-muted-foreground">
                   Define which roles can access this channel. If no overrides are set, the channel is public.
                </p>
                <div className="space-y-2">
                   {roles.filter(r => r.name !== 'Owner').map(role => {
                      const perm = permissions.find(p => p.roleId === role.id)
                      // If no perm exists, assume implied true (public). 
                      // But visually, we should show checks if they are "default". 
                      // Actually, better UI: Show "Default" vs "Allowed" vs "Denied".
                      // For simplicity, let's just use Switches. 
                      // If no perm row, we treat as "Inherit" (True).
                      const canView = perm ? perm.canView : true
                      const canSend = perm ? perm.canSendMessages : true
                      
                      return (
                         <div key={role.id} className="flex items-center justify-between rounded border border-cyan-300/20 p-3">
                            <div className="flex items-center gap-2">
                               <div className="h-3 w-3 rounded-full" style={{ backgroundColor: role.color }} />
                               <span className="text-sm font-medium">{role.name}</span>
                            </div>
                            <div className="flex items-center gap-4">
                               <div className="flex flex-col items-center gap-1">
                                  <span className="text-[10px] text-muted-foreground uppercase">View</span>
                                  <Switch checked={canView} onCheckedChange={(v) => updatePermission(role.id, 'view', v)} />
                               </div>
                               <div className="flex flex-col items-center gap-1">
                                  <span className="text-[10px] text-muted-foreground uppercase">Type</span>
                                  <Switch checked={canSend} onCheckedChange={(v) => updatePermission(role.id, 'send', v)} />
                               </div>
                            </div>
                         </div>
                      )
                   })}
                </div>
             </div>
           )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-cyan-300/15 bg-slate-900/50 p-4">
           <Button variant="ghost" onClick={onClose}>Cancel</Button>
           <Button onClick={handleSave} disabled={!name || loading}>
              {initialData ? "Save Changes" : "Create Channel"}
           </Button>
        </div>
      </div>
    </div>,
    document.body
  )
}
