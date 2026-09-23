import { describe, expect, it } from 'vitest'
import request from 'supertest'

describe('cors frontend origin handling', () => {
  it('accepts the configured frontend origin even when FRONTEND_URL has a trailing slash', async () => {
    process.env.NODE_ENV = 'test'
    process.env.DATABASE_URL = 'postgresql://user:password@localhost:5432/test'
    process.env.FRONTEND_URL = 'https://portfolio-frontend-yknqsz.cranl.net/'

    const { default: app } = await import('../src/app.js')
    const response = await request(app)
      .get('/missing')
      .set('Origin', 'https://portfolio-frontend-yknqsz.cranl.net')

    expect(response.headers['access-control-allow-origin']).toBe('https://portfolio-frontend-yknqsz.cranl.net')
  })
})
