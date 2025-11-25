import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Search } from "lucide-react"
import { Link } from "react-router-dom"

const servers = Array.from({ length: 12 }).map((_, i) => ({ 
  id: i, 
  name: `Community ${i + 1}`,
  description: "A great place to hang out and chat with friends about various topics.",
  members: 1000 + i * 123
}))

export default function Discover() {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <Link to="/" className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold">
                D
              </div>
              <span className="text-lg font-bold tracking-tight">Discord Clone</span>
            </Link>
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
        <section className="relative overflow-hidden py-16 md:py-24">
           <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary/10 via-background to-background" />
           <div className="mx-auto max-w-4xl px-6 text-center">
             <h1 className="mb-6 text-3xl font-extrabold tracking-tight sm:text-4xl md:text-5xl">
               Find your community
             </h1>
             <p className="mb-8 text-lg text-muted-foreground">
               From gaming, to music, to learning, there's a place for you.
             </p>
             <div className="relative mx-auto max-w-xl">
               <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
               <Input 
                 className="h-12 border-border/50 bg-background/50 pl-10 backdrop-blur-sm focus-visible:ring-primary" 
                 placeholder="Explore communities..." 
               />
             </div>
           </div>
        </section>

        <section className="mx-auto max-w-7xl px-6 pb-20">
          <h2 className="mb-6 text-xl font-semibold">Featured Communities</h2>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {servers.map(s => (
              <div key={s.id} className="group overflow-hidden rounded-lg border border-border bg-card transition-all hover:-translate-y-1 hover:shadow-lg">
                <div className="h-24 bg-gradient-to-br from-primary/20 to-primary/5" />
                <div className="relative p-4 pt-0">
                  <div className="absolute -top-6 left-4 h-12 w-12 rounded-xl border-4 border-card bg-primary text-primary-foreground flex items-center justify-center font-bold text-lg shadow-sm">
                    {s.name[0]}
                  </div>
                  <div className="mt-8">
                    <h3 className="font-semibold truncate">{s.name}</h3>
                    <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                      {s.description}
                    </p>
                    <div className="mt-4 flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{s.members.toLocaleString()} Members</span>
                      <Button variant="secondary" size="sm" className="h-7 text-xs">
                        Join
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}
