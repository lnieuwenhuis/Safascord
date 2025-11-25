import { Button } from "@/components/ui/button"

const servers = Array.from({ length: 12 }).map((_, i) => ({ id: i + 1, name: `Srv ${i + 1}` }))

export default function ServerSidebar() {
  return (
    <aside className="flex h-dvh w-16 flex-col items-center gap-3 overflow-y-auto border-r border-white/10 bg-[#0f1524] px-2 py-3">
      <Button variant="brand" size="icon" className="rounded-2xl">
        D
      </Button>
      <div className="h-px w-8 bg-white/10" />
      {servers.map(s => (
        <div key={s.id} className="flex h-12 w-12 items-center justify-center rounded-2xl bg-card text-xs">
          {s.name}
        </div>
      ))}
    </aside>
  )
}
