import { useEffect, useState, type ReactNode } from "react"
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, LineChart, Line
} from "recharts"
import { Activity, Users, Server, MessageSquare, Clock, Cpu, Database, HardDrive, Zap } from "lucide-react"
import { api } from "../../lib/api"
import { useAuth } from "../../hooks/useAuth"
import type { StatsActivityResponse, StatsSummaryResponse, StatsSystemResponse } from "@/types"
import type { StatsActivityMessagePerHour, StatsActivityUsersPerDay, StatsMetrics } from "../../types/responses"

export function StatsPage() {
  const { token } = useAuth()
  const [error, setError] = useState("")

  const [summary, setSummary] = useState<StatsSummaryResponse>()
  const [activity, setActivity] = useState<StatsActivityResponse>()
  const [system, setSystem] = useState<StatsSystemResponse>()
  const [metrics, setMetrics] = useState<{ time: string; cpu: string; memory: string; disk: string; latency: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [interval, setIntervalRange] = useState("10m") // Default interval

  useEffect(() => {
    if (!token) {
      setError("Authentication required.")
      setLoading(false)
      return
    }

    const fetchStats = async () => {
      try {
        const [s, a, sys, m] = await Promise.all([
          api.getStatsSummary(token),
          api.getStatsActivity(token),
          api.getStatsSystem(token),
          api.getStatsMetrics(token, interval)
        ])
        setSummary(s)
        setActivity(a)
        setSystem(sys)
        setMetrics(m.metrics || [])
        setError("")
      } catch (e) {
        console.error(e)
        setError(e instanceof Error ? e.message : "Failed to load stats")
      } finally {
        setLoading(false)
      }
    }
    fetchStats()
    const timer = setInterval(fetchStats, 10000) // Refresh every 10s
    return () => clearInterval(timer)
  }, [interval, token])

  if (error && !loading && !summary) {
    return (
      <div className="flex items-center justify-center h-screen bg-background text-foreground">
        <div className="bg-card p-8 rounded-lg shadow-lg w-96 border border-border text-center">
          <h1 className="text-2xl font-bold mb-4">Admin Access Required</h1>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-background text-foreground">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  // Format data for charts
  const messageData = activity?.messagesPerHour?.map((item: StatsActivityMessagePerHour) => ({
    time: new Date(item.hour).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    count: parseInt(item.count)
  })) || []

  const userData = activity?.usersPerDay?.map((item: StatsActivityUsersPerDay) => ({
    date: new Date(item.day).toLocaleDateString(),
    count: parseInt(item.count)
  })) || []

  const formattedMetrics = metrics.map((m: StatsMetrics) => ({
    ...m,
    time: new Date(m.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    cpu: parseFloat(m.cpu),
    memory: parseFloat(m.memory),
    disk: parseFloat(m.disk),
    latency: parseFloat(m.latency)
  }))

  return (
    <div className="flex-1 bg-background overflow-y-auto p-8 text-foreground">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Activity className="w-6 h-6 text-primary" />
          System Vital Statistics
        </h1>
        <div className="flex bg-muted rounded p-1">
          {["10s", "1m", "10m", "1h", "12h", "1d", "3d", "7d"].map((v) => (
            <button
              key={v}
              onClick={() => setIntervalRange(v)}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${interval === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard icon={<Users className="w-5 h-5 text-blue-400" />} label="Total Users" value={summary?.users ?? 0} />
        <StatCard icon={<Server className="w-5 h-5 text-purple-400" />} label="Total Servers" value={summary?.servers ?? 0} />
        <StatCard icon={<MessageSquare className="w-5 h-5 text-yellow-400" />} label="Total Messages" value={summary?.messages ?? 0} />
        <StatCard icon={<Clock className="w-5 h-5 text-red-400" />} label="Uptime" value={system?.uptime ? `${Math.floor(system.uptime / 3600)}h ${Math.floor((system.uptime % 3600) / 60)}m` : "0h 0m"} />
      </div>

      {/* Detailed Metrics Graphs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* CPU Usage */}
        <div className="bg-card p-6 rounded-lg border border-border">
          <h3 className="text-card-foreground font-semibold mb-4 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-blue-400" /> CPU Usage (Load Avg)
          </h3>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={formattedMetrics}>
                <defs>
                  <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.8}/>
                    <stop offset="95%" stopColor="var(--primary)" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="time" stroke="var(--muted-foreground)" fontSize={10} tickFormatter={(v) => v} interval="preserveStartEnd" />
                <YAxis stroke="var(--muted-foreground)" fontSize={10} />
                <Tooltip contentStyle={{ backgroundColor: 'var(--popover)', borderColor: 'var(--border)', color: 'var(--popover-foreground)' }} itemStyle={{ color: 'var(--popover-foreground)' }} />
                <Area type="monotone" dataKey="cpu" stroke="var(--primary)" fillOpacity={1} fill="url(#colorCpu)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Memory Usage */}
        <div className="bg-card p-6 rounded-lg border border-border">
          <h3 className="text-card-foreground font-semibold mb-4 flex items-center gap-2">
            <Database className="w-4 h-4 text-purple-400" /> Memory Usage (MB)
          </h3>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={formattedMetrics}>
                <defs>
                  <linearGradient id="colorMem" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#a855f7" stopOpacity={0.8}/>
                    <stop offset="95%" stopColor="#a855f7" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="time" stroke="var(--muted-foreground)" fontSize={10} />
                <YAxis stroke="var(--muted-foreground)" fontSize={10} />
                <Tooltip contentStyle={{ backgroundColor: 'var(--popover)', borderColor: 'var(--border)', color: 'var(--popover-foreground)' }} itemStyle={{ color: 'var(--popover-foreground)' }} />
                <Area type="monotone" dataKey="memory" stroke="#a855f7" fillOpacity={1} fill="url(#colorMem)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Disk Usage */}
        <div className="bg-card p-6 rounded-lg border border-border">
          <h3 className="text-card-foreground font-semibold mb-4 flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-yellow-400" /> Disk Usage (GB)
          </h3>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={formattedMetrics}>
                <defs>
                  <linearGradient id="colorDisk" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#eab308" stopOpacity={0.8}/>
                    <stop offset="95%" stopColor="#eab308" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="time" stroke="var(--muted-foreground)" fontSize={10} />
                <YAxis stroke="var(--muted-foreground)" fontSize={10} />
                <Tooltip contentStyle={{ backgroundColor: 'var(--popover)', borderColor: 'var(--border)', color: 'var(--popover-foreground)' }} itemStyle={{ color: 'var(--popover-foreground)' }} />
                <Area type="monotone" dataKey="disk" stroke="#eab308" fillOpacity={1} fill="url(#colorDisk)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Latency */}
        <div className="bg-card p-6 rounded-lg border border-border">
          <h3 className="text-card-foreground font-semibold mb-4 flex items-center gap-2">
            <Zap className="w-4 h-4 text-red-400" /> Latency (ms)
          </h3>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={formattedMetrics}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="time" stroke="var(--muted-foreground)" fontSize={10} />
                <YAxis stroke="var(--muted-foreground)" fontSize={10} />
                <Tooltip contentStyle={{ backgroundColor: 'var(--popover)', borderColor: 'var(--border)', color: 'var(--popover-foreground)' }} itemStyle={{ color: 'var(--popover-foreground)' }} />
                <Line type="monotone" dataKey="latency" stroke="#ef4444" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Business Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="bg-card p-6 rounded-lg border border-border">
          <h3 className="text-card-foreground font-semibold mb-4">Message Activity (Last 24h)</h3>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={messageData}>
                <defs>
                  <linearGradient id="colorMsg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8884d8" stopOpacity={0.8}/>
                    <stop offset="95%" stopColor="#8884d8" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="time" stroke="var(--muted-foreground)" fontSize={10} />
                <YAxis stroke="var(--muted-foreground)" fontSize={10} />
                <Tooltip contentStyle={{ backgroundColor: 'var(--popover)', borderColor: 'var(--border)', color: 'var(--popover-foreground)' }} itemStyle={{ color: 'var(--popover-foreground)' }} />
                <Area type="monotone" dataKey="count" stroke="#8884d8" fillOpacity={1} fill="url(#colorMsg)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-card p-6 rounded-lg border border-border">
          <h3 className="text-card-foreground font-semibold mb-4">New Users (Last 7 Days)</h3>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={userData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" stroke="var(--muted-foreground)" fontSize={10} />
                <YAxis stroke="var(--muted-foreground)" fontSize={10} />
                <Tooltip contentStyle={{ backgroundColor: 'var(--popover)', borderColor: 'var(--border)', color: 'var(--popover-foreground)' }} itemStyle={{ color: 'var(--popover-foreground)' }} cursor={{ fill: 'var(--muted)' }} />
                <Bar dataKey="count" fill="#82ca9d" name="New Users" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({ icon, label, value }: { icon: ReactNode, label: string, value: number | string }) {
  return (
    <div className="bg-card p-6 rounded-lg flex items-center gap-4 border border-border">
      <div className="p-3 bg-muted rounded-full">
        {icon}
      </div>
      <div>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold text-card-foreground">{value?.toLocaleString()}</p>
      </div>
    </div>
  )
}
