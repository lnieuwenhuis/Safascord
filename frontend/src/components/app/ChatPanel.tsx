import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Hash, MessageSquare } from "lucide-react"
import { useEffect, useRef, useState } from "react"

const initialMessages = Array.from({ length: 24 }).map((_, i) => ({ id: i, user: `User ${i % 5}`, text: `Message ${i + 1}` }))

export default function ChatPanel({ variant, channelName, guildName }: { variant: "guild" | "dm"; channelName: string; guildName?: string }) {
  const [msgs, setMsgs] = useState(initialMessages)
  const [text, setText] = useState("")
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [msgs.length, channelName, variant])

  const send = () => {
    const t = text.trim()
    if (!t) return
    setMsgs((prev) => [...prev, { id: Date.now(), user: "You", text: t }])
    setText("")
  }

  return (
    <div className="min-h-0 flex flex-1 flex-col">
      <div className="flex h-12 items-center justify-between border-b border-white/10 px-4">
        <div className="flex items-center gap-2">
          {variant === "guild" ? (
            <Hash className="h-4 w-4 text-muted-foreground" />
          ) : (
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          )}
          <div className="text-sm font-semibold">
            {variant === "guild" && guildName ? <span className="text-muted-foreground">{guildName} · </span> : null}
            {variant === "guild" ? `#${channelName}` : channelName}
          </div>
        </div>
        <div className="w-64">
          <Input placeholder="Search" />
        </div>
      </div>
      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto p-4">
        <div className="space-y-4">
          {msgs.map((m) => (
            <div key={m.id} className="flex items-start gap-3">
              <div className="h-8 w-8 rounded-full bg-blue-600" />
              <div>
                <div className="text-sm font-medium">{m.user}</div>
                <div className="text-sm text-muted-foreground">{m.text}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-white/10 p-3">
        <div className="flex items-center gap-2">
          <Input
            placeholder={variant === "guild" ? `Message #${channelName}` : `Message ${channelName}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") send()
            }}
          />
          <Button variant="brand" onClick={send}>Send</Button>
        </div>
      </div>
    </div>
  )
}
