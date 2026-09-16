import 'dotenv/config'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import argon2 from 'argon2'
import pg from 'pg'

const email = process.argv[2]?.trim().toLowerCase()
if (!process.env.DATABASE_URL || !email || !/^\S+@\S+\.\S+$/.test(email)) throw new Error('Usage: npm run create-admin -- admin@example.com (DATABASE_URL required)')
const rl = readline.createInterface({ input, output, terminal: true })
const password = await rl.question('New password (input is visible): ')
rl.close()
if (password.length < 8) throw new Error('Password must be at least 8 characters.')
const passwordHash = await argon2.hash(password, { type: argon2.argon2id })
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
await pool.query('INSERT INTO users(email, password_hash, role) VALUES ($1,$2,$3)', [email, passwordHash, 'owner'])
await pool.end()
console.log('Admin created.')
