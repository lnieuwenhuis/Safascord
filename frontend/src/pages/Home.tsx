import { Button } from "@/components/ui/button"
import { Link } from "react-router-dom"

function GoogleIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      className="h-5 w-5"
    >
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.84 1.153 7.951 3.049l5.657-5.657C34.046 6.053 29.268 4 24 4 12.954 4 4 12.954 4 24s8.954 20 20 20c11.046 0 20-8.954 20-20 0-1.341-.138-2.651-.389-3.917z"/>
      <path fill="#FF3D00" d="M6.306 14.691l6.571 4.816C14.307 16.126 18.79 14 24 14c3.059 0 5.84 1.153 7.951 3.049l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.627 8.337 6.306 14.691z"/>
      <path fill="#4CAF50" d="M24 44c5.179 0 9.899-1.977 13.448-5.196l-6.207-5.26C29.204 35.866 26.715 36.8 24 36.8c-5.187 0-9.6-3.317-11.26-7.955l-6.534 5.036C9.488 39.559 16.209 44 24 44z"/>
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.238-2.231 4.164-4.06 5.594l6.207 5.26C39.546 40.758 44 34.667 44 24c0-1.341-.138-2.651-.389-3.917z"/>
    </svg>
  )
}

export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold">
              D
            </div>
            <span className="text-lg font-bold tracking-tight">Discord Clone</span>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/auth">
              <Button variant="ghost" size="sm">
                Sign In
              </Button>
            </Link>
            <Link to="/channels/@me">
              <Button size="sm">
                Open App
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="relative overflow-hidden py-24 md:py-32">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/20 via-background to-background" />
          <div className="mx-auto flex max-w-5xl flex-col items-center gap-6 px-6 text-center">
            <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl md:text-6xl lg:text-7xl">
              Imagine a place...
            </h1>
            <p className="max-w-2xl text-lg text-muted-foreground sm:text-xl">
              ...where you can belong to a school club, a gaming group, or a worldwide art community. 
              Where just you and a handful of friends can spend time together. 
              A place that makes it easy to talk every day and hang out more often.
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-4">
              <Link to="/channels/@me">
                <Button size="lg" className="h-12 rounded-full px-8 text-base">
                  Open Discord Clone
                </Button>
              </Link>
              <Link to="/auth">
                <Button size="lg" variant="secondary" className="h-12 rounded-full px-8 text-base">
                  <GoogleIcon />
                  <span className="ml-2">Continue with Google</span>
                </Button>
              </Link>
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-6 py-20 md:grid-cols-3">
          <div className="group relative overflow-hidden rounded-2xl border border-border bg-card p-8 transition-all hover:shadow-lg">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="7" height="18" x="3" y="3" rx="1"/><rect width="7" height="18" x="14" y="3" rx="1"/></svg>
            </div>
            <h3 className="mb-2 text-xl font-semibold">Servers & Channels</h3>
            <p className="text-muted-foreground">
              Organize your conversations by topic. Create servers for your communities and channels for specific discussions.
            </p>
          </div>
          <div className="group relative overflow-hidden rounded-2xl border border-border bg-card p-8 transition-all hover:shadow-lg">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </div>
            <h3 className="mb-2 text-xl font-semibold">Direct Messages</h3>
            <p className="text-muted-foreground">
              Chat one-on-one with friends or create group chats for private conversations away from servers.
            </p>
          </div>
          <div className="group relative overflow-hidden rounded-2xl border border-border bg-card p-8 transition-all hover:shadow-lg">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><line x1="21.17" x2="12" y1="8" y2="8"/><line x1="3.95" x2="8.54" y1="6.06" y2="14"/><line x1="10.88" x2="15.46" y1="21.94" y2="14"/></svg>
            </div>
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-xl font-semibold">Discover</h3>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">New</span>
            </div>
            <p className="text-muted-foreground">
              Find new communities to join. Explore public servers based on your interests and hobbies.
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-muted/30 py-12">
        <div className="mx-auto max-w-7xl px-6 text-center text-sm text-muted-foreground">
          <p>&copy; {new Date().getFullYear()} Discord Clone. Built with React & Tailwind.</p>
        </div>
      </footer>
    </div>
  )
}

