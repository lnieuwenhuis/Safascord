import { Compass, Search, Users } from "lucide-react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const servers = Array.from({ length: 12 }).map((_, index) => ({
  id: index,
  name: `Community ${index + 1}`,
  description: "A focused server for builders, operators and creators.",
  members: 1200 + index * 147,
}))

export default function Discover() {
  return (
    <div className="safas-page flex min-h-dvh flex-col">
      <header className="sticky top-0 z-50 border-b border-cyan-300/15 bg-slate-950/78 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 md:px-8">
          <Link className="text-2xl font-extrabold text-slate-100" to="/">safascord</Link>
          <div className="flex items-center gap-2">
            <Link to="/auth">
              <Button variant="ghost" size="sm">Sign in</Button>
            </Link>
            <Link to="/channels/@me">
              <Button size="sm">Open app</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-16 pt-10 md:px-8">
        <section className="safas-panel p-7 md:p-10">
          <p className="safas-label mb-4">Discover Servers</p>
          <h1 className="text-balance text-4xl font-extrabold text-slate-100 md:text-5xl">
            Find your next community
          </h1>
          <p className="mt-4 max-w-2xl text-slate-300/78">
            Browse curated servers around product, software, gaming, and niche communities.
          </p>
          <label className="mt-7 flex h-12 items-center gap-3 rounded-xl border border-cyan-300/20 bg-slate-950/55 px-4">
            <Search className="h-4 w-4 text-cyan-200/80" />
            <Input
              className="h-9 border-none bg-transparent px-0 focus-visible:ring-0"
              placeholder="Search communities..."
            />
          </label>
        </section>

        <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {servers.map((server) => (
            <article key={server.id} className="safas-panel p-5">
              <div className="mb-4 flex items-center justify-between">
                <div className="grid h-11 w-11 place-items-center rounded-xl border border-cyan-300/25 bg-cyan-400/15 text-cyan-100">
                  {server.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="inline-flex items-center gap-1 rounded-full border border-cyan-300/20 px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-cyan-200/80">
                  <Compass className="h-3 w-3" />
                  Featured
                </div>
              </div>
              <h2 className="text-xl font-bold text-slate-100">{server.name}</h2>
              <p className="mt-2 text-sm text-slate-300/72">{server.description}</p>
              <div className="mt-5 flex items-center justify-between">
                <div className="inline-flex items-center gap-2 text-sm text-slate-200/80">
                  <Users className="h-4 w-4 text-cyan-200/85" />
                  {server.members.toLocaleString()} members
                </div>
                <Button size="sm" variant="outline">Join</Button>
              </div>
            </article>
          ))}
        </section>
      </main>
    </div>
  )
}
