import 'dotenv/config'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
const { Pool } = pg
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations')
await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
for (const name of (await fs.readdir(dir)).filter((file) => file.endsWith('.sql')).sort()) {
  const done = await pool.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name])
  if (done.rowCount) continue
  const sql = await fs.readFile(path.join(dir, name), 'utf8')
  const client = await pool.connect()
  try { await client.query('BEGIN'); await client.query(sql); await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [name]); await client.query('COMMIT'); console.log(`Applied ${name}`) }
  catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}
await pool.end()
