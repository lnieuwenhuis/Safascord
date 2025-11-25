import { useParams } from "react-router-dom"
import AppShell from "@/components/app/AppShell"
import { getSelection, setSelection } from "@/hooks/useSelection"

export default function DMChannel() {
  const { dmId } = useParams()
  const sel = getSelection()
  const id = dmId ?? sel.dmId
  if (dmId && dmId !== sel.dmId) setSelection({ dmId })
  const channelName = id ? `DM · ${id}` : "Direct Messages"
  return <AppShell variant="dm" channelName={channelName} />
}
