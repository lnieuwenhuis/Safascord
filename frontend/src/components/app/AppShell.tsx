import ServerSidebar from "./ServerSidebar"
import ChannelSidebar from "./ChannelSidebar"
import DMListSidebar from "./DMListSidebar"
import ChatPanel from "./ChatPanel"
import OverviewPanel from "./OverviewPanel"
import UserList from "./UserList"
import { Sheet } from "@/components/ui/sheet"
import { useState, useEffect } from "react"
import { cn } from "@/lib/utils"

export default function AppShell({
  variant = "guild",
  channelName,
  channelId,
  guildName,
  mode = "chat",
  guildId,
}: {
  variant?: "guild" | "dm"
  channelName: string
  channelId?: string
  guildName?: string
  mode?: "chat" | "overview"
  guildId?: string
}) {
  const [showUserList, setShowUserList] = useState(true)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [mobileUserListOpen, setMobileUserListOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 1024
      setIsMobile(mobile)
      if (window.innerWidth >= 768) {
        setMobileMenuOpen(false)
      }
      if (!mobile) {
        setMobileUserListOpen(false)
      }
    }
    // Initial check
    handleResize()
    
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const handleUserListToggle = () => {
    if (window.innerWidth < 1024) {
      setMobileUserListOpen(!mobileUserListOpen)
    } else {
      setShowUserList(!showUserList)
    }
  }

  const Sidebar = variant === "dm" ? DMListSidebar : ChannelSidebar
  const sidebarProps = variant === "dm" ? {} : { guildId, activeChannelId: channelName }

  return (
    <>
      <div 
        className={cn(
          "grid h-dvh overflow-hidden bg-base-100/55 text-base-content transition-all duration-300 ease-in-out",
          "grid-cols-[1fr]",
          "md:grid-cols-[64px_260px_1fr]",
          variant === "guild" && showUserList 
            ? "lg:grid-cols-[64px_260px_1fr_240px]" 
            : "lg:grid-cols-[64px_260px_1fr]"
        )}
      >
        {/* Desktop Sidebars */}
        <div className="hidden h-full overflow-hidden md:block">
          <ServerSidebar />
        </div>
        <div className="hidden h-full overflow-hidden md:block">
          <Sidebar {...sidebarProps} />
        </div>

        {/* Main Content */}
        {mode === "overview" ? (
          <OverviewPanel />
        ) : (
          <ChatPanel 
            variant={variant} 
            channelName={channelName}
            channelId={channelId} 
            guildName={guildName}
            guildId={guildId}
            onMobileMenu={() => setMobileMenuOpen(true)}
            onUserListToggle={handleUserListToggle}
            showUserList={isMobile ? mobileUserListOpen : showUserList}
          />
        )}

        {/* Desktop User List */}
        {variant !== "dm" && showUserList && (
          <div className="hidden h-full overflow-hidden lg:flex">
            <UserList serverId={guildId} channelId={channelId} className="w-full border-l" />
          </div>
        )}
      </div>

      {/* Mobile Menu Sheet (Left) */}
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen} side="left">
        <div className="flex h-full w-full">
          <div className="shrink-0">
             <ServerSidebar />
          </div>
          <div className="grow overflow-hidden bg-base-100/95">
             <Sidebar {...sidebarProps} />
          </div>
        </div>
      </Sheet>

      {/* Mobile User List Sheet (Right) */}
      <Sheet open={mobileUserListOpen} onOpenChange={setMobileUserListOpen} side="right">
        <UserList serverId={guildId} className="w-full h-full flex border-none" />
      </Sheet>
    </>
  )
}
