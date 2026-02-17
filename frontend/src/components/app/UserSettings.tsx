import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { X, LogOut } from "lucide-react"
import { createPortal } from "react-dom"
import ConfirmDialog from "./ConfirmDialog"
import { useNavigate } from "react-router-dom"
import { useState, useEffect } from "react"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"

export default function UserSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const [section, setSection] = useState<string>("account")
  const [confirmOpen, setConfirmOpen] = useState(false)
  const { user, logout } = useAuth()
  const [name, setName] = useState("")
  const [quietMode, setQuietMode] = useState(false)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    setName(user?.displayName || user?.username || "")
    setQuietMode(user?.notificationsQuietMode || false)
  }, [user])
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm supports-[backdrop-filter]:bg-black/50 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="relative grid w-[980px] max-h-[92dvh] grid-cols-[260px_1fr] overflow-hidden rounded-2xl border border-cyan-300/20 bg-slate-950 shadow-xl text-slate-100" onClick={(e) => e.stopPropagation()}>
        <aside className="flex h-full flex-col border-r border-cyan-300/15 bg-slate-900/65 p-3">
          <div className="mb-2 text-xs uppercase text-muted-foreground">User Settings</div>
          <nav className="space-y-1">
            <button className={`w-full rounded px-2 py-1 text-left text-sm hover:bg-accent hover:text-accent-foreground ${section === 'account' ? 'bg-accent text-accent-foreground' : ''}`} onClick={() => setSection('account')}>My Account</button>
            <button className={`w-full rounded px-2 py-1 text-left text-sm hover:bg-accent hover:text-accent-foreground ${section === 'appearance' ? 'bg-accent text-accent-foreground' : ''}`} onClick={() => setSection('appearance')}>Appearance</button>
            <button className={`w-full rounded px-2 py-1 text-left text-sm hover:bg-accent hover:text-accent-foreground ${section === 'chat' ? 'bg-accent text-accent-foreground' : ''}`} onClick={() => setSection('chat')}>Chat</button>
            <button className={`w-full rounded px-2 py-1 text-left text-sm hover:bg-accent hover:text-accent-foreground ${section === 'notifications' ? 'bg-accent text-accent-foreground' : ''}`} onClick={() => setSection('notifications')}>Notifications</button>
            <button className={`w-full rounded px-2 py-1 text-left text-sm hover:bg-accent hover:text-accent-foreground ${section === 'voice' ? 'bg-accent text-accent-foreground' : ''}`} onClick={() => setSection('voice')}>Voice & Video</button>
            <button className={`w-full rounded px-2 py-1 text-left text-sm hover:bg-accent hover:text-accent-foreground ${section === 'keybinds' ? 'bg-accent text-accent-foreground' : ''}`} onClick={() => setSection('keybinds')}>Keybinds</button>
            <button className={`w-full rounded px-2 py-1 text-left text-sm hover:bg-accent hover:text-accent-foreground ${section === 'language' ? 'bg-accent text-accent-foreground' : ''}`} onClick={() => setSection('language')}>Language</button>
          </nav>
          <div className="mt-auto">
            <button className="flex w-full items-center justify-between rounded px-2 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground text-destructive" onClick={() => setConfirmOpen(true)}>
              <span>Log Out</span>
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </aside>
        <main className="flex h-full flex-col">
          <header className="flex items-center justify-between border-b border-cyan-300/15 p-3">
            <div className="text-lg font-semibold">{sectionLabel(section)}</div>
            <button className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground" aria-label="Close" onClick={onClose}>
              <X className="h-4 w-4" />
            </button>
          </header>
          <div className="flex-1 overflow-auto p-4">
            {section === 'account' && (
              <div className="space-y-4">
                <div className="rounded-lg border border-border bg-card p-4 text-card-foreground">
                  <div className="text-sm">Unique Identifier</div>
                  <Input value={user ? `${user.username}${user.discriminator ? `#${user.discriminator}` : ""}` : ""} readOnly className="mt-2" />
                </div>
                <div className="rounded-lg border border-border bg-card p-4 text-card-foreground">
                  <div className="text-sm">Display name</div>
                  <Input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} className="mt-2" />
                </div>
                <div className="rounded-lg border border-border bg-card p-4 text-card-foreground">
                  <div className="text-sm">Email</div>
                  <Input type="email" placeholder="name@example.com" className="mt-2" />
                </div>
              </div>
            )}
            {section === 'appearance' && (
              <div className="space-y-4">
                <div className="rounded-lg border border-border bg-card p-4 text-card-foreground">
                  <div className="text-sm">Theme</div>
                  <div className="mt-2 text-xs text-muted-foreground">Dark theme is enforced</div>
                </div>
                <div className="rounded-lg border border-border bg-card p-4 text-card-foreground">
                  <div className="text-sm">Accent Color</div>
                  <Input placeholder="#1e3a8a" className="mt-2" />
                </div>
              </div>
            )}
            {section === 'chat' && (
              <div className="space-y-4">
                <div className="rounded-lg border border-border bg-card p-4 text-card-foreground">
                  <div className="text-sm">Compact mode</div>
                  <div className="mt-2 h-8 w-12 rounded bg-muted" />
                </div>
                <div className="rounded-lg border border-border bg-card p-4 text-card-foreground">
                  <div className="text-sm">Show timestamps</div>
                  <div className="mt-2 h-8 w-12 rounded bg-muted" />
                </div>
              </div>
            )}
            {section === 'notifications' && (
              <div className="space-y-4">
                <div className="rounded-lg border border-border bg-card p-4 text-card-foreground flex items-center justify-between">
                  <div>
                     <div className="text-sm font-medium">Quiet Mode</div>
                     <div className="text-xs text-muted-foreground mt-1">Disable animations and sounds for notifications.</div>
                  </div>
                  <Switch checked={quietMode} onCheckedChange={setQuietMode} />
                </div>
              </div>
            )}
            {section === 'voice' && (
              <div className="space-y-4">
                <div className="rounded-lg border border-border bg-card p-4 text-card-foreground">
                  <div className="text-sm">Input device</div>
                  <Input placeholder="Default microphone" className="mt-2" />
                </div>
                <div className="rounded-lg border border-border bg-card p-4 text-card-foreground">
                  <div className="text-sm">Output device</div>
                  <Input placeholder="Default speakers" className="mt-2" />
                </div>
              </div>
            )}
            {section === 'keybinds' && (
              <div className="space-y-4">
                <div className="rounded-lg border border-border bg-card p-4 text-card-foreground">
                  <div className="text-sm">Push-to-talk</div>
                  <Input placeholder="Press a key" className="mt-2" />
                </div>
                <div className="rounded-lg border border-border bg-card p-4 text-card-foreground">
                  <div className="text-sm">Toggle mute</div>
                  <Input placeholder="Press a key" className="mt-2" />
                </div>
              </div>
            )}
            {section === 'language' && (
              <div className="space-y-4">
                <div className="rounded-lg border border-border bg-card p-4 text-card-foreground">
                  <div className="text-sm">Language</div>
                  <select className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                    <option>English</option>
                    <option>Deutsch</option>
                    <option>Nederlands</option>
                  </select>
                </div>
              </div>
            )}
          </div>
          <footer className="border-t border-cyan-300/15 p-3">
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={onClose}>Close</Button>
              <Button variant="brand" disabled={saving} onClick={async () => {
                const token = localStorage.getItem("token") || ""
                if (!token) { onClose(); return }
                setSaving(true)
                try {
                  const r = await api.updateProfile(token, { displayName: name, notificationsQuietMode: quietMode })
                  if (r.user) localStorage.setItem("user", JSON.stringify(r.user))
                } finally {
                  setSaving(false)
                  onClose()
                }
              }}>Save</Button>
            </div>
          </footer>
        </main>
        <ConfirmDialog
          open={confirmOpen}
          title="Log out?"
          description="You will be signed out of the application."
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => {
            setConfirmOpen(false)
            logout()
            onClose()
            navigate('/auth')
          }}
          confirmText="Log Out"
        />
      </div>
    </div>,
    document.body
  )
}

function sectionLabel(key: string) {
  switch (key) {
    case 'account': return 'My Account'
    case 'appearance': return 'Appearance'
    case 'chat': return 'Chat'
    case 'voice': return 'Voice & Video'
    case 'keybinds': return 'Keybinds'
    case 'language': return 'Language'
    default: return 'Settings'
  }
}
