import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import app from '../index'
import type { AppEnv } from '../env'
import type { MeResponse } from '../../shared/types'

/**
 * A KVNamespace stand-in. Only the four methods the Worker uses are
 * implemented; TTLs are ignored because no test depends on expiry.
 */
function fakeKv() {
  const store = new Map<string, string>()
  return {
    store,
    async get(key: string, type?: string) {
      const raw = store.get(key)
      if (raw === undefined) return null
      return type === 'json' ? JSON.parse(raw) : raw
    },
    async put(key: string, value: string) {
      store.set(key, value)
    },
    async delete(key: string) {
      store.delete(key)
    },
  }
}

function makeEnv() {
  return {
    SESSIONS: fakeKv(),
    ASSETS: {
      fetch: async () =>
        new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }),
    },
    TWITCH_CLIENT_ID: 'twitch-id',
    TWITCH_CLIENT_SECRET: 'twitch-secret',
    KICK_CLIENT_ID: 'kick-id',
    KICK_CLIENT_SECRET: 'kick-secret',
    VKVIDEO_CLIENT_ID: 'vk-id',
    VKVIDEO_CLIENT_SECRET: 'vk-secret',
  } as unknown as AppEnv
}

let env: AppEnv

beforeEach(() => {
  env = makeEnv()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const BASE = 'http://localhost:5173'

/** Pulls the sid cookie value out of a Set-Cookie header. */
function sidFrom(response: Response): string {
  const header = response.headers.get('set-cookie') ?? ''
  return /sid=([^;]+)/.exec(header)?.[1] ?? ''
}

describe('/api/me without a session', () => {
  it('reports all three providers as disconnected rather than erroring', async () => {
    const res = await app.request(`${BASE}/api/me`, {}, env)
    expect(res.status).toBe(200)

    const body = (await res.json()) as MeResponse
    expect(body.providers.map((p) => p.id)).toEqual(['twitch', 'kick', 'vkvideo'])
    expect(body.providers.every((p) => !p.connected)).toBe(true)
  })
})

describe('/auth/:provider/start', () => {
  it('redirects to the provider and sets an httpOnly session cookie', async () => {
    const res = await app.request(`${BASE}/auth/twitch/start`, {}, env)

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('https://id.twitch.tv/oauth2/authorize')

    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
  })

  it('derives redirect_uri from the request origin', async () => {
    const res = await app.request(`${BASE}/auth/kick/start`, {}, env)
    const location = new URL(res.headers.get('location')!)

    expect(location.searchParams.get('redirect_uri')).toBe(`${BASE}/auth/kick/callback`)
  })

  it('stores the PKCE verifier server-side and sends only the challenge', async () => {
    const res = await app.request(`${BASE}/auth/kick/start`, {}, env)
    const location = new URL(res.headers.get('location')!)
    const challenge = location.searchParams.get('code_challenge')!

    const kv = env.SESSIONS as unknown as ReturnType<typeof fakeKv>
    const stored = [...kv.store.entries()].find(([key]) => key.startsWith('oauth:'))!
    const transaction = JSON.parse(stored[1]) as { codeVerifier: string }

    expect(transaction.codeVerifier).toBeTruthy()
    // The verifier itself must never appear in the redirect.
    expect(location.toString()).not.toContain(transaction.codeVerifier)
    expect(challenge).not.toBe(transaction.codeVerifier)
  })

  it('404s an unknown provider', async () => {
    const res = await app.request(`${BASE}/auth/youtube/start`, {}, env)
    expect(res.status).toBe(404)
  })
})

describe('/auth/:provider/callback', () => {
  async function startFlow() {
    const res = await app.request(`${BASE}/auth/twitch/start`, {}, env)
    const state = new URL(res.headers.get('location')!).searchParams.get('state')!
    return { state, sid: sidFrom(res) }
  }

  it('exchanges the code, stores tokens, and redirects home', async () => {
    const { state, sid } = await startFlow()

    vi.stubGlobal(
      'fetch',
      (async () =>
        new Response(
          JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }),
          {
            status: 200,
          },
        )) as unknown as typeof fetch,
    )

    const res = await app.request(
      `${BASE}/auth/twitch/callback?code=abc&state=${state}`,
      { headers: { cookie: `sid=${sid}` } },
      env,
    )

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/')

    const kv = env.SESSIONS as unknown as ReturnType<typeof fakeKv>
    const session = JSON.parse(kv.store.get(`session:${sid}`)!)
    expect(session.connections.twitch.accessToken).toBe('at')
  })

  it('rejects a replayed state', async () => {
    const { state, sid } = await startFlow()

    vi.stubGlobal(
      'fetch',
      (async () =>
        new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), {
          status: 200,
        })) as unknown as typeof fetch,
    )

    const headers = { cookie: `sid=${sid}` }
    const first = await app.request(
      `${BASE}/auth/twitch/callback?code=a&state=${state}`,
      { headers },
      env,
    )
    const second = await app.request(
      `${BASE}/auth/twitch/callback?code=a&state=${state}`,
      { headers },
      env,
    )

    expect(first.headers.get('location')).toBe('/')
    expect(second.headers.get('location')).toBe('/?error=invalid_state')
  })

  it('rejects a state that was never issued', async () => {
    const res = await app.request(`${BASE}/auth/twitch/callback?code=a&state=forged`, {}, env)
    expect(res.headers.get('location')).toBe('/?error=invalid_state')
  })

  it('passes a denial through as a friendly redirect, not a 500', async () => {
    const res = await app.request(`${BASE}/auth/twitch/callback?error=access_denied`, {}, env)

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/?error=access_denied')
  })
})

