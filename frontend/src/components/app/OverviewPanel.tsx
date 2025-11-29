import { useState, useEffect } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { UserPlus, MessageSquare, Check, X, Search } from "lucide-react"
import { api } from "@/lib/api"
import { useAuth } from "@/hooks/useAuth"
import type { UserSummary, FriendRequest } from "@/types"
import { useNavigate } from "react-router-dom"
import AddFriendModal from "./AddFriendModal"

type Tab = 'online' | 'all' | 'pending' | 'dms'

export default function OverviewPanel() {
  const { token } = useAuth()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<Tab>('online')
  const [friends, setFriends] = useState<UserSummary[]>([])
  const [requests, setRequests] = useState<FriendRequest[]>([])
  const [dms, setDms] = useState<{ id: string, user: UserSummary }[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [addFriendOpen, setAddFriendOpen] = useState(false)

  const fetchData = async () => {
    if (!token) return
    setIsLoading(true)
    try {
      const [fRes, rRes, dRes] = await Promise.all([
        api.getFriends(token),
        api.getFriendRequests(token),
        api.getDMs(token)
      ])
      if (fRes.friends) setFriends(fRes.friends)
      if (rRes.requests) setRequests(rRes.requests)
      if (dRes.dms) setDms(dRes.dms)
    } catch (e) {
      console.error(e)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const handleRespond = async (requestId: string, action: 'accept' | 'decline') => {
    if (!token) return
    try {
      await api.respondFriendRequest(token, requestId, action)
      fetchData()
    } catch (e) {
      console.error(e)
    }
  }

  const startDM = async (userId: string) => {
     if (!token) return
     console.log("Starting DM with:", userId)
     try {
        const res = await api.createDM(token, userId)
        console.log("DM Result:", res)
        if (res.id) {
           console.log("Navigating to:", `/channels/@me/${res.id}`)
           navigate(`/channels/@me/${res.id}`)
        } else if (res.error) {
           console.error("Failed to create DM:", res.error)
           alert(`Failed to start DM: ${res.error}`)
        }
     } catch (e) {
        console.error("Exception creating DM:", e)
        alert("An error occurred while starting DM.")
     }
  }

  const filteredFriends = friends.filter(f => {
    if (activeTab === 'online') return f.status !== 'offline' 
    return true
  })

  const filteredDMs = dms

  if (isLoading) return null

  return (
    <div className="flex flex-1 flex-col bg-background text-foreground h-full">
      {/* Header */}
      <div className="flex h-12 items-center justify-between border-b border-border px-4 shadow-sm shrink-0">
        <div className="flex items-center gap-2 text-sm font-semibold">
            <span className="mr-2 flex items-center gap-2">
                <UserPlus className="h-5 w-5 text-muted-foreground" />
                Friends
            </span>
            <div className="h-6 w-[1px] bg-border mx-2"></div>
            <Button variant={activeTab === 'online' ? "secondary" : "ghost"} size="sm" onClick={() => setActiveTab('online')}>Online</Button>
            <Button variant={activeTab === 'all' ? "secondary" : "ghost"} size="sm" onClick={() => setActiveTab('all')}>All</Button>
            <Button variant={activeTab === 'dms' ? "secondary" : "ghost"} size="sm" onClick={() => setActiveTab('dms')}>DMs</Button>
            <Button variant={activeTab === 'pending' ? "secondary" : "ghost"} size="sm" onClick={() => setActiveTab('pending')}>
                Pending {requests.length > 0 && <span className="ml-2 rounded-full bg-red-500 px-1 text-[10px] text-white">{requests.length}</span>}
            </Button>
            <Button variant="default" size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => setAddFriendOpen(true)}>
                Add Friend
            </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {activeTab === 'pending' ? (
            <div className="flex-1 overflow-y-auto p-4">
                <h2 className="text-xs font-bold text-muted-foreground uppercase mb-4">Pending - {requests.length}</h2>
                <ul className="space-y-2">
                    {requests.length === 0 && <div className="text-center text-muted-foreground mt-10">There are no pending friend requests.</div>}
                    {requests.map((req) => (
                        <li key={req.id} className="flex items-center justify-between rounded p-2 hover:bg-muted/50 border border-transparent hover:border-border">
                            <div className="flex items-center gap-3">
                                <div className="relative">
                                    <img src={req.user.avatarUrl || "/placeholder-user.jpg"} alt="" className="h-8 w-8 rounded-full bg-secondary object-cover" />
                                </div>
                                <div>
                                    <div className="text-sm font-medium">
                                        {req.user.username}
                                        <span className="text-muted-foreground text-xs opacity-70">#{req.user.discriminator}</span>
                                    </div>
                                    <div className="text-xs text-muted-foreground">{req.type === 'incoming' ? "Incoming Friend Request" : "Outgoing Friend Request"}</div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                {req.type === 'incoming' && (
                                    <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full bg-muted hover:bg-green-500 hover:text-white transition-colors" onClick={() => handleRespond(req.id, 'accept')}>
                                        <Check className="h-4 w-4" />
                                    </Button>
                                )}
                                <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full bg-muted hover:bg-red-500 hover:text-white transition-colors" onClick={() => handleRespond(req.id, 'decline')}>
                                    <X className="h-4 w-4" />
                                </Button>
                            </div>
                        </li>
                    ))}
                </ul>
            </div>
        ) : activeTab === 'dms' ? (
             <div className="flex-1 overflow-y-auto p-4">
                <h2 className="text-xs font-bold text-muted-foreground uppercase mb-4">Direct Messages - {filteredDMs.length}</h2>
                <ul className="space-y-2">
                    {filteredDMs.length === 0 && <div className="text-center text-muted-foreground mt-10">No active conversations.</div>}
                    {filteredDMs.map((dm) => (
                        <li key={dm.id} className="flex items-center justify-between rounded p-2 hover:bg-muted/50 border border-transparent hover:border-border cursor-pointer group" onClick={() => navigate(`/channels/@me/${dm.id}`)}>
                            <div className="flex items-center gap-3">
                                <div className="relative">
                                    <img src={dm.user.avatarUrl || "/placeholder-user.jpg"} alt="" className="h-8 w-8 rounded-full bg-secondary object-cover" />
                                    <span className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-background ${dm.user.status === 'online' ? 'bg-green-500' : dm.user.status === 'idle' ? 'bg-yellow-500' : dm.user.status === 'dnd' ? 'bg-red-500' : 'bg-gray-500'}`} />
                                </div>
                                <div>
                                    <div className="text-sm font-medium">
                                        {dm.user.username}
                                        <span className="text-muted-foreground text-xs opacity-70">#{dm.user.discriminator}</span>
                                    </div>
                                    <div className="text-xs text-muted-foreground capitalize">{dm.user.status}</div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button size="icon" variant="secondary" className="h-8 w-8 rounded-full" onClick={(e) => { e.stopPropagation(); navigate(`/channels/@me/${dm.id}`); }}>
                                    <MessageSquare className="h-4 w-4" />
                                </Button>
                            </div>
                        </li>
                    ))}
                </ul>
            </div>
        ) : (
            <div className="flex-1 flex flex-col">
                <div className="p-4 border-b border-border">
                    <div className="relative">
                        <Input placeholder="Search" className="bg-muted/50 border-0 pl-9" />
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                    <h2 className="text-xs font-bold text-muted-foreground uppercase mb-4">{activeTab === 'online' ? "Online" : "All Friends"} - {filteredFriends.length}</h2>
                    <ul className="space-y-2">
                        {filteredFriends.length === 0 && <div className="text-center text-muted-foreground mt-10">No friends found.</div>}
                        {filteredFriends.map((f) => (
                            <li key={f.id} className="flex items-center justify-between rounded p-2 hover:bg-muted/50 border border-transparent hover:border-border cursor-pointer group" onClick={() => startDM(f.id)}>
                                <div className="flex items-center gap-3">
                                    <div className="relative">
                                        <img src={f.avatarUrl || "/placeholder-user.jpg"} alt="" className="h-8 w-8 rounded-full bg-secondary object-cover" />
                                        <span className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-background ${f.status === 'online' ? 'bg-green-500' : f.status === 'idle' ? 'bg-yellow-500' : f.status === 'dnd' ? 'bg-red-500' : 'bg-gray-500'}`} />
                                    </div>
                                    <div>
                                        <div className="text-sm font-medium">
                                            {f.username}
                                            <span className="text-muted-foreground text-xs opacity-70">#{f.discriminator}</span>
                                        </div>
                                        <div className="text-xs text-muted-foreground capitalize">{f.status}</div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Button size="icon" variant="secondary" className="h-8 w-8 rounded-full" onClick={(e) => { e.stopPropagation(); startDM(f.id); }}>
                                        <MessageSquare className="h-4 w-4" />
                                    </Button>
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        )}
      </div>
      <AddFriendModal open={addFriendOpen} onClose={() => setAddFriendOpen(false)} onSent={fetchData} />
    </div>
  )
}
