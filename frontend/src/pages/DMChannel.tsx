import { useParams } from "react-router-dom"
import AppShell from "@/components/app/AppShell"

export default function DMChannel() {
  const { dmId } = useParams()
  const channelName = dmId ? `DM · ${dmId}` : "Direct Messages"
  return <AppShell variant="dm" channelName={channelName} />
}

