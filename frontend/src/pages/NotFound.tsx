import { Link } from "react-router-dom"

export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center px-6">
      <div className="text-center">
        <h2 className="text-3xl font-bold">Page not found</h2>
        <p className="mt-2 text-muted-foreground">The page you requested does not exist.</p>
        <Link to="/" className="mt-6 inline-block text-primary underline-offset-4 hover:underline">Go home</Link>
      </div>
    </div>
  )
}

