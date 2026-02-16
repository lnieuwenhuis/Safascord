import { Pool, type PoolConfig } from "pg"

function isTrue(value: string | undefined, defaultValue = false) {
  if (value == null) return defaultValue
  return value.toLowerCase() === "true"
}

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error("DATABASE_URL is required")
}

const config: PoolConfig = {
  connectionString,
  max: Number(process.env.PG_POOL_MAX || 20),
  connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 10000),
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
}

if (isTrue(process.env.DATABASE_SSL, false)) {
  config.ssl = { rejectUnauthorized: false }
}

export const pool = new Pool(config)

pool.on("error", (err) => {
  console.error("Unexpected error on idle pg client", err)
})

export async function checkDatabaseConnection() {
  await pool.query("SELECT 1")
}

export async function closeDatabasePool() {
  await pool.end()
}
