import 'dotenv/config'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import argon2 from 'argon2'
import pg from 'pg'

const email = process.argv[2]?.trim().toLowerCase()
if (!process.env.DATABASE_URL || !email || !/^\S+@\S+\.\S+$/.test(email)) throw new Error('Usage: npm run reset-admin-password -- admin@example.com (DATABASE_URL required)')
const rl = readline.createInterface({ input, output, terminal: true })
const password = await rl.question('New password (input is visible): ')
rl.close()
if (password.length < 8) throw new Error('Password must be at least 8 characters.')
const passwordHash = await argon2.hash(password, { type: argon2.argon2id })
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const updated = await pool.query('UPDATE users SET password_hash=$1, updated_at=now() WHERE email=$2 RETURNING id', [passwordHash, email])
if (!updated.rowCount) {
  await pool.end()
  throw new Error(`No admin found with email ${email}.`)
}
// Sign out every existing session for this account.
await pool.query('DELETE FROM sessions WHERE user_id=$1', [updated.rows[0].id])
await pool.end()
console.log('Password updated.')
