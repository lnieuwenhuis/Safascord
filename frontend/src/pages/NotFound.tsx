import { Button } from "@/components/ui/button"
import { Link } from "react-router-dom"

export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center bg-background px-6 text-foreground">
      <div className="text-center">
        <h1 className="text-9xl font-black text-primary/20">404</h1>
        <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">Page not found</h2>
        <p className="mt-4 text-muted-foreground">Sorry, we couldn't find the page you're looking for.</p>
        <div className="mt-8">
          <Link to="/">
            <Button size="lg">Go back home</Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
