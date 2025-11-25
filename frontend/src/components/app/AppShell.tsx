import ServerSidebar from "./ServerSidebar"
import ChannelSidebar from "./ChannelSidebar"
import DMListSidebar from "./DMListSidebar"
import ChatPanel from "./ChatPanel"
import OverviewPanel from "./OverviewPanel"
import UserList from "./UserList"

export default function AppShell({
  variant = "guild",
  channelName,
  guildName,
  mode = "chat",
}: {
  variant?: "guild" | "dm"
  channelName: string
  guildName?: string
  mode?: "chat" | "overview"
}) {
  return (
    <div className="grid h-dvh grid-cols-[64px_260px_1fr_300px] overflow-hidden bg-gradient-to-b from-[#0a0f1a] to-[#0b1b2e]">
      <ServerSidebar />
      {variant === "dm" ? <DMListSidebar /> : <ChannelSidebar />}
      {mode === "overview" ? (
        <OverviewPanel />
      ) : (
        <ChatPanel variant={variant} channelName={channelName} guildName={guildName} />
      )}
      <UserList />
    </div>
  )
}