describe('token confinement', () => {
  it('never includes a token in the /api/me response', async () => {
    const res = await app.request(`${BASE}/auth/twitch/start`, {}, env)
    const state = new URL(res.headers.get('location')!).searchParams.get('state')!
    const sid = sidFrom(res)
    const headers = { cookie: `sid=${sid}` }

    vi.stubGlobal('fetch', (async (url: string) => {
      if (String(url).includes('/oauth2/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'SECRET-ACCESS',
            refresh_token: 'SECRET-REFRESH',
            expires_in: 3600,
          }),
          { status: 200 },
        )
      }
      if (String(url).includes('/helix/users')) {
        return new Response(JSON.stringify({ data: [{ id: '1', display_name: 'Me' }] }), {
          status: 200,
        })
      }
      if (String(url).includes('/helix/channels')) {
        return new Response(JSON.stringify({ data: [{ title: 'A title', game_name: 'G' }] }), {
          status: 200,
        })
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 })
    }) as unknown as typeof fetch)

    await app.request(`${BASE}/auth/twitch/callback?code=a&state=${state}`, { headers }, env)

    const me = await app.request(`${BASE}/api/me`, { headers }, env)
    const text = await me.text()

    expect(text).toContain('A title')
    expect(text).not.toContain('SECRET-ACCESS')
    expect(text).not.toContain('SECRET-REFRESH')
  })
})

describe('disconnect and logout', () => {
  async function connectedSession() {
    const res = await app.request(`${BASE}/auth/twitch/start`, {}, env)
    const sid = sidFrom(res)
    const kv = env.SESSIONS as unknown as ReturnType<typeof fakeKv>
    kv.store.set(
      `session:${sid}`,
      JSON.stringify({
        createdAt: Date.now(),
        connections: {
          twitch: {
            accessToken: 'at',
            refreshToken: 'rt',
            expiresAt: Date.now() + 3_600_000,
            scope: null,
          },
        },
      }),
    )
    return { sid, kv }
  }

  it('removes one provider and leaves the session intact', async () => {
    const { sid, kv } = await connectedSession()

    const res = await app.request(
      `${BASE}/api/auth/twitch/disconnect`,
      { method: 'POST', headers: { cookie: `sid=${sid}` } },
      env,
    )

    expect(res.status).toBe(200)
    const session = JSON.parse(kv.store.get(`session:${sid}`)!)
    expect(session.connections.twitch).toBeUndefined()
  })

  it('deletes the whole session on logout', async () => {
    const { sid, kv } = await connectedSession()

    await app.request(
      `${BASE}/api/auth/logout`,
      { method: 'POST', headers: { cookie: `sid=${sid}` } },
      env,
    )

    expect(kv.store.has(`session:${sid}`)).toBe(false)
  })
})

describe('routing', () => {
  it('fails unknown /api paths as JSON, not as the SPA fallback', async () => {
    const res = await app.request(`${BASE}/api/nope`, {}, env)

    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toContain('application/json')
  })

  it('serves the SPA for a client-side route', async () => {
    const res = await app.request(`${BASE}/anything`, {}, env)

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
  })
})
