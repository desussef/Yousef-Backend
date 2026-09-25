import 'dotenv/config'
import crypto from 'node:crypto'
import path from 'node:path'
import express from 'express'
import pg from 'pg'
import argon2 from 'argon2'
import helmet from 'helmet'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import cookieParser from 'cookie-parser'
import multer from 'multer'
import nodemailer from 'nodemailer'
import { z } from 'zod'
import { storeMedia } from './mediaStorage.js'

const isProduction = process.env.APP_ENV === 'production'
const required = ['DATABASE_URL'].filter((key) => !process.env[key])
if (required.length && process.env.NODE_ENV !== 'test') throw new Error(`Missing required environment variables: ${required.join(', ')}`)
const { Pool } = pg
export const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const app = express()
function normalizeOrigin(value) {
  if (!value) return null
  const cleaned = value.trim().replace(/^['"]|['"]$/g, '')
  try { return new URL(cleaned).origin } catch { return cleaned.replace(/\/+$/, '') }
}
const configuredFrontendOrigins = [process.env.FRONTEND_URL, ...(process.env.FRONTEND_ORIGINS || '').split(',')]
  .map(normalizeOrigin)
  .filter(Boolean)
const fallbackFrontendOrigin = 'http://localhost:5173'
const frontendUrl = configuredFrontendOrigins[0] || fallbackFrontendOrigin
const allowedFrontendOrigins = new Set(configuredFrontendOrigins.length ? configuredFrontendOrigins : [fallbackFrontendOrigin])
const cookieOptions = { httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/api/v1', maxAge: Number(process.env.SESSION_TTL_HOURS || 24) * 3600_000 }
const safeUrl = z.string().url().max(2048)
const social = z.object({ handle: z.string().max(100).optional(), url: safeUrl.optional() }).strict()
const idList = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }).strict()
const projectInput = z.object({ categoryId: z.string().uuid(), title: z.string().trim().min(1).max(200), client: z.string().trim().max(200).nullable().optional(), role: z.string().trim().max(200).nullable().optional(), year: z.number().int().min(1900).max(2100).nullable().optional(), description: z.string().max(10000).nullable().optional(), thumbUrl: safeUrl.nullable().optional(), heroUrl: safeUrl.nullable().optional(), published: z.boolean().optional() }).strict()

app.set('trust proxy', 1)
app.use((req, res, next) => { req.requestId = crypto.randomUUID(); res.setHeader('X-Request-Id', req.requestId); const started = Date.now(); res.on('finish', () => console.info(JSON.stringify({ requestId: req.requestId, method: req.method, path: req.path, status: res.statusCode, durationMs: Date.now() - started }))); next() })
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' }, hsts: isProduction ? undefined : false }))
app.use(cors({ origin(origin, done) { if (!origin || allowedFrontendOrigins.has(normalizeOrigin(origin))) return done(null, true); return done(new Error('Origin not allowed')) }, credentials: true, methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'], allowedHeaders: ['Content-Type', 'X-CSRF-Token'] }))
app.use(express.json({ limit: '1mb' })); app.use(cookieParser())
app.use('/uploads', express.static(path.resolve(process.env.UPLOAD_DIR || './uploads'), { fallthrough: false, maxAge: isProduction ? '7d' : 0 }))

function fail(res, status, message) { return res.status(status).json({ message }) }
function validate(schema, value, res) { const parsed = schema.safeParse(value); if (!parsed.success) { fail(res, 422, 'Invalid request.'); return null } return parsed.data }
function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex') }
function token() { return crypto.randomBytes(32).toString('base64url') }
async function audit(req, action, resourceType = null, resourceId = null) { await pool.query('INSERT INTO audit_logs(user_id,action,resource_type,resource_id,request_id,ip,user_agent) VALUES ($1,$2,$3,$4,$5,$6,$7)', [req.user?.id || null, action, resourceType, resourceId, req.requestId, req.ip, req.get('user-agent')?.slice(0, 500) || null]) }
async function auth(req, res, next) { const raw = req.cookies.portfolio_session; if (!raw) return fail(res, 401, 'Authentication required.'); const result = await pool.query('SELECT u.id,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()', [hashToken(raw)]); if (!result.rowCount) return fail(res, 401, 'Authentication required.'); req.user = result.rows[0]; next() }
function csrf(req, res, next) { if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next(); if (!allowedFrontendOrigins.has(normalizeOrigin(req.get('origin'))) || !req.cookies.portfolio_csrf || !crypto.timingSafeEqual(Buffer.from(req.cookies.portfolio_csrf), Buffer.from(req.get('x-csrf-token') || ''))) return fail(res, 403, 'Request could not be verified.'); next() }
function admin(req, res, next) { return ['owner', 'admin'].includes(req.user?.role) ? next() : fail(res, 403, 'Not authorized.') }
function route(fn) { return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next) }
async function sorted(table, where = '', params = []) { const result = await pool.query(`SELECT * FROM ${table} ${where} ORDER BY sort_order ASC`, params); return result.rows }
async function reorder(table, ids, where = '', params = []) { const client = await pool.connect(); try { await client.query('BEGIN'); const existing = await client.query(`SELECT id FROM ${table} ${where}`, params); if (existing.rowCount !== ids.length || !ids.every((id) => existing.rows.some((row) => row.id === id))) throw Object.assign(new Error('Invalid ordering.'), { status: 422 }); for (const [index, id] of ids.entries()) await client.query(`UPDATE ${table} SET sort_order=$1 WHERE id=$2`, [index, id]); await client.query('COMMIT') } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() } return sorted(table, where, params) }

const api = express.Router()
api.get('/health', route(async (_, res) => { await pool.query('SELECT 1'); res.json({ status: 'ok' }) }))
api.get('/auth/csrf', (req, res) => { const csrfToken = token(); res.cookie('portfolio_csrf', csrfToken, { httpOnly: false, secure: isProduction, sameSite: 'lax', path: '/api/v1' }); res.json({ csrfToken }) })
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, message: { message: 'Too many attempts. Please try again later.' } })
api.post('/auth/login', loginLimiter, csrf, route(async (req, res) => { const data = validate(z.object({ email: z.string().email().max(320), password: z.string().min(1).max(1024) }).strict(), req.body, res); if (!data) return; const result = await pool.query('SELECT id,email,password_hash,role FROM users WHERE email=$1', [data.email.toLowerCase()]); const user = result.rows[0]; const valid = user && await argon2.verify(user.password_hash, data.password); if (!valid) { await audit(req, 'auth.login_failed'); return fail(res, 401, 'Invalid email or password.'); } const raw = token(); await pool.query('INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now() + ($3::text || \' hours\')::interval)', [user.id, hashToken(raw), process.env.SESSION_TTL_HOURS || 24]); req.user = user; await audit(req, 'auth.login'); res.cookie('portfolio_session', raw, cookieOptions).json({ user: { id: user.id, email: user.email, role: user.role } }) }))
api.post('/auth/logout', auth, csrf, route(async (req, res) => { await pool.query('DELETE FROM sessions WHERE token_hash=$1', [hashToken(req.cookies.portfolio_session)]); await audit(req, 'auth.logout'); res.clearCookie('portfolio_session', cookieOptions).status(204).end() }))
api.get('/auth/me', auth, (req, res) => res.json({ user: req.user }))
async function mailReset(email, url) { if (!process.env.SMTP_HOST) { if (!isProduction) console.info(`DEV password-reset email for ${email}: ${url}`); return } const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: Number(process.env.SMTP_PORT) === 465, auth: { user: process.env.SMTP_USERNAME, pass: process.env.SMTP_PASSWORD } }); await transport.sendMail({ from: process.env.SMTP_FROM, to: email, subject: 'Reset your portfolio admin password', text: `Use this link to reset your password within one hour: ${url}\n\nIgnore this email if you did not request it.` }) }
api.post('/auth/forgot-password', loginLimiter, csrf, route(async (req, res) => { const data = validate(z.object({ email: z.string().email().max(320) }).strict(), req.body, res); if (!data) return; const result = await pool.query('SELECT id,email FROM users WHERE email=$1', [data.email.toLowerCase()]); if (result.rowCount) { const raw = token(); await pool.query('DELETE FROM password_reset_tokens WHERE user_id=$1 AND used_at IS NULL', [result.rows[0].id]); await pool.query('INSERT INTO password_reset_tokens(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval \'1 hour\')', [result.rows[0].id, hashToken(raw)]); await mailReset(result.rows[0].email, `${frontendUrl}/#admin/reset-password?token=${encodeURIComponent(raw)}`) } await audit(req, 'auth.password_reset_requested'); res.json({ message: 'If an account exists for this email, a password reset email has been sent.' }) }))
api.post('/auth/reset-password', loginLimiter, csrf, route(async (req, res) => { const data = validate(z.object({ token: z.string().min(32).max(512), password: z.string().min(8).max(1024) }).strict(), req.body, res); if (!data) return; const client = await pool.connect(); try { await client.query('BEGIN'); const found = await client.query('SELECT user_id FROM password_reset_tokens WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() FOR UPDATE', [hashToken(data.token)]); if (!found.rowCount) { await client.query('ROLLBACK'); return fail(res, 400, 'This reset link is invalid or has expired.') } await client.query('UPDATE users SET password_hash=$1,updated_at=now() WHERE id=$2', [await argon2.hash(data.password, { type: argon2.argon2id }), found.rows[0].user_id]); await client.query('UPDATE password_reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL', [found.rows[0].user_id]); await client.query('DELETE FROM sessions WHERE user_id=$1', [found.rows[0].user_id]); await client.query('COMMIT'); await audit(req, 'auth.password_reset_completed', 'user', found.rows[0].user_id); res.status(204).end() } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() } }))

