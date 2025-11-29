import { useEffect, useState } from "react"
import { ProfileCard } from "./UserCard"
import { api, getFullUrl } from "@/lib/api"
import type { User, UserStatus } from "@/types"
import { useAuth } from "@/hooks/useAuth"
import { Loader2 } from "lucide-react"

interface UserProfileDialogProps {
  userId: string | null
  isOpen: boolean
  onClose: () => void
}

export default function UserProfileDialog({ userId, isOpen, onClose }: UserProfileDialogProps) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(false)
  const { token, user: currentUser } = useAuth()

  useEffect(() => {
    if (isOpen && userId && token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(true)
      setUser(null)
      // Check if it's me, use local data to be faster/consistent
      if (currentUser && currentUser.id === userId) {
        setUser(currentUser)
        setLoading(false)
        return
      }

      api.getUserProfile(token, userId)
        .then((res) => {
          if (res.user) {
            setUser(res.user)
          }
        })
        .finally(() => setLoading(false))
    }
  }, [isOpen, userId, token, currentUser])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="relative" onClick={(e) => e.stopPropagation()}>
        {loading ? (
            <div className="flex h-[400px] w-[300px] items-center justify-center rounded-xl bg-popover text-popover-foreground shadow-2xl">
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
              isPremium={false} // Todo: real premium check
            />
        ) : (
             <div className="flex h-[200px] w-[300px] items-center justify-center rounded-xl bg-popover text-popover-foreground shadow-2xl">
                <span className="text-muted-foreground">User not found</span>
            </div>
        )}
      </div>
    </div>
  )
}
