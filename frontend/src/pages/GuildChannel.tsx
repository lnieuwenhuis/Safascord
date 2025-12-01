import { useParams, useNavigate } from "react-router-dom"
import AppShell from "@/components/app/AppShell"
import { getSelection, setSelection } from "@/hooks/useSelection"
import { useEffect, useState } from "react"
import { api } from "@/lib/api"

export default function GuildChannel() {
  const { guildId, channelId } = useParams()
  const navigate = useNavigate()
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
    
    // Fetch server details
    api.servers(token).then((r) => {
      const s = r.servers.find((x) => String(x.id) === String(sid))
      setServerName(s?.name || `Server ${sid}`)
    }).catch(() => setServerName(`Server ${sid}`))

    // If no channel is selected, find the first one and redirect
    if (!channelId) {
        api.channels(sid, token).then(res => {
            if (res.sections.length > 0) {
                // Find first readable text channel
                for (const section of res.sections) {
                    const firstChannel = section.channels.find(c => c.type === 'text')
                    if (firstChannel) {
                        navigate(`/server/${sid}/channel/${firstChannel.name}`)
                        return
                    }
                }
                // Fallback if no text channel found in sections
                const firstAny = res.sections[0].channels[0]
                if (firstAny) {
                    navigate(`/server/${sid}/channel/${firstAny.name}`)
                }
            }
        }).catch(console.error)
    }
  }, [sid, channelId, navigate])

  const mode = cid ? "chat" : "overview"
  return <AppShell variant="guild" channelName={channelName} channelId={cid} guildName={serverName} guildId={sid} mode={mode} />
}
