import { ArrowRight, Compass, Hash, Radio, ShieldCheck, Sparkles, Users } from "lucide-react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"

export default function Home() {
  return (
    <div className="safas-page flex min-h-dvh flex-col">
      <header className="sticky top-0 z-50 border-b border-cyan-300/15 bg-slate-950/78 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 md:px-8">
          <div className="text-3xl font-extrabold tracking-tight text-slate-100">Safascord</div>
          <nav className="hidden items-center gap-7 text-sm font-semibold text-slate-300/75 md:flex">
            <Link className="hover:text-cyan-200" to="/">Home</Link>
            <Link className="hover:text-cyan-200" to="/discover">Discover</Link>
            <Link className="hover:text-cyan-200" to="/auth">Sign in</Link>
          </nav>
          <Link to="/channels/@me">
            <Button size="sm" className="rounded-xl px-5">Open App</Button>
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-16 pt-10 md:px-8 md:pt-12">
        <section className="relative overflow-hidden rounded-3xl border border-cyan-300/18 bg-slate-950/52 p-6 shadow-[0_22px_70px_-30px_rgba(14,165,233,0.45)] backdrop-blur-xl md:p-10">
          <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-cyan-300/12 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-28 left-10 h-72 w-72 rounded-full bg-blue-500/18 blur-3xl" />
          <div className="relative grid gap-8 lg:grid-cols-[1.08fr_0.92fr] lg:items-center">
            <div>
              <p className="safas-label mb-4">Welcome To Safascord</p>
              <h1 className="max-w-2xl text-balance text-4xl font-extrabold leading-tight text-slate-100 sm:text-5xl md:text-6xl">
                A place to talk, build, and stay in sync.
              </h1>
              <p className="mt-5 max-w-xl text-lg text-slate-300/78">
                Join voice, text, and team channels in one workspace. Safascord keeps your community connected with realtime chat that feels fast and familiar.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link to="/channels/@me">
                  <Button size="lg" className="rounded-xl px-7">
                    Open Safascord
                  </Button>
                </Link>
                <Link to="/auth">
                  <Button size="lg" variant="outline" className="rounded-xl px-7">
                    Sign in with Shoo
                  </Button>
                </Link>
              </div>
              <div className="mt-8 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-cyan-300/20 bg-slate-950/60 p-3">
                  <p className="text-xl font-bold text-cyan-200">Live</p>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-300/70">Realtime delivery</p>
                </div>
                <div className="rounded-xl border border-cyan-300/20 bg-slate-950/60 p-3">
                  <p className="text-xl font-bold text-cyan-200">Role-safe</p>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-300/70">Granular access</p>
                </div>
                <div className="rounded-xl border border-cyan-300/20 bg-slate-950/60 p-3">
                  <p className="text-xl font-bold text-cyan-200">Railway-ready</p>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-300/70">Production deploys</p>
                </div>
              </div>
            </div>

            <div className="safas-panel space-y-5 p-6 md:p-7">
              <div className="flex items-center justify-between">
                <p className="safas-label">Community Snapshot</p>
                <span className="rounded-full border border-emerald-300/30 bg-emerald-300/12 px-2.5 py-1 text-xs font-semibold text-emerald-200">
                  Online
                </span>
              </div>
              <div className="rounded-2xl border border-cyan-300/18 bg-slate-950/58 p-4">
                <p className="text-base font-bold text-slate-100"># welcome</p>
                <p className="mt-2 text-sm text-slate-300/78">
                  Introduce yourself, discover servers, and jump into active channels.
                </p>
              </div>
              <div className="space-y-2.5">
                <div className="flex items-center justify-between rounded-xl border border-cyan-300/14 bg-slate-950/45 px-3 py-2.5">
                  <div className="flex items-center gap-2.5 text-slate-100">
                    <Hash className="h-4 w-4 text-cyan-200" />
                    product-launch
                  </div>
                  <span className="text-xs text-slate-300/70">42 members</span>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-cyan-300/14 bg-slate-950/45 px-3 py-2.5">
                  <div className="flex items-center gap-2.5 text-slate-100">
                    <Hash className="h-4 w-4 text-cyan-200" />
                    community-lounge
                  </div>
                  <span className="text-xs text-slate-300/70">88 members</span>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-cyan-300/14 bg-slate-950/45 px-3 py-2.5">
                  <div className="flex items-center gap-2.5 text-slate-100">
                    <Hash className="h-4 w-4 text-cyan-200" />
                    support-desk
                  </div>
                  <span className="text-xs text-slate-300/70">12 members</span>
                </div>
              </div>
              <Link
                to="/discover"
                className="inline-flex items-center gap-2 text-sm font-semibold text-cyan-200 hover:text-cyan-100"
              >
                Browse public communities
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>

        <section className="mt-8 grid gap-4 md:grid-cols-3">
          <article className="safas-panel p-6">
            <Users className="h-5 w-5 text-cyan-200" />
            <h2 className="mt-4 text-2xl font-bold text-slate-100">Shared Servers</h2>
            <p className="mt-3 text-slate-300/75">
              Bring teams and communities together with server channels and direct messages in one flow.
            </p>
          </article>
          <article className="safas-panel p-6">
            <Radio className="h-5 w-5 text-cyan-200" />
            <h2 className="mt-4 text-2xl font-bold text-slate-100">Instant Updates</h2>
            <p className="mt-3 text-slate-300/75">
              Realtime fanout over websockets keeps conversations responsive even as traffic scales.
            </p>
          </article>
          <article className="safas-panel p-6">
            <ShieldCheck className="h-5 w-5 text-cyan-200" />
            <h2 className="mt-4 text-2xl font-bold text-slate-100">Roles & Control</h2>
            <p className="mt-3 text-slate-300/75">
              Permission-aware channels, invite flows, and profile settings support both casual and ops-heavy usage.
            </p>
          </article>
        </section>

        <section className="mt-8 safas-panel p-6 md:p-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="safas-label">Start Here</p>
              <h2 className="mt-3 text-balance text-3xl font-extrabold text-slate-100 md:text-4xl">
                Ready to launch your Safascord space?
              </h2>
              <p className="mt-3 max-w-2xl text-slate-300/76">
                Jump into your DM hub, discover communities, or sign in and customize your profile.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link to="/channels/@me">
                <Button className="rounded-xl px-6">Go to inbox</Button>
              </Link>
              <Link to="/discover">
                <Button variant="outline" className="rounded-xl px-6">
                  <Compass className="mr-2 h-4 w-4" />
                  Discover servers
                </Button>
              </Link>
              <Link to="/auth">
                <Button variant="ghost" className="rounded-xl px-6 text-cyan-100 hover:bg-cyan-400/12">
                  <Sparkles className="mr-2 h-4 w-4" />
                  Sign in
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
