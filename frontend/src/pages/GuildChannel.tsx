import { useParams } from "react-router-dom"
import AppShell from "@/components/app/AppShell"
import { getSelection, setSelection } from "@/hooks/useSelection"
import { useEffect, useState } from "react"
import { api } from "@/lib/api"

export default function GuildChannel() {
  const { guildId, channelId } = useParams()
  const sel = getSelection()
  const sid = guildId ?? sel.serverId
  const cid = channelId ?? sel.channelId
  if (guildId && guildId !== sel.serverId) setSelection({ serverId: guildId })
  if (channelId && channelId !== sel.channelId) setSelection({ channelId })
  const channelName = cid ?? ""
  const [serverName, setServerName] = useState<string>(sid ? "" : "Select a server")
  useEffect(() => {
    if (!sid) return
    const token = typeof window !== "undefined" ? localStorage.getItem("token") || "" : ""
    api.servers(token).then((r) => {
      const s = r.servers.find((x) => String(x.id) === String(sid))
      setServerName(s?.name || `Server ${sid}`)
    }).catch(() => setServerName(`Server ${sid}`))
  }, [sid])
  const mode = cid ? "chat" : "overview"
  return <AppShell variant="guild" channelName={channelName} guildName={serverName} guildId={sid} mode={mode} />
}
