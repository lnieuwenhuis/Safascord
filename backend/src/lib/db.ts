import { Pool } from "pg"

// The error `TypeError: Cannot read properties of undefined (reading 'searchParams')` in `pg-connection-string`
// suggests that the input string passed to it is somehow invalid or causing the parser to fail.
// In Node 20 + pg, connectionString should be passed directly.

// However, if the password contains special characters that were NOT properly encoded in the ENV var itself,
// or if the ENV var injection in Docker Compose did something weird with the `$`, it might be broken.

// The user provided .env had: DATABASE_URL=postgresql://app:FU%2C3.%3B%5Do8u2%3F%3BnX.8Q@pgbouncer:6432/app
// This looks correct.

export const pool = new Pool({ connectionString: process.env.DATABASE_URL })

pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client', err)
  // process.exit(-1) // Do not crash the app on idle client error, just log it
})

pool.on('connect', (client) => {
  // This might be too noisy for production, but useful for debugging now
  console.log('New client connected to database pool')
})

// Test the connection immediately
pool.query('SELECT NOW()').then((res) => {
  console.log('Database connection test successful:', res.rows[0])
}).catch((err) => {
  console.error('Database connection test failed:', err)
})
