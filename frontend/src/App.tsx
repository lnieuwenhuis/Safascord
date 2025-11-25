import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { AuthProvider } from "./components/AuthProvider"
import Home from "./pages/Home"
import Auth from "./pages/Auth"
import DMs from "./pages/DMs"
import DMChannel from "./pages/DMChannel"
import GuildChannel from "./pages/GuildChannel"
import Discover from "./pages/Discover"
import Settings from "./pages/Settings"
import Profile from "./pages/Profile"
import NotFound from "./pages/NotFound"
import ProtectedRoute from "./components/routes/ProtectedRoute"

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
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
        <Route path="/404" element={<NotFound />} />
        <Route path="*" element={<Navigate to="/404" replace />} />
      </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
