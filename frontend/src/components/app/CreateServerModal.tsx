import { createPortal } from "react-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useState, useRef } from "react"
import { api, getFullUrl } from "@/lib/api"
import type { Server } from "@/types"

export default function CreateServerModal({
  open,
  onClose,
  onCreated
}: {
  open: boolean
  onClose: () => void
  onCreated: (server: Server) => void
}) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [iconUrl, setIconUrl] = useState("")
  const [bannerUrl, setBannerUrl] = useState("")
  const [loading, setLoading] = useState(false)
  
  const iconInputRef = useRef<HTMLInputElement>(null)
  const bannerInputRef = useRef<HTMLInputElement>(null)

  if (!open) return null

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

  const handleSubmit = async () => {
    const token = localStorage.getItem("token")
    if (!token || !name) return
    try {
      setLoading(true)
      const res = await api.createServer(token, name, description, iconUrl, bannerUrl)
      if (res.server) {
        onCreated(res.server)
        onClose()
        // Reset form
        setName("")
        setDescription("")
        setIconUrl("")
        setBannerUrl("")
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm supports-[backdrop-filter]:bg-black/50 p-4" onClick={onClose}>
      <div className="w-[480px] rounded-lg border border-border bg-card p-6 shadow-xl text-card-foreground max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="text-xl font-semibold text-center mb-2">Customize your server</div>
        <div className="text-center text-muted-foreground text-sm mb-6">Give your new server a personality with a name and an icon. You can always change it later.</div>
        
        <div className="flex flex-col gap-4">
          {/* Icon Upload */}
          <div className="flex justify-center">
             <div 
               className="relative w-24 h-24 rounded-full bg-muted flex items-center justify-center cursor-pointer overflow-hidden hover:opacity-80 transition-opacity border-2 border-dashed border-muted-foreground/50"
               onClick={() => iconInputRef.current?.click()}
             >
               {iconUrl ? (
                 <img src={getFullUrl(iconUrl) || iconUrl} alt="Server Icon" className="w-full h-full object-cover" />
               ) : (
                 <div className="text-xs text-center text-muted-foreground">Upload<br/>Icon</div>
               )}
               <input 
                 type="file" 
                 ref={iconInputRef} 
                 className="hidden" 
                 accept="image/*"
                 onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0], 'icon')}
               />
             </div>
          </div>

          <div>
            <label className="text-xs font-bold text-muted-foreground uppercase mb-1.5 block">Server Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My cool server" />
          </div>

          <div>
            <label className="text-xs font-bold text-muted-foreground uppercase mb-1.5 block">Description</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="This server is about..." />
          </div>

          <div>
            <label className="text-xs font-bold text-muted-foreground uppercase mb-1.5 block">Banner</label>
             <div 
               className="w-full h-32 rounded-md bg-muted flex items-center justify-center cursor-pointer overflow-hidden hover:opacity-80 transition-opacity border-2 border-dashed border-muted-foreground/50 relative"
               onClick={() => bannerInputRef.current?.click()}
             >
               {bannerUrl ? (
                 <img src={getFullUrl(bannerUrl) || bannerUrl} alt="Server Banner" className="w-full h-full object-cover" />
               ) : (
                 <div className="text-sm text-muted-foreground">Upload Banner</div>
               )}
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

        <div className="mt-8 flex items-center justify-between">
          <Button variant="ghost" onClick={onClose}>Back</Button>
          <Button variant="brand" onClick={handleSubmit} disabled={!name || loading}>Create</Button>
        </div>
      </div>
    </div>,
    document.body
  )
}
