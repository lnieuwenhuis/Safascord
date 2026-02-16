import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Check, MessageSquare, Search, UserPlus, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { useAuth } from "@/hooks/useAuth"
import type { FriendRequest, UserSummary } from "@/types"
import AddFriendModal from "./AddFriendModal"

type Tab = "online" | "all" | "pending" | "dms"

function statusDot(status?: string) {
  if (status === "online") return "bg-green-500"
  if (status === "idle") return "bg-yellow-500"
  if (status === "dnd") return "bg-red-500"
  return "bg-gray-500"
}

export default function OverviewPanel() {
  const { token } = useAuth()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<Tab>("online")
  const [friends, setFriends] = useState<UserSummary[]>([])
  const [requests, setRequests] = useState<FriendRequest[]>([])
  const [dms, setDms] = useState<{ id: string; user: UserSummary }[]>([])
  const [search, setSearch] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [addFriendOpen, setAddFriendOpen] = useState(false)

  const fetchData = async () => {
    if (!token) return
    setIsLoading(true)
    try {
      const [friendsRes, requestsRes, dmsRes] = await Promise.all([
        api.getFriends(token),
        api.getFriendRequests(token),
        api.getDMs(token),
      ])
      setFriends(friendsRes.friends || [])
      setRequests(requestsRes.requests || [])
      setDms(dmsRes.dms || [])
    } catch (error) {
      console.error(error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const normalizedQuery = search.trim().toLowerCase()

  const filteredFriends = useMemo(() => {
    return friends.filter((friend) => {
      if (activeTab === "online" && friend.status === "offline") return false
      if (!normalizedQuery) return true
      return (
        friend.username.toLowerCase().includes(normalizedQuery) ||
        (friend.displayName || "").toLowerCase().includes(normalizedQuery) ||
        (friend.discriminator || "").toLowerCase().includes(normalizedQuery)
      )
    })
  }, [activeTab, friends, normalizedQuery])

  const filteredRequests = useMemo(() => {
    return requests.filter((request) => {
      if (!normalizedQuery) return true
      return (
        request.user.username.toLowerCase().includes(normalizedQuery) ||
        (request.user.displayName || "").toLowerCase().includes(normalizedQuery) ||
        (request.user.discriminator || "").toLowerCase().includes(normalizedQuery)
      )
    })
  }, [requests, normalizedQuery])

  const filteredDMs = useMemo(() => {
    return dms.filter((dm) => {
      if (!normalizedQuery) return true
      return (
        dm.user.username.toLowerCase().includes(normalizedQuery) ||
        (dm.user.displayName || "").toLowerCase().includes(normalizedQuery) ||
        (dm.user.discriminator || "").toLowerCase().includes(normalizedQuery)
      )
    })
  }, [dms, normalizedQuery])

  const startDM = async (userId: string) => {
    if (!token) return
    try {
      const response = await api.createDM(token, userId)
      if (response.id) navigate(`/channels/@me/${response.id}`)
    } catch (error) {
      console.error("Failed to create DM", error)
    }
  }

  const handleRespond = async (requestId: string, action: "accept" | "decline") => {
    if (!token) return
    try {
      await api.respondFriendRequest(token, requestId, action)
      fetchData()
    } catch (error) {
      console.error(error)
    }
  }

  return (
    <div className="flex h-full flex-1 flex-col bg-background/70 text-foreground">
      <div className="shrink-0 border-b border-border bg-base-100/70 px-4 py-3 shadow-sm backdrop-blur-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            <span className="mr-1 flex items-center gap-2 text-base-content/75">
              <UserPlus className="h-4 w-4" />
              Friends
            </span>
            <Button variant={activeTab === "online" ? "secondary" : "ghost"} size="sm" onClick={() => setActiveTab("online")}>Online</Button>
            <Button variant={activeTab === "all" ? "secondary" : "ghost"} size="sm" onClick={() => setActiveTab("all")}>All</Button>
            <Button variant={activeTab === "dms" ? "secondary" : "ghost"} size="sm" onClick={() => setActiveTab("dms")}>DMs</Button>
            <Button variant={activeTab === "pending" ? "secondary" : "ghost"} size="sm" onClick={() => setActiveTab("pending")}>
              Pending {requests.length > 0 && <span className="badge badge-error badge-sm ml-1">{requests.length}</span>}
            </Button>
            <Button variant="default" size="sm" className="rounded-lg bg-emerald-600 text-white hover:bg-emerald-500" onClick={() => setAddFriendOpen(true)}>
              Add Friend
            </Button>
          </div>

          <div className="relative w-full md:w-72">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search people"
              className="h-9 bg-base-100 pl-9"
            />
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-base-content/45" />
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <span className="loading loading-spinner loading-md text-primary" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === "pending" ? (
            <>
              <h2 className="mb-4 text-xs font-bold uppercase text-muted-foreground">Pending - {filteredRequests.length}</h2>
              <ul className="space-y-2">
                {filteredRequests.length === 0 && <li className="mt-10 text-center text-muted-foreground">There are no pending friend requests.</li>}
                {filteredRequests.map((request) => (
                  <li key={request.id} className="flex items-center justify-between rounded-xl border border-base-300/70 bg-base-100/65 p-2 hover:bg-base-100">
                    <div className="flex items-center gap-3">
                      <img src={request.user.avatarUrl || "/placeholder-user.jpg"} alt="" className="h-8 w-8 rounded-full bg-secondary object-cover" />
                      <div>
                        <div className="text-sm font-medium">
                          {request.user.username}
                          <span className="text-muted-foreground text-xs opacity-70">#{request.user.discriminator}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">{request.type === "incoming" ? "Incoming Friend Request" : "Outgoing Friend Request"}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {request.type === "incoming" && (
                        <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full bg-base-200 hover:bg-green-500 hover:text-white" onClick={() => handleRespond(request.id, "accept")}>
                          <Check className="h-4 w-4" />
                        </Button>
                      )}
                      <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full bg-base-200 hover:bg-red-500 hover:text-white" onClick={() => handleRespond(request.id, "decline")}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : activeTab === "dms" ? (
            <>
              <h2 className="mb-4 text-xs font-bold uppercase text-muted-foreground">Direct Messages - {filteredDMs.length}</h2>
              <ul className="space-y-2">
                {filteredDMs.length === 0 && <li className="mt-10 text-center text-muted-foreground">No active conversations.</li>}
                {filteredDMs.map((dm) => (
                  <li key={dm.id} className="group flex cursor-pointer items-center justify-between rounded-xl border border-base-300/70 bg-base-100/65 p-2 hover:bg-base-100" onClick={() => navigate(`/channels/@me/${dm.id}`)}>
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <img src={dm.user.avatarUrl || "/placeholder-user.jpg"} alt="" className="h-8 w-8 rounded-full bg-secondary object-cover" />
                        <span className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-background ${statusDot(dm.user.status)}`} />
                      </div>
                      <div>
                        <div className="text-sm font-medium">
                          {dm.user.username}
                          <span className="text-muted-foreground text-xs opacity-70">#{dm.user.discriminator}</span>
                        </div>
                        <div className="text-xs capitalize text-muted-foreground">{dm.user.status}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                      <Button size="icon" variant="secondary" className="h-8 w-8 rounded-full" onClick={(e) => { e.stopPropagation(); navigate(`/channels/@me/${dm.id}`) }}>
                        <MessageSquare className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <h2 className="mb-4 text-xs font-bold uppercase text-muted-foreground">{activeTab === "online" ? "Online" : "All Friends"} - {filteredFriends.length}</h2>
              <ul className="space-y-2">
                {filteredFriends.length === 0 && <li className="mt-10 text-center text-muted-foreground">No friends found.</li>}
                {filteredFriends.map((friend) => (
                  <li key={friend.id} className="group flex cursor-pointer items-center justify-between rounded-xl border border-base-300/70 bg-base-100/65 p-2 hover:bg-base-100" onClick={() => startDM(friend.id)}>
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <img src={friend.avatarUrl || "/placeholder-user.jpg"} alt="" className="h-8 w-8 rounded-full bg-secondary object-cover" />
                        <span className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-background ${statusDot(friend.status)}`} />
                      </div>
                      <div>
                        <div className="text-sm font-medium">
                          {friend.username}
                          <span className="text-muted-foreground text-xs opacity-70">#{friend.discriminator}</span>
                        </div>
                        <div className="text-xs capitalize text-muted-foreground">{friend.status}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                      <Button size="icon" variant="secondary" className="h-8 w-8 rounded-full" onClick={(e) => { e.stopPropagation(); startDM(friend.id) }}>
                        <MessageSquare className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <AddFriendModal open={addFriendOpen} onClose={() => setAddFriendOpen(false)} onSent={fetchData} />
    </div>
  )
}
