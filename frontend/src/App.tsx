import { MemoryRouter, Routes, Route, Navigate, useLocation } from "react-router-dom"
import { useEffect } from "react"
import { AuthProvider } from "./components/AuthProvider"
import { useAuth } from "./hooks/useAuth"
import { getFullUrl } from "./lib/api"
import Home from "./pages/Home"
import Auth from "./pages/Auth"
import DMs from "./pages/DMs"
import DMChannel from "./pages/DMChannel"
import GuildChannel from "./pages/GuildChannel"
import Discover from "./pages/Discover"
import Settings from "./pages/Settings"
import Profile from "./pages/Profile"
import Onboarding from "./pages/Onboarding"
import Invite from "./pages/Invite"
import NotFound from "./pages/NotFound"
import ProtectedRoute from "./components/routes/ProtectedRoute"
import { StatsPage } from "./components/admin/StatsPage"

function BackgroundManager() {
  const { user } = useAuth()
  
  useEffect(() => {
    if (user?.customBackgroundUrl) {
       const url = getFullUrl(user.customBackgroundUrl)
       if (url) {
          document.body.style.backgroundImage = `url(${url})`
          document.body.style.backgroundSize = 'cover'
          document.body.style.backgroundPosition = 'center'
          document.body.style.backgroundAttachment = 'fixed'
          
          // Make backgrounds transparent
          document.documentElement.style.setProperty('--background', 'rgba(14, 17, 22, 0.85)')
          document.documentElement.style.setProperty('--card', 'rgba(30, 31, 34, 0.85)')
          document.documentElement.style.setProperty('--sidebar', 'rgba(43, 45, 49, 0.85)')
          document.documentElement.style.setProperty('--popover', 'rgba(30, 31, 34, 0.95)')
       }
    } else {
       document.body.style.backgroundImage = ''
       document.body.style.backgroundSize = ''
       document.body.style.backgroundPosition = ''
       document.body.style.backgroundAttachment = ''
       
       // Reset to defaults (using style.removeProperty didn't always revert to CSS vars properly if they were overwritten)
       // Ideally, we should remove the inline styles so the CSS class takes over.
       document.documentElement.style.removeProperty('--background')
       document.documentElement.style.removeProperty('--card')
       document.documentElement.style.removeProperty('--sidebar')
       document.documentElement.style.removeProperty('--popover')
    }
  }, [user?.customBackgroundUrl])
  
  return null
}

function RoutePersister() {
  const location = useLocation()
  useEffect(() => {
    // Don't save 404, auth, or onboarding pages as the "last route" to return to
    if (location.pathname !== "/404" && location.pathname !== "/auth" && location.pathname !== "/" && location.pathname !== "/onboarding") {
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
        <BackgroundManager />
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
        <Route path="/invite/:code" element={<Invite />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route path="/404" element={<NotFound />} />
        <Route path="*" element={<Navigate to="/404" replace />} />
      </Routes>
      </MemoryRouter>
    </AuthProvider>
  )
}
