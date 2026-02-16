import { ArrowRight, Rocket, Shield, Zap } from "lucide-react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"

export default function Home() {
  return (
    <div className="safas-page flex min-h-dvh flex-col">
      <header className="sticky top-0 z-50 border-b border-cyan-300/15 bg-slate-950/78 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 md:px-8">
          <div className="text-3xl font-extrabold tracking-tight text-slate-100">safascord</div>
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

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-16 pt-10 md:px-8 md:pt-14">
        <section className="grid gap-6 lg:grid-cols-[1.12fr_0.88fr]">
          <div className="safas-panel p-7 md:p-10">
            <p className="safas-label mb-4">Realtime Community Platform</p>
            <h1 className="max-w-xl text-balance text-4xl font-extrabold leading-tight text-slate-100 sm:text-5xl">
              Build fast. Keep chat stable.
            </h1>
            <p className="mt-5 max-w-2xl text-lg text-slate-300/78">
              Safascord is a modern Discord-style workspace with cleaner UI primitives, stable realtime delivery, and Railway-ready infrastructure.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link to="/channels/@me">
                <Button size="lg" className="rounded-xl px-6">Launch workspace</Button>
              </Link>
              <Link to="/auth">
                <Button size="lg" variant="outline" className="rounded-xl px-6">
                  Continue with Shoo
                </Button>
              </Link>
            </div>
            <p className="mt-5 text-sm font-semibold text-cyan-300/85">
              Low-noise design with production-focused defaults.
            </p>
          </div>

          <div className="safas-panel p-7 md:p-10">
            <p className="safas-label mb-4">Quick Intro</p>
            <h2 className="text-3xl font-bold text-slate-100">Operations-first chat stack</h2>
            <p className="mt-4 text-slate-300/78">
              Role-aware permissions, websocket fanout, invite flow, profile customization, and a cleaner message surface for day-to-day collaboration.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-cyan-300/20 bg-slate-950/55 p-3">
                <Zap className="mb-2 h-4 w-4 text-cyan-200" />
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300/80">Fast</p>
              </div>
              <div className="rounded-xl border border-cyan-300/20 bg-slate-950/55 p-3">
                <Shield className="mb-2 h-4 w-4 text-cyan-200" />
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300/80">Reliable</p>
              </div>
              <div className="rounded-xl border border-cyan-300/20 bg-slate-950/55 p-3">
                <Rocket className="mb-2 h-4 w-4 text-cyan-200" />
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300/80">Deployable</p>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-9 grid gap-4 md:grid-cols-2">
          <article className="safas-panel p-6">
            <p className="safas-label mb-3">Core Capabilities</p>
            <h3 className="text-2xl font-bold text-slate-100">Servers, channels and DMs</h3>
            <p className="mt-3 text-slate-300/75">
              Multiple workspace modes with role-aware visibility, channel creation, and integrated invite links.
            </p>
            <Link to="/discover" className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-cyan-200 hover:text-cyan-100">
              Explore community templates
              <ArrowRight className="h-4 w-4" />
            </Link>
          </article>

          <article className="safas-panel p-6">
            <p className="safas-label mb-3">Deployment</p>
            <h3 className="text-2xl font-bold text-slate-100">Railway-first setup</h3>
            <p className="mt-3 text-slate-300/75">
              Frontend, backend, realtime, Redis, Postgres, and S3-compatible uploads can be deployed and scaled independently.
            </p>
            <Link to="/auth" className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-cyan-200 hover:text-cyan-100">
              Sign in to manage your workspace
              <ArrowRight className="h-4 w-4" />
            </Link>
          </article>
        </section>
      </main>
    </div>
  )
}
