const servers = Array.from({ length: 12 }).map((_, i) => ({ id: i, name: `Server ${i + 1}` }))

export default function Discover() {
  return (
    <div className="min-h-dvh bg-gradient-to-b from-[#0a0f1a] to-[#0b1b2e] px-6 py-10">
      <div className="mx-auto max-w-6xl">
        <h2 className="text-3xl font-bold">Discover</h2>
        <p className="mt-2 text-muted-foreground">Explore servers and communities.</p>
        <div className="mt-8 grid grid-cols-2 gap-6 md:grid-cols-3 lg:grid-cols-4">
          {servers.map(s => (
            <div key={s.id} className="rounded-lg border border-white/10 bg-card p-4">
              <div className="mb-3 h-16 w-16 rounded-2xl bg-blue-600" />
              <div className="text-sm font-medium">{s.name}</div>
              <div className="text-xs text-muted-foreground">Members • 1,234</div>
              <div className="mt-3 h-8 rounded bg-white/10" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
