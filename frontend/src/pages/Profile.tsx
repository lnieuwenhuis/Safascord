import { Button } from "@/components/ui/button"
import { Link } from "react-router-dom"

export default function Profile() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background text-foreground">
      <div className="max-w-md text-center">
        <h2 className="text-3xl font-bold">Profile</h2>
        <p className="mt-2 text-muted-foreground">
          View your profile in the app by clicking on your avatar.
        </p>
        <div className="mt-6">
          <Link to="/channels/@me">
            <Button>Go back to App</Button>
          </Link>
        </div>
      </div>
    </div>
  )
}