// Public read API; mutable operations below require both session and CSRF verification.
api.get('/site-settings', route(async (_, res) => res.json((await pool.query('SELECT name,role,instagram,vimeo,linkedin FROM site_settings WHERE id=true')).rows[0] || {})))
api.get('/contact', route(async (_, res) => res.json((await pool.query('SELECT email,phone,location,photo_url AS "photoUrl",display_text AS "displayText" FROM contact_settings WHERE id=true')).rows[0] || {})))
api.get('/about', route(async (_, res) => res.json((await pool.query('SELECT portrait_url AS "portraitUrl" FROM about_content WHERE id=true')).rows[0] || {})))
api.get('/about/bio', route(async (_, res) => res.json(await sorted('bio_paragraphs'))))
api.get('/about/logos', route(async (_, res) => res.json((await sorted('client_logos')).map((x) => ({ ...x, imageUrl: x.image_url })))))
api.get('/nav-items', route(async (_, res) => res.json(await sorted('nav_items'))))
api.get('/categories', route(async (_, res) => res.json(await sorted('categories'))))
api.get('/projects', route(async (_req, res) => { const sql = 'SELECT id,category_id AS "categoryId",title,client,role,year,description,thumb_url AS "thumbUrl",hero_url AS "heroUrl",published,sort_order AS "sortOrder" FROM projects WHERE published=true ORDER BY sort_order'; res.json((await pool.query(sql)).rows) }))
api.get('/projects/:id', route(async (req, res) => { const found = await pool.query('SELECT id,category_id AS "categoryId",title,client,role,year,description,thumb_url AS "thumbUrl",hero_url AS "heroUrl",published,sort_order AS "sortOrder" FROM projects WHERE id=$1 AND published=true', [req.params.id]); return found.rowCount ? res.json(found.rows[0]) : fail(res, 404, 'Not found.') }))
api.get('/projects/:id/gallery', route(async (req, res) => res.json((await pool.query('SELECT id,project_id AS "projectId",image_url AS "imageUrl",sort_order AS "sortOrder" FROM project_media WHERE project_id=$1 ORDER BY sort_order', [req.params.id])).rows)))

