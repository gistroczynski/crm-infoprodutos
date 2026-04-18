import { Pool } from 'pg'
import dotenv from 'dotenv'

dotenv.config()

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required')
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
})

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err)
})

export async function query<T = unknown>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const result = await pool.query(text, params)
  return result.rows as T[]
}

export async function queryOne<T = unknown>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(text, params)
  return rows[0] ?? null
}
