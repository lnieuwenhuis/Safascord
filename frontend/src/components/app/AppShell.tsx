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
  guildId,
}: {
  variant?: "guild" | "dm"
  channelName: string
  guildName?: string
  mode?: "chat" | "overview"
  guildId?: string
}) {
  const cols = variant === "dm" ? "grid-cols-[64px_260px_1fr]" : "grid-cols-[64px_260px_1fr_300px]"
  return (
    <div className={`grid h-dvh ${cols} overflow-hidden bg-gradient-to-b from-[#0a0f1a] to-[#0b1b2e]`}>
      <ServerSidebar />
      {variant === "dm" ? <DMListSidebar /> : <ChannelSidebar guildId={guildId} />}
      {mode === "overview" ? (
        <OverviewPanel />
      ) : (
        <ChatPanel variant={variant} channelName={channelName} guildName={guildName} />
      )}
      {variant !== "dm" && <UserList serverId={guildId} />}
    </div>
  )
}
