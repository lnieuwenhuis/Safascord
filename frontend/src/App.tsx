import { MemoryRouter, Routes, Route, Navigate, useLocation } from "react-router-dom"
import { useEffect } from "react"
import { AuthProvider } from "./components/AuthProvider"
import Home from "./pages/Home"
import Auth from "./pages/Auth"
import DMs from "./pages/DMs"
import DMChannel from "./pages/DMChannel"
import GuildChannel from "./pages/GuildChannel"
import Discover from "./pages/Discover"
import Settings from "./pages/Settings"
import Profile from "./pages/Profile"
import Onboarding from "./pages/Onboarding"
import NotFound from "./pages/NotFound"
import ProtectedRoute from "./components/routes/ProtectedRoute"

function RoutePersister() {
  const location = useLocation()
  useEffect(() => {
    // Don't save 404 or auth pages as the "last route" to return to
    if (location.pathname !== "/404" && location.pathname !== "/auth" && location.pathname !== "/") {
      localStorage.setItem("last_route", location.pathname + location.search + location.hash)
    }
  }, [location])
  return null
}

function URLHider() {
  const location = useLocation()
  
  useEffect(() => {
    const publicPaths = ["/", "/auth"]
    const isPublic = publicPaths.includes(location.pathname) || location.pathname === "/404"
    
    if (!isPublic) {
      if (window.location.pathname !== "/safascord") {
        window.history.replaceState(null, "", "/safascord")
      }
    } else {
      // If we are on a public page, show the real URL (e.g. /, /auth)
      // This prevents the user from being confused when they are on the home page but see /safascord
      if (window.location.pathname !== location.pathname) {
        window.history.replaceState(null, "", location.pathname)
      }
    }
  }, [location])
  return null
}

export default function App() {
  const currentPath = window.location.pathname + window.location.search + window.location.hash
  const storedPath = localStorage.getItem("last_route")
  
  // Clean up stored path if it's invalid
  const validStoredPath = (storedPath && storedPath !== "/404") ? storedPath : "/"
  
  // Use current path if it's a deep link (not / or /safascord), otherwise restore last session
  const initialPath = (currentPath === "/safascord") ? validStoredPath : currentPath

  return (
    <AuthProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <URLHider />
        <RoutePersister />
        <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/auth" element={<Auth />} />
        <Route path="/channels/@me" element={<ProtectedRoute><DMs /></ProtectedRoute>} />
        <Route path="/channels/@me/:dmId" element={<ProtectedRoute><DMChannel /></ProtectedRoute>} />
        <Route path="/server" element={<ProtectedRoute><GuildChannel /></ProtectedRoute>} />
        <Route path="/server/:guildId" element={<ProtectedRoute><GuildChannel /></ProtectedRoute>} />
        <Route path="/server/:guildId/channel/:channelId" element={<ProtectedRoute><GuildChannel /></ProtectedRoute>} />
        <Route path="/discover" element={<Discover />} />
        <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
        <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
        <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
        <Route path="/404" element={<NotFound />} />
        <Route path="*" element={<Navigate to="/404" replace />} />
      </Routes>
      </MemoryRouter>
    </AuthProvider>
  )
}
