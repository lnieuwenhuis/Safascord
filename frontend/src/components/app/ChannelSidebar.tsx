const sections = [
  { title: "Getting Started", channels: ["roles", "rules", "social-race"] },
  { title: "Chat Room", channels: ["chat-room", "memes", "media"] },
  { title: "Game Chat", channels: ["open-lobbies", "clips", "highlights"] },
]

import UserCard from "./UserCard"

export default function ChannelSidebar() {
  return (
    <aside className="flex h-dvh w-full flex-col border-r border-white/10 bg-[#0b1220]">
      <div className="px-3 py-3">
        <div className="mb-3 flex items-center justify-between px-2">
          <div className="text-sm font-semibold">FST [est. 2025]</div>
          <div className="h-6 w-6 rounded bg-white/10" />
        </div>
        <div className="space-y-4">
          {sections.map((s, i) => (
            <div key={i}>
              <div className="px-2 text-xs uppercase text-muted-foreground">{s.title}</div>
              <ul className="mt-1 space-y-1">
                {s.channels.map((c) => (
                  <li key={c} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-white/5">
                    <span className="h-4 w-4 rounded bg-white/10" />
                    <span className="text-sm">{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-auto">
        <UserCard />
      </div>
    </aside>
  )
}
