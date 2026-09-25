import 'dotenv/config'
import argon2 from 'argon2'
import pg from 'pg'

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
const password = process.env.ADMIN_PASSWORD
const role = process.env.ADMIN_ROLE?.trim() || 'owner'

if (!email && !password) {
  process.exit(0)
}

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new Error('ADMIN_EMAIL must be a valid email address.')
if (!password || password.length < 8) throw new Error('ADMIN_PASSWORD must be at least 8 characters.')
if (!['owner', 'admin'].includes(role)) throw new Error('ADMIN_ROLE must be owner or admin.')

const passwordHash = await argon2.hash(password, { type: argon2.argon2id })
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const result = await pool.query(
  `INSERT INTO users(email, password_hash, role)
   VALUES ($1, $2, $3)
   ON CONFLICT(email) DO UPDATE
   SET password_hash = EXCLUDED.password_hash,
       role = EXCLUDED.role,
       updated_at = now()
   RETURNING id, email, role`,
  [email, passwordHash, role]
)
await pool.query('DELETE FROM sessions WHERE user_id = $1', [result.rows[0].id])
await pool.end()
console.log(`Admin account ready: ${result.rows[0].email} (${result.rows[0].role})`)
