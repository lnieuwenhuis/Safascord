import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Headphones, Mic, Cog, Pencil, Circle, MinusCircle, Moon, Disc, ChevronDown, ChevronUp, Check, Image as ImageIcon, Loader2, UserPlus, MessageSquare, X } from "lucide-react"
import { useState, useEffect } from "react"
import UserSettings from "./UserSettings"
import { useAuth } from "@/hooks/useAuth"
import { cn } from "@/lib/utils"
import { api, getFullUrl } from "@/lib/api"
import type { UserStatus, Role } from "@/types"

const statusConfig = {
  online: { label: "Online", color: "bg-green-500", icon: Circle, description: "Online" },
  idle: { label: "Idle", color: "bg-yellow-500", icon: Moon, description: "Idle" },
  dnd: { label: "Do Not Disturb", color: "bg-red-500", icon: MinusCircle, description: "Do Not Disturb" },
  invisible: { label: "Invisible", color: "bg-gray-500", icon: Disc, description: "Invisible" },
}

interface ProfileCardProps {
  displayName: string
  username: string
  bio: string
  avatarUrl: string | null
  bannerUrl: string | null
  bannerColor: string
  status: UserStatus
  isPremium: boolean
  roles?: Role[]
  className?: string
  discriminator?: string
  friendshipStatus?: 'none' | 'friends' | 'outgoing' | 'incoming' | 'blocked'
  allowDmsFromStrangers?: boolean
  isMe?: boolean
  
  onEditProfile?: () => void
  onStatusChange?: (status: UserStatus) => void
  onAddFriend?: () => void
  onAcceptFriend?: () => void
  onDM?: () => void
}

