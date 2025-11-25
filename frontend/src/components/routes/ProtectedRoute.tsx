import { Navigate, useLocation } from "react-router-dom"
import { useAuth } from "@/hooks/useAuth"

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth()
  const location = useLocation()
  
  if (isLoading) {
    // A simple loading spinner or splash screen could go here
    return (
      <div className="flex h-dvh w-full items-center justify-center bg-[#09090b] text-white">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-white/20 border-t-white"></div>
      </div>
    )
  }
  
  if (!isAuthenticated) return <Navigate to="/auth" state={{ from: location }} replace />
  return <>{children}</>
}
