import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import { Sheet } from "@/components/ui/sheet"
import ServerSidebar from "./ServerSidebar"
import ChannelSidebar from "./ChannelSidebar"
import DMListSidebar from "./DMListSidebar"
import ChatPanel from "./ChatPanel"
import OverviewPanel from "./OverviewPanel"
import UserList from "./UserList"

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
      if (!mobile) {
        setMobileMenuOpen(false)
        setMobileUserListOpen(false)
      }
    }
    handleResize()
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [])

  const handleUserListToggle = () => {
    if (window.innerWidth < 1024) {
      setMobileUserListOpen((prev) => !prev)
    } else {
      setShowUserList((prev) => !prev)
    }
  }

  const Sidebar = variant === "dm" ? DMListSidebar : ChannelSidebar
  const sidebarProps = variant === "dm" ? {} : { guildId, activeChannelId: channelName }
  const resolvedShowUserList = isMobile ? mobileUserListOpen : showUserList

  return (
    <>
      <div className="relative h-dvh overflow-hidden">
        <div
          className={cn(
            "grid h-full min-h-0 overflow-hidden bg-slate-950/70",
            "grid-cols-[1fr]",
            "md:grid-cols-[68px_280px_1fr]",
            variant === "guild" && showUserList ? "lg:grid-cols-[68px_280px_1fr_280px]" : "lg:grid-cols-[68px_280px_1fr]"
          )}
        >
          <div className="hidden h-full border-r border-cyan-400/15 md:block">
            <ServerSidebar />
          </div>
          <div className="hidden h-full border-r border-cyan-400/15 md:block">
            <Sidebar {...sidebarProps} />
          </div>

          <div className="min-h-0 overflow-hidden">
            {mode === "overview" ? (
              <OverviewPanel
                variant={variant}
                onMobileMenu={() => setMobileMenuOpen(true)}
                onUserListToggle={variant === "guild" ? handleUserListToggle : undefined}
                showUserList={resolvedShowUserList}
              />
            ) : (
              <ChatPanel
                variant={variant}
                channelName={channelName}
                channelId={channelId}
                guildName={guildName}
                guildId={guildId}
                onMobileMenu={() => setMobileMenuOpen(true)}
                onUserListToggle={handleUserListToggle}
                showUserList={resolvedShowUserList}
              />
            )}
          </div>

          {variant !== "dm" && showUserList && (
            <div className="hidden h-full min-h-0 border-l border-cyan-400/15 lg:flex">
              <UserList serverId={guildId} channelId={channelId} className="w-full border-none" />
            </div>
          )}
        </div>
      </div>

      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen} side="left">
        <div className="grid h-full w-full grid-cols-[68px_1fr] overflow-hidden">
          <div className="border-r border-cyan-400/15">
            <ServerSidebar />
          </div>
          <div className="overflow-hidden">
            <Sidebar {...sidebarProps} />
          </div>
        </div>
      </Sheet>

      <Sheet open={mobileUserListOpen} onOpenChange={setMobileUserListOpen} side="right">
        <UserList serverId={guildId} channelId={channelId} className="h-full w-full border-none" />
      </Sheet>
    </>
  )
}
