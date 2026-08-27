import { Hono } from 'hono'
import { STATS } from './data'
import type { HealthResponse, HelloResponse, StatsResponse } from '../shared/types'

const app = new Hono<{ Bindings: Env }>()

app.get('/api/health', (c) => c.json<HealthResponse>({ ok: true, ts: Date.now() }))

app.get('/api/hello', (c) => c.json<HelloResponse>({ message: 'Hello from the Worker 👋' }))

app.get('/api/stats', (c) => c.json<StatsResponse>({ stats: STATS, generatedAt: Date.now() }))

// Anything else under /api must fail as JSON. Without this it falls through to
// the static-assets binding and a fetch() expecting JSON gets index.html instead.
app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404))

// Everything that isn't the API is the SPA. Static files and the
// history-mode fallback both come from the assets binding.
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw))

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: 'Internal server error' }, 500)
})

export default app
