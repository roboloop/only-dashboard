import { describe, it, expect } from 'vitest'
import app from '../index'
import type { HealthResponse, StatsResponse } from '../../shared/types'

// Hono apps are callable directly, so the routing, status codes and JSON shapes
// can be tested without booting workerd.
describe('worker api', () => {
  it('reports health', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)

    const body = (await res.json()) as HealthResponse
    expect(body.ok).toBe(true)
    expect(typeof body.ts).toBe('number')
  })

  it('returns dummy stats', async () => {
    const res = await app.request('/api/stats')
    expect(res.status).toBe(200)

    const body = (await res.json()) as StatsResponse
    expect(body.stats.length).toBeGreaterThan(0)
    expect(body.stats[0]).toHaveProperty('label')
  })

  it('fails unknown /api routes as JSON, not as the SPA fallback', async () => {
    const res = await app.request('/api/nope')
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual({ error: 'Not found' })
  })
})
