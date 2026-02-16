import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom"
import { useEffect } from "react"
import { AuthProvider } from "./components/AuthProvider"
import { NotificationProvider } from "./components/NotificationProvider"
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
import StagingGuard from "./components/routes/StagingGuard"
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
          const opacity = user.customBackgroundOpacity ?? 0.85
          document.documentElement.style.setProperty('--background', `rgba(14, 17, 22, ${opacity})`)
          document.documentElement.style.setProperty('--card', `rgba(30, 31, 34, ${opacity})`)
          document.documentElement.style.setProperty('--sidebar', `rgba(43, 45, 49, ${opacity})`)
          document.documentElement.style.setProperty('--popover', `rgba(30, 31, 34, ${Math.min(1, opacity + 0.1)})`)
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
  }, [user?.customBackgroundUrl, user?.customBackgroundOpacity])
  
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

export default function App() {
  return (
    <AuthProvider>
      <NotificationProvider>
        <StagingGuard>
          <BrowserRouter>
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
          </BrowserRouter>
        </StagingGuard>
      </NotificationProvider>
    </AuthProvider>
  )
}
