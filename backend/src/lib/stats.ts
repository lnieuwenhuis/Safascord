import { pool } from "./db.js"
import os from "os"

export const requestStats = {
  totalRequests: 0,
  totalLatency: 0,
  maxLatency: 0,
  startTime: Date.now(),
  periodRequests: 0,
  periodLatency: 0
}

export function recordRequest(latency: number) {
  requestStats.totalRequests++
  requestStats.totalLatency += latency
  requestStats.periodRequests++
  requestStats.periodLatency += latency
  if (latency > requestStats.maxLatency) requestStats.maxLatency = latency
}

// Start background collector
export function startMetricsCollector() {
  setInterval(async () => {
    try {
      const cpuLoad = os.loadavg()[0]
      const memoryUsed = process.memoryUsage().heapUsed / 1024 / 1024 // MB
      
      // Calculate avg latency for this period
      const avgLatency = requestStats.periodRequests > 0 
        ? requestStats.periodLatency / requestStats.periodRequests 
        : 0
      
      // Reset period stats
      requestStats.periodRequests = 0
      requestStats.periodLatency = 0

      // Disk Usage (Mocked or Simplified for now as Node requires 'fs.statfs' or external lib)
      // We'll use a placeholder or try fs.statfs if available (Node 18.15+)
      // For this environment, we'll assume we can just store 0 if not easily available
      // But let's try to be better.
      let diskUsed = 0
      try {
        // @ts-ignore
        if (import.meta.resolve && typeof  (await import("fs")).statfs === 'function') {
           // @ts-ignore
           const fs = await import("fs")
           // @ts-ignore
           const stats = await fs.promises.statfs('/') 
           // Used = Total - Free
           diskUsed = (stats.blocks - stats.bfree) * stats.bsize / 1024 / 1024 / 1024 // GB
        }
      } catch {}

      await pool.query(
        `INSERT INTO system_metrics (cpu_load, memory_used, disk_used, avg_latency) VALUES ($1, $2, $3, $4)`,
        [cpuLoad, memoryUsed, diskUsed, avgLatency]
      )
    } catch (e) {
      console.error("Failed to collect metrics:", e)
    }
  }, 10000) // Every 10 seconds
}
