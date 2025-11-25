import { Button } from "@/components/ui/button"
import { Link, useLocation, useNavigate } from "react-router-dom"

function GoogleIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className="h-5 w-5">
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.84 1.153 7.951 3.049l5.657-5.657C34.046 6.053 29.268 4 24 4 12.954 4 4 12.954 4 24s8.954 20 20 20c11.046 0 20-8.954 20-20 0-1.341-.138-2.651-.389-3.917z"/>
      <path fill="#FF3D00" d="M6.306 14.691l6.571 4.816C14.307 16.126 18.79 14 24 14c3.059 0 5.84 1.153 7.951 3.049l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.627 8.337 6.306 14.691z"/>
      <path fill="#4CAF50" d="M24 44c5.179 0 9.899-1.977 13.448-5.196l-6.207-5.26C29.204 35.866 26.715 36.8 24 36.8c-5.187 0-9.6-3.317-11.26-7.955l-6.534 5.036C9.488 39.559 16.209 44 24 44z"/>
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.238-2.231 4.164-4.06 5.594l6.207 5.26C39.546 40.758 44 34.667 44 24c0-1.341-.138-2.651-.389-3.917z"/>
    </svg>
  )
}

export default function Auth() {
  const navigate = useNavigate()
  const location = useLocation() as { state?: { from?: Location } }
  const from = location.state?.from?.pathname || "/channels/@me"
  const handleGoogle = () => {
    localStorage.setItem("auth", "1")
    navigate(from, { replace: true })
  }
  return (
    <div className="min-h-dvh bg-gradient-to-b from-[#0a0f1a] to-[#0b1b2e]">
      <div className="mx-auto max-w-md px-6 py-24">
        <h1 className="text-center text-3xl font-bold">Sign in</h1>
        <p className="mt-2 text-center text-muted-foreground">
          Choose your preferred provider
        </p>
        <div className="mt-8 grid gap-4">
          <Button className="bg-white text-black hover:bg-white/90" onClick={handleGoogle}>
            <GoogleIcon />
            <span className="ml-2">Continue with Google</span>
          </Button>
          <Link to="/">
            <Button variant="outline">Back to Home</Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