export function ProfileCard({
  displayName,
  username,
  bio,
  avatarUrl,
  bannerUrl,
  bannerColor,
  status,
  isPremium,
  roles,
  className,
  discriminator,
  friendshipStatus,
  allowDmsFromStrangers,
  isMe,
  onEditProfile,
  onStatusChange,
  onAddFriend,
  onAcceptFriend,
  onDM,
}: ProfileCardProps) {
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false)

  const handleStatusSelect = (s: UserStatus) => {
    if (onStatusChange) {
      onStatusChange(s)
    }
    setStatusDropdownOpen(false)
  }

  return (
    <div 
      className={cn(
        "w-[300px] overflow-hidden rounded-xl border border-border bg-popover shadow-2xl",
        className
      )}
    >
      {/* Banner */}
      <div 
        className="h-24 w-full bg-cover bg-center"
        style={{ backgroundColor: bannerColor, backgroundImage: bannerUrl ? `url(${bannerUrl})` : undefined }}
      />
      
      <div className="relative px-4 pb-4">
        {/* Avatar */}
        <div className="absolute -top-10 left-4 z-10 rounded-full bg-popover p-1.5 flex items-center justify-center">
           <div className="relative h-20 w-20">
              <div className="h-full w-full overflow-hidden rounded-full bg-primary/20">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="Avatar" className="h-full w-full object-cover block" />
                ) : (
                  <div className="h-full w-full bg-primary" />
                )}
              </div>
             {/* Status Indicator on Avatar */}
             <div className={cn(
               "absolute bottom-0 right-0 h-6 w-6 rounded-full border-[3px] border-popover flex items-center justify-center",
               statusConfig[status].color
             )}>
               {status === 'dnd' && <div className="h-1 w-3 bg-white rounded-full" />}
               {status === 'idle' && <div className="h-2 w-2 bg-popover rounded-full absolute top-0 left-0 -ml-0.5 -mt-0.5" />} 
             </div>
           </div>
        </div>
        
        {/* Badges (Top Right) */}
        <div className="flex justify-end pt-3">
           <div className="flex gap-1 rounded-lg bg-black/30 px-2 py-1">
             <div className="h-4 w-4 rounded bg-blue-400" title="Verified" />
             <div className="h-4 w-4 rounded bg-green-400" title="Developer" />
             {isPremium && <div className="h-4 w-4 rounded bg-pink-400" title="Cosmetic Tier" />}
           </div>
        </div>

        <div className="mt-14 space-y-1">
          <div className="text-xl font-bold leading-none">{displayName}</div>
          <div className="text-sm font-medium text-muted-foreground">
            {username}
            {discriminator && <span className="opacity-70">#{discriminator}</span>}
          </div>
        </div>

        <div className="mt-3 text-sm whitespace-pre-wrap wrap-break-word">
           {bio || <span className="text-muted-foreground italic">No bio provided</span>}
        </div>

        {/* Separator */}
        <div className="my-3 h-1px bg-border" />
        
        {/* Role Section */}
        {roles && roles.length > 0 && (
          <div className="mb-3">
            <div className="text-xs font-bold uppercase text-muted-foreground mb-1">Roles</div>
            <div className="flex flex-wrap gap-1">
               {roles.map(role => (
                 <div key={role.id} className="flex items-center gap-1 bg-secondary/50 rounded px-1.5 py-0.5">
                    <div className="h-2 w-2 rounded-full" style={{ backgroundColor: role.color }} />
                    <span className="text-xs font-medium">{role.name}</span>
                 </div>
               ))}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        {!isMe && (
          <div className="mb-3 flex gap-2">
             {(friendshipStatus === 'friends' || allowDmsFromStrangers) && (
                <Button className="flex-1 h-8 text-xs" onClick={onDM}>
                   <MessageSquare className="mr-2 h-3 w-3" />
                   Message
                </Button>
             )}
             {friendshipStatus === 'none' && (
                <Button className="flex-1 h-8 text-xs" variant="secondary" onClick={onAddFriend}>
                   <UserPlus className="mr-2 h-3 w-3" />
                   Add Friend
                </Button>
             )}
             {friendshipStatus === 'outgoing' && (
                <Button className="flex-1 h-8 text-xs" variant="secondary" disabled>
                   Request Sent
                </Button>
             )}
             {friendshipStatus === 'incoming' && (
                <Button className="flex-1 h-8 text-xs bg-green-600 hover:bg-green-700 text-white" onClick={onAcceptFriend}>
                   Accept Request
                </Button>
             )}
          </div>
        )}

        {/* Status Picker Dropdown */}
        {onStatusChange && (
        <div className="relative mb-2">
           <button 
             className="flex w-full items-center justify-between rounded-md p-2 hover:bg-accent/50 transition-colors border border-transparent hover:border-border"
             onClick={() => setStatusDropdownOpen(!statusDropdownOpen)}
           >
             <div className="flex items-center gap-2">
               <div className={cn("flex h-3 w-3 items-center justify-center rounded-full", statusConfig[status].color)}>
                   {status === 'dnd' && <div className="h-0.5 w-2 bg-white" />}
                   {status === 'idle' && <div className="h-1.5 w-1.5 bg-popover rounded-full absolute top-0 left-0" />} 
               </div>
               <span className="text-sm font-medium">{statusConfig[status].label}</span>
             </div>
             {statusDropdownOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
           </button>
           
           {statusDropdownOpen && (
             <>
               <div className="fixed inset-0 z-50" onClick={() => setStatusDropdownOpen(false)} />
               <div className="absolute bottom-full left-0 mb-1 w-full rounded-md border border-border bg-popover p-1 shadow-lg z-60">
                 {(Object.keys(statusConfig) as UserStatus[]).map((s) => (
                   <button
                     key={s}
                     className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                     onClick={() => handleStatusSelect(s)}
                   >
                     <div className="flex items-center gap-2">
                       <div className={cn("flex h-2.5 w-2.5 items-center justify-center rounded-full", statusConfig[s].color)}>
                          {s === 'dnd' && <div className="h-0.5 w-1.5 bg-white" />}
                          {s === 'idle' && <div className="h-1 w-1 bg-popover rounded-full absolute top-0 left-0" />} 
                       </div>
                       <span>{statusConfig[s].label}</span>
                     </div>
                     {status === s && <Check className="h-3 w-3" />}
                   </button>
                 ))}
               </div>
             </>
           )}
        </div>
        )}

        {/* Edit Profile Button */}
        {onEditProfile && (
        <button 
          className="flex w-full items-center justify-center gap-2 rounded-md bg-secondary/80 px-2 py-1.5 text-sm font-medium transition-colors hover:bg-secondary"
          onClick={onEditProfile}
          disabled={!onEditProfile}
        >
          <Pencil className="h-3.5 w-3.5" />
          Edit Profile
        </button>
        )}
      </div>
    </div>
  )
}

export default function UserCard() {
  const [muted, setMuted] = useState(false)
  const [deaf, setDeaf] = useState(false)
  const [open, setOpen] = useState(false) // Settings modal
  const [showProfile, setShowProfile] = useState(false) // Profile popup
  const [editProfileOpen, setEditProfileOpen] = useState(false) // Edit Profile Modal
  const [isSaving, setIsSaving] = useState(false)

  const { user, updateUser } = useAuth()
  
  // Initialize state from user object
  const [displayName, setDisplayName] = useState((user && (user.displayName || user.username)) || "You")
  const [bio, setBio] = useState(user?.bio || "")
  const [bannerColor, setBannerColor] = useState(user?.bannerColor || "#e0ac00")
  const [bannerImage, setBannerImage] = useState<string | null>(getFullUrl(user?.bannerUrl))
  const [avatarImage, setAvatarImage] = useState<string | null>(getFullUrl(user?.avatarUrl))
  const [status, setStatus] = useState<UserStatus>((user?.status as UserStatus) || "online")
  
  // #FIXME: Add the actual premiums tiers and checks
  const [isPremium] = useState(true) // Mock "Cosmetic Tier"

  // Temporary state for the Edit Modal
  const [tempDisplayName, setTempDisplayName] = useState(displayName)
  const [tempBio, setTempBio] = useState(bio)
  const [tempBannerColor, setTempBannerColor] = useState(bannerColor)
  const [tempBannerImage, setTempBannerImage] = useState<string | null>(bannerImage)
  const [tempAvatarImage, setTempAvatarImage] = useState<string | null>(avatarImage)
  const [tempCustomBackground, setTempCustomBackground] = useState<string | null>(getFullUrl(user?.customBackgroundUrl))
  
  // Files to upload
  const [bannerFile, setBannerFile] = useState<File | null>(null)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [customBackgroundFile, setCustomBackgroundFile] = useState<File | null>(null)

  const username = user?.username || "user"

  // Sync local state when user object updates
  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName || user.username || "You")
      setBio(user.bio || "")
      setBannerColor(user.bannerColor || "#e0ac00")
      setBannerImage(getFullUrl(user.bannerUrl))
      setAvatarImage(getFullUrl(user.avatarUrl))
      if (user.status) setStatus(user.status as UserStatus)
    }
  }, [user])



  const handleEditOpen = () => {
    setTempDisplayName(displayName)
    setTempBio(bio)
    setTempBannerColor(bannerColor)
    setTempBannerImage(bannerImage)
    setTempAvatarImage(avatarImage)
    setBannerFile(null)
    setAvatarFile(null)
    setEditProfileOpen(true)
    setShowProfile(false) // Close the small popup
  }

  const handleSaveProfile = async () => {
    if (!user) return
    setIsSaving(true)
    try {
      let newBannerUrl = user.bannerUrl
      let newAvatarUrl = user.avatarUrl
      let newBackgroundUrl = user.customBackgroundUrl

      const token = localStorage.getItem("token")
      if (!token) return

      // Upload files if changed
      if (bannerFile) {
        const res = await api.uploadFile(token, bannerFile)
        if (res.url) newBannerUrl = res.url
      }
      if (avatarFile) {
        const res = await api.uploadFile(token, avatarFile)
        if (res.url) newAvatarUrl = res.url
      }
      if (customBackgroundFile) {
        const res = await api.uploadFile(token, customBackgroundFile)
        if (res.url) newBackgroundUrl = res.url
      }

      // Update Profile
      const profileData = {
        bio: tempBio,
        bannerColor: tempBannerColor,
        bannerUrl: newBannerUrl,
        avatarUrl: newAvatarUrl,
        customBackgroundUrl: newBackgroundUrl,
        status: status // Maintain current status
      }
      
      const profileRes = await api.updateProfile(token, profileData)
      
      // Update Display Name if changed
      if (tempDisplayName !== displayName) {
        await api.updateDisplayName(token, tempDisplayName)
      }

      // Update Context
      if (profileRes.user) {
        updateUser({
           ...user,
           ...profileRes.user,
           displayName: tempDisplayName,
           bannerUrl: newBannerUrl,
           avatarUrl: newAvatarUrl,
           customBackgroundUrl: newBackgroundUrl,
           bio: tempBio,
           bannerColor: tempBannerColor
        })
      }

      setEditProfileOpen(false)
    } catch (e) {
      console.error("Failed to save profile", e)
    } finally {
      setIsSaving(false)
    }
  }

  const handleStatusChange = async (s: UserStatus) => {
    setStatus(s)
    if (!user) return
    const token = localStorage.getItem("token")
    if (token) {
      try {
        const res = await api.updateProfile(token, { status: s })
        if (res.user) {
          updateUser(res.user)
        }
      } catch (e) {
        console.error("Failed to update status", e)
      }
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, type: 'banner' | 'avatar' | 'background') => {
    const file = e.target.files?.[0]
    if (file) {
      if (type === 'banner') setBannerFile(file)
      if (type === 'avatar') setAvatarFile(file)
      if (type === 'background') setCustomBackgroundFile(file)

      const reader = new FileReader()
      reader.onloadend = () => {
        if (type === 'banner') setTempBannerImage(reader.result as string)
        if (type === 'avatar') setTempAvatarImage(reader.result as string)
        if (type === 'background') setTempCustomBackground(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  return (
    <>
      <div className="relative flex h-16 items-center justify-between border-t border-sidebar-border bg-sidebar px-2">
        {/* Profile Popup */}
        {showProfile && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowProfile(false)} />
            <ProfileCard
              className="fixed bottom-[70px] left-[72px] z-50 animate-in fade-in zoom-in-95 duration-200"
              displayName={displayName}
              username={username}
              bio={bio}
              avatarUrl={avatarImage}
              bannerUrl={bannerImage}
              bannerColor={bannerColor}
              status={status}
              isPremium={isPremium}
              onEditProfile={handleEditOpen}
              onStatusChange={handleStatusChange}
            />
          </>
        )}

        {/* User Card Trigger */}
        <div 
          className="flex cursor-pointer items-center gap-2 rounded-md py-1 px-0.5 hover:bg-sidebar-accent/50"
          onClick={() => setShowProfile(!showProfile)}
        >
          <div className="relative">
             <div className="h-8 w-8 overflow-hidden rounded-full bg-primary/20">
                {avatarImage ? (
                  <img src={avatarImage} alt="Avatar" className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full bg-primary" />
                )}
             </div>
            <div className={cn("absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-sidebar", statusConfig[status].color)} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium leading-none">{displayName}</div>
            <div className="text-xs text-muted-foreground whitespace-nowrap">
              <span className="hidden sm:inline">{statusConfig[status].label}</span>
              <span className="sm:hidden">{statusConfig[status].label.substring(0, 3)}</span>
            </div>
          </div>
        </div>

        {/* Sidebar Controls */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="relative text-muted-foreground hover:text-foreground"
            onClick={() => setMuted((v) => !v)}
          >
            <Mic className="h-4 w-4" />
            {muted && <span className="absolute left-1/2 top-1/2 h-2px w-5 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-current" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="relative text-muted-foreground hover:text-foreground"
            onClick={() => setDeaf((v) => !v)}
          >
            <Headphones className="h-4 w-4" />
            {deaf && <span className="absolute left-1/2 top-1/2 h-2px w-5 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-current" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setOpen(true)}
          >
            <Cog className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <UserSettings open={open} onClose={() => setOpen(false)} />

      {/* Edit Profile Modal */}
      {editProfileOpen && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="flex h-[85vh] w-[800px] overflow-hidden rounded-lg bg-card shadow-2xl animate-in zoom-in-95 duration-200 flex-col md:flex-row">
            
            {/* Sidebar / Form */}
            <div className="flex-1 overflow-y-auto p-6 md:w-1/2">
               <h2 className="text-2xl font-bold mb-6">Edit Profile</h2>
               
               <div className="space-y-6">
                 {/* Display Name */}
                 <div className="space-y-2">
                   <label className="text-xs font-bold uppercase text-muted-foreground">Display Name</label>
                   <Input 
                     value={tempDisplayName} 
                     onChange={(e) => setTempDisplayName(e.target.value)} 
                     className="bg-input/50 border-0 focus-visible:ring-1"
                   />
                 </div>

                 {/* Bio */}
                 <div className="space-y-2">
                   <label className="text-xs font-bold uppercase text-muted-foreground">About Me</label>
                   <textarea 
                     value={tempBio}
                     onChange={(e) => setTempBio(e.target.value)}
                     className="flex min-h-[120px] w-full rounded-md bg-input/50 px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none"
                     placeholder="Tell us about yourself"
                   />
                 </div>

                 {/* Avatar Upload */}
                 <div className="space-y-2">
                   <label className="text-xs font-bold uppercase text-muted-foreground">Avatar</label>
                   <div className="flex items-center gap-4">
                     <Button variant="secondary" className="relative overflow-hidden w-full">
                       Change Avatar
                       <input type="file" accept="image/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => handleFileChange(e, 'avatar')} />
                     </Button>
                     {isPremium && (
                       <div className="text-xs text-brand-400 font-medium">GIFs available</div>
                     )}
                   </div>
                 </div>

                 {/* Banner */}
                 <div className="space-y-2">
                   <label className="text-xs font-bold uppercase text-muted-foreground">Banner</label>
                   <div className="space-y-3">
                     <div className="flex items-center gap-3">
                       <div className="h-10 w-10 rounded-full border border-white/20 overflow-hidden relative">
                         <input 
                           type="color" 
                           value={tempBannerColor} 
                           onChange={(e) => setTempBannerColor(e.target.value)}
                           className="absolute inset-[-50%] h-[200%] w-[200%] cursor-pointer p-0 border-0" 
                         />
                       </div>
                       <span className="text-sm text-muted-foreground">Pick a color</span>
                     </div>
                     
                     {isPremium && (
                       <Button variant="secondary" className="relative overflow-hidden w-full">
                         <ImageIcon className="mr-2 h-4 w-4" />
                         Upload Banner
                         <input type="file" accept="image/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => handleFileChange(e, 'banner')} />
                       </Button>
                     )}
                   </div>
                 </div>

                 {/* Custom Background */}
                 <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-muted-foreground">Custom Background</label>
                    <div className="space-y-3">
                       {tempCustomBackground && (
                          <div className="relative h-32 w-full rounded-md overflow-hidden border border-border">
                             <img src={tempCustomBackground} alt="Background preview" className="h-full w-full object-cover" />
                             <Button 
                                variant="destructive" 
                                size="icon" 
                                className="absolute top-2 right-2 h-6 w-6"
                                onClick={() => {
                                   setTempCustomBackground(null)
                                   setCustomBackgroundFile(null)
                                }}
                             >
                                <X className="h-3 w-3" />
                             </Button>
                          </div>
                       )}
                       <Button variant="secondary" className="relative overflow-hidden w-full">
                          <ImageIcon className="mr-2 h-4 w-4" />
                          Upload Background
                          <input type="file" accept="image/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => handleFileChange(e, 'background')} />
                       </Button>
                       <p className="text-xs text-muted-foreground">This will be set as the background for the entire app.</p>
                    </div>
                 </div>
               </div>
            </div>

            {/* Preview Section */}
            <div className="bg-muted/30 p-6 md:w-1/2 flex flex-col items-center justify-center border-l border-border relative">
               <div className="absolute top-4 right-4 text-xs font-bold uppercase text-muted-foreground">Preview</div>
               
               <ProfileCard
                  className="shadow-xl relative"
                  displayName={tempDisplayName}
                  username={username}
                  bio={tempBio}
                  avatarUrl={tempAvatarImage}
                  bannerUrl={tempBannerImage}
                  bannerColor={tempBannerColor}
                  status={status}
                  isPremium={isPremium}
               />

               <div className="mt-8 flex gap-3 w-full max-w-[300px]">
                  <Button variant="ghost" className="flex-1" onClick={() => setEditProfileOpen(false)} disabled={isSaving}>Cancel</Button>
                  <Button className="flex-1 bg-brand hover:bg-brand/90 text-white" onClick={handleSaveProfile} disabled={isSaving}>
                    {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Changes"}
                  </Button>
               </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}