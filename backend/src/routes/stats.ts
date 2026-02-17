import { FastifyInstance, FastifyRequest } from "fastify"
import { pool } from "../lib/db.js"
import { requestStats } from "../lib/stats.js"
import os from "os"

export async function statsRoutes(app: FastifyInstance) {
  app.get("/api/stats/summary", async () => {
    try {
      const [userCount, serverCount, messageCount, channelCount] = await Promise.all([
        pool.query("SELECT count(*) FROM users"),
        pool.query("SELECT count(*) FROM servers"),
        pool.query("SELECT count(*) FROM messages"),
        pool.query("SELECT count(*) FROM channels"),
      ])
      
      return {
        users: parseInt(userCount.rows[0].count),
        servers: parseInt(serverCount.rows[0].count),
        messages: parseInt(messageCount.rows[0].count),
        channels: parseInt(channelCount.rows[0].count),
      }
    } catch (e) {
      return { error: String(e) }
    }
  })

  app.get("/api/stats/activity", async () => {
    try {
      // Messages per hour (last 24h)
      const messagesPerHour = await pool.query(`
        SELECT date_trunc('hour', created_at) as hour, count(*) as count 
        FROM messages 
        WHERE created_at > now() - interval '24 hours'
        GROUP BY hour 
        ORDER BY hour ASC
      `)
      
      // New users per day (last 7 days)
      const usersPerDay = await pool.query(`
        SELECT date_trunc('day', created_at) as day, count(*) as count 
        FROM users
        WHERE created_at > now() - interval '7 days' -- Fixed interval syntax
        GROUP BY day 
        ORDER BY day ASC
      `)

      return {
        messagesPerHour: messagesPerHour.rows,
        usersPerDay: usersPerDay.rows
      }
    } catch (e) {
      console.error(e)
      return { error: String(e) }
    }
  })

  app.get("/api/stats/system", async () => {
    const avgLatency = requestStats.totalRequests > 0 
      ? requestStats.totalLatency / requestStats.totalRequests 
      : 0

    return {
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      cpuLoad: os.loadavg(),
      requestStats: {
        ...requestStats,
        avgLatency
      }
    }
  })

  app.get("/api/stats/metrics", async (req: FastifyRequest<{ Querystring: { range?: string } }>) => {
    try {
      const range = req.query.range || "1h"
      let interval = "now() - interval '1 hour'"
      let bucket = "1 minute" // For grouping

      switch(range) {
        case "10s": 
          interval = "now() - interval '5 minutes'" // Show last 5 min
          bucket = "10 seconds"
          break
        case "1m":
           interval = "now() - interval '30 minutes'"
           bucket = "1 minute"
           break
        case "10m":
           interval = "now() - interval '3 hours'"
           bucket = "10 minutes"
           break
        case "1h":
           interval = "now() - interval '24 hours'"
           bucket = "1 hour"
           break
        case "12h":
           interval = "now() - interval '3 days'"
           bucket = "12 hours"
           break
        case "1d":
           interval = "now() - interval '7 days'"
           bucket = "1 day"
           break
        case "3d":
           interval = "now() - interval '14 days'"
           bucket = "1 day"
           break
        case "7d":
           interval = "now() - interval '30 days'"
           bucket = "1 day"
           break
      }

      // Actually, if user requests "10s" intervals, they probably mean "Realtime-ish view"
      // The requirement is: "selectable interval as well, with the intervals being 10s, 1m, 10m, 1h, 12h, 1d, 3d, 7d"
      // This likely refers to the X-Axis granularity or the Window Size.
      // Usually "1h" means "Show me the last 1h of data".
      // If I select "1h", I expect high resolution (e.g. per minute).
      // If I select "7d", I expect lower resolution (e.g. per hour).

      // Let's reinterpret the user request: "Interval" usually means the "Time Window" (Range) in dashboarding contexts.
      // Or it means the "Step Size". "10s" step size makes sense for a "10 minute" window. "1d" step size makes sense for a "1 Year" window.
      
      // User said: "intervals being 10s, 1m, 10m, 1h, 12h, 1d, 3d, 7d"
      // These look like TIME RANGES (Windows). E.g. "Last 1 hour".
      // If they were step sizes, "7d" step size would require months of data.
      // So I will treat these as RANGES.
      
      let dbInterval = '1 hour'
      let step = '1 minute'
      
      if (range === '10s') { dbInterval = '2 minutes'; step = '10 seconds' } // Special case: just show raw data
      else if (range === '1m') { dbInterval = '5 minutes'; step = '10 seconds' }
      else if (range === '10m') { dbInterval = '10 minutes'; step = '10 seconds' }
      else if (range === '1h') { dbInterval = '1 hour'; step = '1 minute' }
      else if (range === '12h') { dbInterval = '12 hours'; step = '5 minutes' }
      else if (range === '1d') { dbInterval = '1 day'; step = '15 minutes' }
      else if (range === '3d') { dbInterval = '3 days'; step = '1 hour' }
      else if (range === '7d') { dbInterval = '7 days'; step = '4 hours' }
      
      // If range is small (<= 10m), just return raw rows to avoid complex grouping if possible, 
      // OR just use date_trunc/grouping for everything for consistency.
      // Postgres date_bin is available in PG 14+. We are using postgres:16-alpine. Good.

      const query = `
        SELECT 
          date_bin($2::interval, created_at, TIMESTAMP '2000-01-01') as time,
          avg(cpu_load) as cpu,
          avg(memory_used) as memory,
          avg(disk_used) as disk,
          avg(avg_latency) as latency
        FROM system_metrics
        WHERE created_at > now() - $1::interval
        GROUP BY time
        ORDER BY time ASC
      `
      
      const r = await pool.query(query, [dbInterval, step])
      
      return {
        metrics: r.rows.map(row => ({
          time: row.time,
          cpu: parseFloat(row.cpu).toFixed(2),
          memory: parseFloat(row.memory).toFixed(0),
          disk: parseFloat(row.disk).toFixed(2),
          latency: parseFloat(row.latency).toFixed(2)
        }))
      }
    } catch (e) {
      console.error(e)
      return { error: String(e) }
    }
  })
}
