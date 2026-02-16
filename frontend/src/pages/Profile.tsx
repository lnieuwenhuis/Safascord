import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Link } from "react-router-dom"

export default function Profile() {
  return (
    <div className="safas-page flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="safas-panel w-full max-w-xl p-8 text-center">
        <p className="safas-label mb-3">Profile</p>
        <h1 className="text-3xl font-extrabold text-slate-100">Profile management is in your sidebar card</h1>
        <p className="mt-4 text-slate-300/75">
          Click your avatar in the workspace footer to open your profile preview and edit settings.
        </p>
        <Link to="/channels/@me" className="mt-7 inline-flex">
          <Button>
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back to app
          </Button>
        </Link>
      </div>
    </div>
  )
}
