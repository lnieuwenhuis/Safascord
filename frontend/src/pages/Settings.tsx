import { Button } from "@/components/ui/button"
import { Link } from "react-router-dom"

export default function Settings() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background text-foreground">
      <div className="max-w-md text-center">
        <h2 className="text-3xl font-bold">Settings</h2>
        <p className="mt-2 text-muted-foreground">
          User settings are available in the app via the user profile menu.
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

