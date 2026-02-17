import { useEffect, useState } from "react"
import { ProfileCard } from "./UserCard"
import { api, getFullUrl } from "@/lib/api"
import type { User, UserStatus, Role } from "@/types"
import { useAuth } from "@/hooks/useAuth"
import { Loader2 } from "lucide-react"
import { useNavigate } from "react-router-dom"

interface UserProfilePopoverProps {
  userId: string | null
  serverId?: string
  isOpen: boolean
  onClose: () => void
  position: DOMRect | null
}

export default function UserProfilePopover({ userId, serverId, isOpen, onClose, position }: UserProfilePopoverProps) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(false)
  
  const [roles, setRoles] = useState<Role[]>([])

  const { token, user: currentUser } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (isOpen && userId && token) {
      setLoading(true)
      setUser(null)
      setRoles([])

      const fetchData = async () => {
        try {
          // 1. Fetch User Profile
          let userData: User | null = null
          if (currentUser && currentUser.id === userId) {
            userData = currentUser
          } else {
            const res = await api.getUserProfile(token, userId)
            if (res.user) userData = res.user
          }
          setUser(userData)

          // 2. Fetch Role Info if serverId is present
          if (serverId && userData) {
             try {
               const membersRes = await api.getServerMembers(token, serverId)
               const member = membersRes.members?.find(m => m.id === userId)
               if (member) {
                  // We need the full role objects to display colors
                  const rolesRes = await api.getRoles(token, serverId)
                  if (rolesRes.roles) {
                     const userRoles = rolesRes.roles.filter(r => member.roles.includes(r.id))
                     // Sort by position (assuming roles returned from API might be sorted, or we can rely on filter order if rolesRes is sorted)
                     // Ideally we should sort them here if they have position data.
                     setRoles(userRoles)
                  }
               }
             } catch (e) {
               console.error("Failed to fetch roles", e)
             }
          }
        } catch (err) {
          console.error("Failed to fetch data:", err)
        } finally {
          setLoading(false)
        }
      }
      
      fetchData()
    }
  }, [isOpen, userId, serverId, token, currentUser])

  // Role management moved to Server Settings
  const handleAddFriend = async () => {
     if (!token || !userId) return
     try {
         const res = await api.sendFriendRequest(token, { userId })
         if (res.error) {
             alert(res.error)
         } else {
             // Optimistic update
             setUser(prev => prev ? ({ ...prev, friendshipStatus: 'outgoing' }) : null)
         }
     } catch (e) {
         console.error(e)
         alert("Failed to send friend request")
     }
  }

  const handleAcceptFriend = async () => {
      if (!token || !user?.friendRequestId) return
      try {
          const res = await api.respondFriendRequest(token, user.friendRequestId, 'accept')
          if (res.error) {
              alert(res.error)
          } else {
              // Optimistic update
              setUser(prev => prev ? ({ ...prev, friendshipStatus: 'friends', friendRequestId: undefined }) : null)
          }
      } catch (e) {
          console.error(e)
          alert("Failed to accept friend request")
      }
  }

  const handleDM = async () => {
      if (!token || !userId) return
      try {
          const res = await api.createDM(token, userId)
          if (res.id) {
              onClose()
              navigate(`/channels/@me/${res.id}`)
          } else {
             console.error("Failed to start DM:", res.error)
             alert(`Failed to start DM: ${res.error}`)
          }
      } catch (e) {
          console.error(e)
          alert("An error occurred while starting DM.")
      }
  }

  if (!isOpen || !position) return null

  // Calculate position with side fallback so this can be reused from both user-list and chat clicks.
  const popoverWidth = 300
  const gap = 10
  const spaceLeft = position.left
  const spaceRight = window.innerWidth - position.right

  let popoverLeft = position.left - popoverWidth - gap
  if (spaceRight >= popoverWidth + gap) {
    popoverLeft = position.right + gap
  } else if (spaceLeft >= popoverWidth + gap) {
    popoverLeft = position.left - popoverWidth - gap
  } else {
    popoverLeft = Math.max(10, Math.min(window.innerWidth - popoverWidth - 10, position.left))
  }
  
  // Adjust top if it goes off screen
  let top = position.top
  const height = 400 // Approx height of card
  if (top + height > window.innerHeight) {
      top = window.innerHeight - height - 10
  }

  return (
    <>
      <div className="fixed inset-0 z-[99]" onClick={onClose} />
      <div 
        className="fixed z-[100] bg-popover border border-border rounded-xl shadow-xl w-[300px] overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        style={{
            top: `${top}px`,
            left: `${popoverLeft}px`
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : user ? (
          <ProfileCard
            displayName={user.displayName || user.username}
            username={user.username}
            bio={user.bio || ""}
            avatarUrl={getFullUrl(user.avatarUrl)}
            bannerUrl={getFullUrl(user.bannerUrl)}
            bannerColor={user.bannerColor || "#e0ac00"}
            status={user.status as UserStatus || "online"}
            isPremium={false}
            className="border-0 shadow-none w-full rounded-none"
            roles={roles}
            discriminator={user.discriminator}
            friendshipStatus={user.friendshipStatus}
            allowDmsFromStrangers={user.allowDmsFromStrangers}
            isMe={currentUser?.id === user.id}
            onAddFriend={handleAddFriend}
            onAcceptFriend={handleAcceptFriend}
            onDM={handleDM}
          />
        ) : (
          <div className="flex h-20 items-center justify-center text-muted-foreground">
            <span>User not found</span>
          </div>
        )}
      </div>
    </>
  )
}
