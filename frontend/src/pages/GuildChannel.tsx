import { useParams, useNavigate } from "react-router-dom"
import AppShell from "@/components/app/AppShell"
import { getSelection, setSelection } from "@/hooks/useSelection"
import { useEffect, useState } from "react"
import { api } from "@/lib/api"
import type { ChannelSection } from "@/types"
import { useAppCacheStore } from "@/stores/cacheStore"

type FlatChannel = {
  id: string
  name: string
  type: string
}

function flattenChannels(sections: ChannelSection[]): FlatChannel[] {
  return sections.flatMap((section) =>
    section.channels.map((channel) => ({
      id: channel.id,
      name: channel.name,
      type: channel.type,
    })),
  )
}

export default function GuildChannel() {
  const { guildId, channelId } = useParams()
  const navigate = useNavigate()
  const sel = getSelection()
  const sid = guildId ?? sel.serverId
  const routeChannel = channelId ?? sel.channelId
  const cachedServers = useAppCacheStore((state) => state.servers)
  const cachedSections = useAppCacheStore((state) => (sid ? state.channelsByServer[sid] : undefined))
  const [serverName, setServerName] = useState<string>(sid ? "" : "Select a server")
  const [resolvedChannelId, setResolvedChannelId] = useState<string | undefined>(undefined)
  const [resolvedChannelName, setResolvedChannelName] = useState("")

  useEffect(() => {
    if (!guildId) return
    setSelection({ serverId: guildId })
  }, [guildId])

  useEffect(() => {
    if (!sid || !cachedServers) return
    const cached = cachedServers.find((x) => String(x.id) === String(sid))
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (cached) setServerName(cached.name)
  }, [sid, cachedServers])

  useEffect(() => {
    if (!sid) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setServerName("Select a server")
      return
    }
    const token = typeof window !== "undefined" ? localStorage.getItem("token") || "" : ""

    api.servers(token).then((r) => {
      const s = r.servers.find((x) => String(x.id) === String(sid))
      setServerName(s?.name || `Server ${sid}`)
    }).catch(() => setServerName(`Server ${sid}`))
  }, [sid])

  useEffect(() => {
    if (!sid || !cachedSections) return
    const channels = flattenChannels(cachedSections)
    if (channels.length === 0) return
    const firstChannel = channels.find((c) => c.type === "text") || channels[0]
    const matched = routeChannel
      ? channels.find((c) => c.id === routeChannel) || channels.find((c) => c.name === routeChannel)
      : firstChannel
    const active = matched || firstChannel
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setResolvedChannelId(active.id)
    setResolvedChannelName(active.name)
  }, [sid, routeChannel, cachedSections])

  useEffect(() => {
    let cancelled = false
    if (!sid) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResolvedChannelId(undefined)
      setResolvedChannelName("")
      return
    }

    const token = typeof window !== "undefined" ? localStorage.getItem("token") || "" : ""
    const resolveChannel = async () => {
      try {
        const res = await api.channels(sid, token)
        if (cancelled) return
        const channels = flattenChannels(res.sections || [])
        if (channels.length === 0) {
          setResolvedChannelId(undefined)
          setResolvedChannelName("")
          return
        }

        const firstChannel = channels.find((c) => c.type === "text") || channels[0]
        const matched = routeChannel
          ? channels.find((c) => c.id === routeChannel) || channels.find((c) => c.name === routeChannel)
          : firstChannel
        const active = matched || firstChannel

        setResolvedChannelId(active.id)
        setResolvedChannelName(active.name)
        setSelection({ serverId: sid, channelId: active.id })

        if (!routeChannel || routeChannel !== active.id) {
          navigate(`/server/${sid}/channel/${active.id}`, { replace: true })
        }
      } catch (e) {
        console.error("Failed to resolve active guild channel", e)
      }
    }

    void resolveChannel()
    return () => {
      cancelled = true
    }
  }, [sid, routeChannel, navigate])

  const mode = resolvedChannelId ? "chat" : "overview"
  return (
    <AppShell
      variant="guild"
      channelName={resolvedChannelName}
      channelId={resolvedChannelId}
      guildName={serverName}
      guildId={sid}
      mode={mode}
    />
  )
}
