import { useParams } from "react-router-dom"
import AppShell from "@/components/app/AppShell"
import { getSelection, setSelection } from "@/hooks/useSelection"

export default function GuildChannel() {
  const { guildId, channelId } = useParams()
  const sel = getSelection()
  const sid = guildId ?? sel.serverId
  const cid = channelId ?? sel.channelId
  if (guildId && guildId !== sel.serverId) setSelection({ serverId: guildId })
  if (channelId && channelId !== sel.channelId) setSelection({ channelId })
  const channelName = cid ?? "chat-room"
  const guildName = sid ? `Server ${sid}` : "Select a server"
  return <AppShell variant="guild" channelName={channelName} guildName={guildName} guildId={sid} />
}
