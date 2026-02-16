import { Navigate, useLocation } from "react-router-dom"
import { useAuth } from "@/hooks/useAuth"

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth()
  const location = useLocation()
  
  if (isLoading) {
    // A simple loading spinner or splash screen could go here
    return (
      <div className="safas-page flex h-dvh w-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-cyan-200/25 border-t-cyan-200" />
      </div>
    )
  }
  
  if (!isAuthenticated) return <Navigate to="/auth" state={{ from: location }} replace />
  return <>{children}</>
}
