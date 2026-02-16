import { Button } from "@/components/ui/button"
import { Link } from "react-router-dom"

function ShooIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      className="h-5 w-5"
    >
      <path fill="currentColor" d="M20.7 6.15a1 1 0 0 0 0-1.41 12.13 12.13 0 0 0-17.17 0 1 1 0 0 0 1.42 1.4 10.13 10.13 0 0 1 14.33 0 1 1 0 0 0 1.42.01Zm-2.84 2.84a1 1 0 0 0 0-1.41 8.12 8.12 0 0 0-11.48 0 1 1 0 0 0 1.41 1.42 6.12 6.12 0 0 1 8.66 0 1 1 0 0 0 1.41-.01Zm-2.83 2.83a1 1 0 0 0 0-1.41 4.12 4.12 0 0 0-5.83 0 1 1 0 1 0 1.42 1.41 2.12 2.12 0 0 1 3 0 1 1 0 0 0 1.41 0Zm-2.07 4.88a1.46 1.46 0 1 0-2.92 0 1.46 1.46 0 0 0 2.92 0Z"/>
    </svg>
  )
}

export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col text-base-content">
      <header className="sticky top-0 z-50 border-b border-base-300/70 bg-base-100/70 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 md:px-8">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-2xl bg-primary text-primary-content shadow-sm">
              C
            </div>
            <div className="leading-tight">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary/70">Safascord</p>
              <p className="text-xs text-base-content/55">Realtime chat for your communities</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/auth">
              <Button variant="ghost" size="sm">Sign In</Button>
            </Link>
            <Link to="/channels/@me">
              <Button size="sm">Open App</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-5 pb-20 pt-12 md:px-8">
        <section className="card border border-base-300/70 bg-base-100/85 shadow-xl">
          <div className="card-body gap-8 p-7 md:p-12">
            <div className="badge badge-outline badge-primary w-fit px-4 py-3 text-[11px] tracking-[0.2em]">
              MODERN MINIMAL EXPERIENCE
            </div>
            <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
              <div className="space-y-5">
                <h1 className="text-balance text-4xl font-extrabold tracking-tight sm:text-5xl md:text-6xl">
                  One workspace for servers, DMs and live events.
                </h1>
                <p className="max-w-2xl text-lg text-base-content/65">
                  Safascord keeps communication focused: fast channels, cleaner message threads, and a calmer interface that does not distract from the conversation.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <Link to="/channels/@me">
                    <Button size="lg" className="rounded-2xl px-7">Launch Safascord</Button>
                  </Link>
                  <Link to="/auth">
                    <Button size="lg" variant="secondary" className="rounded-2xl px-6">
                      <ShooIcon />
                      Continue with Shoo
                    </Button>
                  </Link>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-base-300 bg-base-100/90 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-base-content/55">Core</p>
                  <p className="mt-2 text-xl font-semibold">Servers + DMs</p>
                  <p className="mt-1 text-sm text-base-content/65">Context stays organized by channel and role.</p>
                </div>
                <div className="rounded-2xl border border-base-300 bg-base-100/90 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-base-content/55">Infra</p>
                  <p className="mt-2 text-xl font-semibold">Realtime Ready</p>
                  <p className="mt-1 text-sm text-base-content/65">Redis-backed websocket fanout and low-latency updates.</p>
                </div>
                <div className="rounded-2xl border border-base-300 bg-base-100/90 p-4 sm:col-span-2">
                  <p className="text-xs uppercase tracking-[0.2em] text-base-content/55">Deploy</p>
                  <p className="mt-2 text-xl font-semibold">Railway-first services</p>
                  <p className="mt-1 text-sm text-base-content/65">Frontend, API, realtime, managed DB/Redis, and S3-compatible uploads.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-10 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-base-300 bg-base-100/70 p-5">
            <p className="text-sm font-semibold">Channels that stay readable</p>
            <p className="mt-2 text-sm text-base-content/65">Grouped messages, mention highlights, attachments, and quick moderation actions.</p>
          </div>
          <div className="rounded-2xl border border-base-300 bg-base-100/70 p-5">
            <p className="text-sm font-semibold">Fast onboarding to teams</p>
            <p className="mt-2 text-sm text-base-content/65">Invite links, role-aware access, and direct messaging built-in from day one.</p>
          </div>
          <div className="rounded-2xl border border-base-300 bg-base-100/70 p-5">
            <p className="text-sm font-semibold">Built to extend</p>
            <p className="mt-2 text-sm text-base-content/65">Typed API boundaries and isolated services make shipping features safer.</p>
          </div>
        </section>
      </main>

      <footer className="border-t border-base-300/70 bg-base-100/70 py-6">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 text-sm text-base-content/55 md:px-8">
          <p>&copy; {new Date().getFullYear()} Safascord</p>
          <p>Tailwind + daisyUI</p>
        </div>
      </footer>
    </div>
  )
}
