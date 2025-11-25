import { Button } from "@/components/ui/button"
import { LogIn } from "lucide-react"
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
    <div className="min-h-dvh bg-gradient-to-b from-[#0a0f1a] to-[#0b1b2e]">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <header className="mb-12 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-md bg-blue-600" />
            <span className="text-lg font-semibold">Discord Clone</span>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/auth">
              <Button variant="outline" className="border-white/10">
                <LogIn className="mr-2 h-4 w-4" />
                Sign In
              </Button>
            </Link>
          </div>
        </header>
        <main className="grid gap-8">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-4xl font-bold tracking-tight md:text-6xl">
              Hang out and chat with friends
            </h1>
            <p className="mt-4 text-balance text-muted-foreground">
              A modern, dark-first reimagining of Discord. Servers, channels,
              DMs, and more—built with React, Tailwind, and Shadcn UI.
            </p>
            <div className="mt-8 flex items-center justify-center gap-4">
              <Link to="/channels/@me">
                <Button variant="brand" size="lg">
                  Enter App
                </Button>
              </Link>
              <Link to="/auth">
                <Button
                  size="lg"
                  className="bg-white text-black hover:bg-white/90"
                >
                  <GoogleIcon />
                  <span className="ml-2">Continue with Google</span>
                </Button>
              </Link>
            </div>
          </div>
          <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 md:grid-cols-3">
            <div className="rounded-lg border border-white/10 bg-card p-6">
              <div className="mb-2 h-10 w-10 rounded-md bg-blue-600/80" />
              <h3 className="text-lg font-semibold">Servers & Channels</h3>
              <p className="text-sm text-muted-foreground">
                Organize conversations by server and channel with a clean
                sidebar layout.
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-card p-6">
              <div className="mb-2 h-10 w-10 rounded-md bg-blue-500/80" />
              <h3 className="text-lg font-semibold">Direct Messages</h3>
              <p className="text-sm text-muted-foreground">
                Chat one-on-one with friends and start group DMs seamlessly.
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-card p-6">
              <div className="mb-2 h-10 w-10 rounded-md bg-blue-400/80" />
              <h3 className="text-lg font-semibold">Discover & Explore</h3>
              <p className="text-sm text-muted-foreground">
                Find new communities and servers tailored to your interests.
              </p>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

