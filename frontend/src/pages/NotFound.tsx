import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Link } from "react-router-dom"

export default function NotFound() {
  return (
    <div className="safas-page grid min-h-dvh place-items-center px-6 py-10">
      <div className="safas-panel w-full max-w-lg p-9 text-center">
        <p className="text-8xl font-black leading-none text-cyan-300/20">404</p>
        <h1 className="mt-4 text-3xl font-extrabold text-slate-100">Page not found</h1>
        <p className="mt-3 text-slate-300/75">The route you requested does not exist in this deployment.</p>
        <Link to="/" className="mt-7 inline-flex">
          <Button>
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back home
          </Button>
        </Link>
      </div>
    </div>
  )
}
