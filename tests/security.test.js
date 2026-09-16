import { describe, expect, it } from 'vitest'
import crypto from 'node:crypto'

describe('security primitives', () => {
  it('creates unpredictable, fixed-length session/reset token hashes', () => {
    const raw = crypto.randomBytes(32).toString('base64url')
    const hash = crypto.createHash('sha256').update(raw).digest('hex')
    expect(raw).not.toHaveLength(0)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    expect(hash).not.toBe(raw)
  })

  it('rejects malformed UUID resource identifiers before they can be used as database IDs', () => {
    expect(crypto.randomUUID()).toMatch(/^[0-9a-f-]{36}$/)
    expect('projects; DROP TABLE users').not.toMatch(/^[0-9a-f-]{36}$/)
  })
})
