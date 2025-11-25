import { useParams } from "react-router-dom"
import AppShell from "@/components/app/AppShell"

export default function GuildChannel() {
  const { guildId, channelId } = useParams()
  const channelName = channelId ?? "chat-room"
  const guildName = guildId ? `Guild ${guildId}` : "FST [est. 2025]"
  return <AppShell variant="guild" channelName={channelName} guildName={guildName} />
}
