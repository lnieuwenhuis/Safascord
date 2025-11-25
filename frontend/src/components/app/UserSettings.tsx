import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { X, LogOut } from "lucide-react"
import { createPortal } from "react-dom"
import ConfirmDialog from "./ConfirmDialog"
import { useNavigate } from "react-router-dom"
import { useState } from "react"

export default function UserSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const [section, setSection] = useState<string>("account")
  const [confirmOpen, setConfirmOpen] = useState(false)
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm supports-[backdrop-filter]:bg-black/50 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="relative grid w-[980px] max-h-[92dvh] grid-cols-[260px_1fr] overflow-hidden rounded-lg border border-white/10 bg-[#0b1220] shadow-xl" onClick={(e) => e.stopPropagation()}>
        <aside className="flex h-full flex-col border-r border-white/10 bg-[#0a1220] p-3">
          <div className="mb-2 text-xs uppercase text-muted-foreground">User Settings</div>
          <nav className="space-y-1">
            <button className={`w-full rounded px-2 py-1 text-left text-sm hover:bg-white/5 ${section === 'account' ? 'bg-white/10' : ''}`} onClick={() => setSection('account')}>My Account</button>
            <button className={`w-full rounded px-2 py-1 text-left text-sm hover:bg-white/5 ${section === 'appearance' ? 'bg-white/10' : ''}`} onClick={() => setSection('appearance')}>Appearance</button>
            <button className={`w-full rounded px-2 py-1 text-left text-sm hover:bg-white/5 ${section === 'chat' ? 'bg-white/10' : ''}`} onClick={() => setSection('chat')}>Chat</button>
            <button className={`w-full rounded px-2 py-1 text-left text-sm hover:bg-white/5 ${section === 'voice' ? 'bg-white/10' : ''}`} onClick={() => setSection('voice')}>Voice & Video</button>
            <button className={`w-full rounded px-2 py-1 text-left text-sm hover:bg-white/5 ${section === 'keybinds' ? 'bg-white/10' : ''}`} onClick={() => setSection('keybinds')}>Keybinds</button>
            <button className={`w-full rounded px-2 py-1 text-left text-sm hover:bg-white/5 ${section === 'language' ? 'bg-white/10' : ''}`} onClick={() => setSection('language')}>Language</button>
          </nav>
          <div className="mt-auto">
            <button className="flex w-full items-center justify-between rounded px-2 py-2 text-left text-sm hover:bg-white/5" onClick={() => setConfirmOpen(true)}>
              <span>Log Out</span>
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </aside>
        <main className="flex h-full flex-col">
          <header className="flex items-center justify-between border-b border-white/10 p-3">
            <div className="text-lg font-semibold">{sectionLabel(section)}</div>
            <button className="rounded p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground" aria-label="Close" onClick={onClose}>
              <X className="h-4 w-4" />
            </button>
          </header>
          <div className="flex-1 overflow-auto p-4">
            {section === 'account' && (
              <div className="space-y-4">
                <div className="rounded-lg border border-white/10 bg-[#0b1220] p-4">
                  <div className="text-sm">Display name</div>
                  <Input placeholder="Your name" />
                </div>
                <div className="rounded-lg border border-white/10 bg-[#0b1220] p-4">
                  <div className="text-sm">Email</div>
                  <Input type="email" placeholder="name@example.com" />
                </div>
              </div>
            )}
            {section === 'appearance' && (
              <div className="space-y-4">
                <div className="rounded-lg border border-white/10 bg-[#0b1220] p-4">
                  <div className="text-sm">Theme</div>
                  <div className="mt-2 text-xs text-muted-foreground">Dark theme is enforced</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-[#0b1220] p-4">
                  <div className="text-sm">Accent Color</div>
                  <Input placeholder="#1e3a8a" />
                </div>
              </div>
            )}
            {section === 'chat' && (
              <div className="space-y-4">
                <div className="rounded-lg border border-white/10 bg-[#0b1220] p-4">
                  <div className="text-sm">Compact mode</div>
                  <div className="mt-2 h-8 w-12 rounded bg-white/10" />
                </div>
                <div className="rounded-lg border border-white/10 bg-[#0b1220] p-4">
                  <div className="text-sm">Show timestamps</div>
                  <div className="mt-2 h-8 w-12 rounded bg-white/10" />
                </div>
              </div>
            )}
            {section === 'voice' && (
              <div className="space-y-4">
                <div className="rounded-lg border border-white/10 bg-[#0b1220] p-4">
                  <div className="text-sm">Input device</div>
                  <Input placeholder="Default microphone" />
                </div>
                <div className="rounded-lg border border-white/10 bg-[#0b1220] p-4">
                  <div className="text-sm">Output device</div>
                  <Input placeholder="Default speakers" />
                </div>
              </div>
            )}
            {section === 'keybinds' && (
              <div className="space-y-4">
                <div className="rounded-lg border border-white/10 bg-[#0b1220] p-4">
                  <div className="text-sm">Push-to-talk</div>
                  <Input placeholder="Press a key" />
                </div>
                <div className="rounded-lg border border-white/10 bg-[#0b1220] p-4">
                  <div className="text-sm">Toggle mute</div>
                  <Input placeholder="Press a key" />
                </div>
              </div>
            )}
            {section === 'language' && (
              <div className="space-y-4">
                <div className="rounded-lg border border-white/10 bg-[#0b1220] p-4">
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
          <footer className="border-t border-white/10 p-3">
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={onClose}>Close</Button>
              <Button variant="brand" onClick={onClose}>Save</Button>
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
            localStorage.removeItem('auth')
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