api.use(auth, csrf, admin)
api.put('/site-settings', route(async (req, res) => { const data = validate(z.object({ name: z.string().trim().min(1).max(200), role: z.string().trim().min(1).max(200), instagram: social, vimeo: social, linkedin: social }).strict(), req.body, res); if (!data) return; const out = await pool.query('INSERT INTO site_settings(id,name,role,instagram,vimeo,linkedin) VALUES(true,$1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET name=$1,role=$2,instagram=$3,vimeo=$4,linkedin=$5,updated_at=now() RETURNING name,role,instagram,vimeo,linkedin', [data.name, data.role, data.instagram, data.vimeo, data.linkedin]); await audit(req, 'site_settings.updated', 'site_settings', 'true'); res.json(out.rows[0]) }))
api.put('/contact', route(async (req, res) => { const data = validate(z.object({ email: z.string().email().max(320), phone: z.string().max(100).nullable().optional(), location: z.string().max(200).nullable().optional(), photoUrl: safeUrl.nullable().optional(), displayText: z.string().max(5000).nullable().optional() }).strict(), req.body, res); if (!data) return; const out = await pool.query('INSERT INTO contact_settings(id,email,phone,location,photo_url,display_text) VALUES(true,$1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET email=$1,phone=$2,location=$3,photo_url=$4,display_text=$5,updated_at=now() RETURNING email,phone,location,photo_url AS "photoUrl",display_text AS "displayText"', [data.email, data.phone || null, data.location || null, data.photoUrl || null, data.displayText ?? null]); await audit(req, 'contact.updated', 'contact_settings', 'true'); res.json(out.rows[0]) }))
api.put('/about', route(async (req, res) => { const data = validate(z.object({ portraitUrl: safeUrl.nullable() }).strict(), req.body, res); if (!data) return; const out = await pool.query('INSERT INTO about_content(id,portrait_url) VALUES(true,$1) ON CONFLICT(id) DO UPDATE SET portrait_url=$1,updated_at=now() RETURNING portrait_url AS "portraitUrl"', [data.portraitUrl]); await audit(req, 'about.updated', 'about_content', 'true'); res.json(out.rows[0]) }))
function dbColumn(key) { return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`) }
function crudSorted({ base, table, create, update, map = (row) => row }) {
  api.get(base, route(async (_, res) => res.json((await sorted(table)).map(map))))
  api.post(base, route(async (req, res) => {
    const data = validate(create, req.body, res); if (!data) return
    const fields = Object.keys(data); const columns = fields.map(dbColumn)
    const placeholders = fields.map((_, index) => `$${index + 1}`)
    const result = await pool.query(`INSERT INTO ${table}(${columns.join(',')},sort_order) VALUES(${placeholders.join(',')},(SELECT count(*) FROM ${table})) RETURNING *`, Object.values(data))
    await audit(req, `${table}.created`, table, result.rows[0].id); res.status(201).json(map(result.rows[0]))
  }))
  api.put(`${base}/reorder`, route(async (req, res) => { const data = validate(idList, req.body, res); if (!data) return; const result = await reorder(table, data.ids); await audit(req, `${table}.reordered`, table); res.json(result.map(map)) }))
  api.patch(`${base}/:id`, route(async (req, res) => {
    const data = validate(update, req.body, res); if (!data) return
    const fields = Object.entries(data); if (!fields.length) return fail(res, 422, 'Invalid request.')
    const assignments = fields.map(([key], index) => `${dbColumn(key)}=$${index + 1}`)
    const result = await pool.query(`UPDATE ${table} SET ${assignments.join(',')} WHERE id=$${fields.length + 1} RETURNING *`, [...fields.map(([, value]) => value), req.params.id])
    if (!result.rowCount) return fail(res, 404, 'Not found.'); await audit(req, `${table}.updated`, table, req.params.id); res.json(map(result.rows[0]))
  }))
  api.delete(`${base}/:id`, route(async (req, res) => { const result = await pool.query(`DELETE FROM ${table} WHERE id=$1 RETURNING id`, [req.params.id]); if (!result.rowCount) return fail(res, 404, 'Not found.'); await audit(req, `${table}.deleted`, table, req.params.id); res.status(204).end() }))
}
crudSorted({ base: '/nav-items', table: 'nav_items', create: z.object({ label: z.string().trim().min(1).max(80), href: z.string().regex(/^#[a-z0-9/-]+$/).max(300) }).strict(), update: z.object({ label: z.string().trim().min(1).max(80).optional(), href: z.string().regex(/^#[a-z0-9/-]+$/).max(300).optional() }).strict() })
crudSorted({ base: '/categories', table: 'categories', create: z.object({ name: z.string().trim().min(1).max(120) }).strict(), update: z.object({ name: z.string().trim().min(1).max(120).optional() }).strict() })
crudSorted({ base: '/about/bio', table: 'bio_paragraphs', create: z.object({ body: z.string().trim().min(1).max(10000) }).strict(), update: z.object({ body: z.string().trim().min(1).max(10000).optional() }).strict() })
crudSorted({ base: '/about/logos', table: 'client_logos', create: z.object({ name: z.string().trim().min(1).max(200), imageUrl: safeUrl }).strict(), update: z.object({ name: z.string().trim().min(1).max(200).optional(), imageUrl: safeUrl.optional() }).strict(), map: (x) => ({ ...x, imageUrl: x.image_url }) })
api.delete('/categories/:id', route(async (req, res) => { try { const done = await pool.query('DELETE FROM categories WHERE id=$1 RETURNING id', [req.params.id]); if (!done.rowCount) return fail(res, 404, 'Not found.'); await audit(req, 'categories.deleted', 'category', req.params.id); res.status(204).end() } catch (error) { if (error.code === '23503') return fail(res, 409, 'Category still has projects assigned.'); throw error } }))
api.post('/projects', route(async (req, res) => { const data = validate(projectInput, req.body, res); if (!data) return; const out = await pool.query('INSERT INTO projects(category_id,title,client,role,year,description,thumb_url,hero_url,published,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,(SELECT count(*) FROM projects)) RETURNING id,category_id AS "categoryId",title,client,role,year,description,thumb_url AS "thumbUrl",hero_url AS "heroUrl",published,sort_order AS "sortOrder"', [data.categoryId,data.title,data.client||null,data.role||null,data.year||null,data.description||null,data.thumbUrl||null,data.heroUrl||null,data.published ?? true]); await audit(req, 'projects.created', 'project', out.rows[0].id); res.status(201).json(out.rows[0]) }))
api.patch('/projects/:id', route(async (req, res) => { const data = validate(projectInput.partial(), req.body, res); if (!data || !Object.keys(data).length) return fail(res, 422, 'Invalid request.'); const cols = Object.entries(data); const result = await pool.query(`UPDATE projects SET ${cols.map(([key], i) => `${key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)}=$${i + 1}`).join(',')},updated_at=now() WHERE id=$${cols.length + 1} RETURNING id,category_id AS "categoryId",title,client,role,year,description,thumb_url AS "thumbUrl",hero_url AS "heroUrl",published,sort_order AS "sortOrder"`, [...cols.map(([, v]) => v), req.params.id]); if (!result.rowCount) return fail(res, 404, 'Not found.'); await audit(req, 'projects.updated', 'project', req.params.id); res.json(result.rows[0]) }))
api.delete('/projects/:id', route(async (req, res) => { const done = await pool.query('DELETE FROM projects WHERE id=$1 RETURNING id', [req.params.id]); if (!done.rowCount) return fail(res, 404, 'Not found.'); await audit(req, 'projects.deleted', 'project', req.params.id); res.status(204).end() }))
api.put('/projects/reorder', route(async (req, res) => { const data = validate(idList, req.body, res); if (!data) return; const rows = await reorder('projects', data.ids); await audit(req, 'projects.reordered', 'project'); res.json(rows) }))
api.post('/projects/:id/gallery', route(async (req, res) => { const data = validate(z.object({ imageUrl: safeUrl }).strict(), req.body, res); if (!data) return; const out = await pool.query('INSERT INTO project_media(project_id,image_url,sort_order) VALUES($1,$2,(SELECT count(*) FROM project_media WHERE project_id=$1)) RETURNING id,project_id AS "projectId",image_url AS "imageUrl",sort_order AS "sortOrder"', [req.params.id,data.imageUrl]); await audit(req, 'project_media.created', 'project_media', out.rows[0].id); res.status(201).json(out.rows[0]) }))
api.delete('/gallery/:id', route(async (req, res) => { const done = await pool.query('DELETE FROM project_media WHERE id=$1 RETURNING id', [req.params.id]); if (!done.rowCount) return fail(res, 404, 'Not found.'); await audit(req, 'project_media.deleted', 'project_media', req.params.id); res.status(204).end() }))
api.put('/projects/:id/gallery/reorder', route(async (req, res) => { const data = validate(idList, req.body, res); if (!data) return; const rows = await reorder('project_media', data.ids, 'WHERE project_id=$1', [req.params.id]); await audit(req, 'project_media.reordered', 'project_media'); res.json(rows.map((x) => ({ ...x, imageUrl: x.image_url, projectId: x.project_id }))) }))
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: Number(process.env.MAX_UPLOAD_BYTES || 26214400), files: 1 }, fileFilter: (_, file, done) => done(null, ['image/jpeg','image/png','image/webp','video/mp4'].includes(file.mimetype)) })
function hasExpectedFileSignature(file) {
  const b = file.buffer
  if (file.mimetype === 'image/jpeg') return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
  if (file.mimetype === 'image/png') return b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (file.mimetype === 'image/webp') return b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP'
  if (file.mimetype === 'video/mp4') return b.subarray(4, 8).toString() === 'ftyp'
  return false
}
api.post('/uploads', upload.single('file'), route(async (req, res) => {
  if (!req.file || !hasExpectedFileSignature(req.file)) return fail(res, 422, 'A valid JPEG, PNG, WebP, or MP4 file is required.')
  const stored = await storeMedia(req.file)
  const media = await pool.query('INSERT INTO media_objects(object_key,public_url,original_filename,mime_type,size_bytes,storage_provider,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id', [stored.objectKey, stored.publicUrl, path.basename(req.file.originalname || 'upload'), req.file.mimetype, req.file.size, stored.provider, req.user.id])
  await audit(req, 'media.uploaded', 'media_object', media.rows[0].id)
  res.status(201).json({ id: media.rows[0].id, url: stored.publicUrl })
}))
app.use('/api/v1', api)
app.use((err, req, res, _next) => { console.error(JSON.stringify({ requestId: req.requestId, error: err.message, code: err.code })); if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') return fail(res, 413, 'File is too large.'); if (err.message === 'Origin not allowed') return fail(res, 403, 'Origin not allowed.'); if (err.message === 'S3 media storage is not configured.' || err.message === 'S3 media storage is not fully configured.') return fail(res, 503, 'Media storage is not configured.'); if (err.code === '23505') return fail(res, 409, 'This value already exists.'); if (err.code === '23503') return fail(res, 409, 'This item is still in use.'); return fail(res, 500, 'An unexpected error occurred.') })
export default app
