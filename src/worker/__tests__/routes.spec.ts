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

/** Seeds a session directly in KV with the given connections. */
async function seedSession(connections: Record<string, unknown>) {
  const res = await app.request(`${BASE}/auth/twitch/start`, {}, env)
  const sid = sidFrom(res)
  const kv = env.SESSIONS as unknown as ReturnType<typeof fakeKv>
  kv.store.set(`session:${sid}`, JSON.stringify({ createdAt: Date.now(), connections }))
  return { sid, kv, headers: { cookie: `sid=${sid}` } }
}

function token(scope: string | null) {
  return {
    accessToken: 'SECRET-ACCESS',
    refreshToken: 'SECRET-REFRESH',
    expiresAt: Date.now() + 3_600_000,
    scope,
  }
}

/**
 * Stubs the platforms' APIs, longest URL prefix first, recording every call.
 * A route value that is a number responds with that status and no body.
 */
function platformFetch(routes: Record<string, unknown>) {
  const calls: { url: string; method: string; body: string | null }[] = []
  vi.stubGlobal('fetch', (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : null,
    })

    const match = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((key) => url.startsWith(key))
    if (!match) return new Response('{}', { status: 404 })

    const value = routes[match]
    if (typeof value === 'number') return new Response('{}', { status: value })
    return new Response(JSON.stringify(value), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch)
  return calls
}

describe('PATCH /api/stream/title', () => {
  it('requires a session', async () => {
    const res = await app.request(
      `${BASE}/api/stream/title`,
      { method: 'PATCH', body: JSON.stringify({ title: 'T' }) },
      env,
    )
    expect(res.status).toBe(401)
  })

  it('rejects an empty title', async () => {
    const { headers } = await seedSession({ twitch: token('channel:manage:broadcast') })

    const res = await app.request(
      `${BASE}/api/stream/title`,
      { method: 'PATCH', headers, body: JSON.stringify({ title: '   ' }) },
      env,
    )
    expect(res.status).toBe(400)
  })

  it('pushes to every connected platform and records history', async () => {
    const { headers, kv, sid } = await seedSession({
      twitch: token('channel:manage:broadcast'),
      kick: token('user:read channel:read channel:write'),
    })
    const calls = platformFetch({
      'https://api.twitch.tv/helix/users': { data: [{ id: '42', display_name: 'S' }] },
      'https://api.twitch.tv/helix/channels': {},
      'https://api.kick.com/public/v1/channels': {},
    })

    const res = await app.request(
      `${BASE}/api/stream/title`,
      { method: 'PATCH', headers, body: JSON.stringify({ title: 'New title' }) },
      env,
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as { results: { id: string; ok: boolean }[] }
    expect(body.results).toEqual([
      { id: 'twitch', ok: true, error: null, disconnected: false },
      { id: 'kick', ok: true, error: null, disconnected: false },
    ])

    const patches = calls.filter((call) => call.method === 'PATCH')
    expect(patches).toHaveLength(2)
    const twitchPatch = patches.find((call) => call.url.includes('twitch.tv'))!
    const kickPatch = patches.find((call) => call.url.includes('kick.com'))!
    expect(JSON.parse(twitchPatch.body!)).toEqual({ title: 'New title' })
    expect(JSON.parse(kickPatch.body!)).toEqual({ stream_title: 'New title' })

    const history = JSON.parse(kv.store.get(`history:${sid}`)!) as {
      titles: { text: string; pinned: boolean }[]
    }
    expect(history.titles).toHaveLength(1)
    expect(history.titles[0]!.text).toBe('New title')
  })

  it('keeps other platforms’ successes when one platform fails', async () => {
    const { headers } = await seedSession({
      twitch: token('channel:manage:broadcast'),
      kick: token('channel:write'),
    })
    platformFetch({
      'https://api.twitch.tv/helix/users': { data: [{ id: '42', display_name: 'S' }] },
      'https://api.twitch.tv/helix/channels': {},
      'https://api.kick.com/public/v1/channels': 500,
    })

    const res = await app.request(
      `${BASE}/api/stream/title`,
      { method: 'PATCH', headers, body: JSON.stringify({ title: 'T' }) },
      env,
    )

    const body = (await res.json()) as { results: { id: string; ok: boolean; error: string | null }[] }
    expect(body.results.find((r) => r.id === 'twitch')!.ok).toBe(true)
    expect(body.results.find((r) => r.id === 'kick')!.ok).toBe(false)
    expect(body.results.find((r) => r.id === 'kick')!.error).toContain('Kick')
  })

  it('refuses to push through a token that predates the write scopes', async () => {
    const { headers } = await seedSession({ twitch: token(null) })
    const calls = platformFetch({})

    const res = await app.request(
      `${BASE}/api/stream/title`,
      { method: 'PATCH', headers, body: JSON.stringify({ title: 'T' }) },
      env,
    )

    const body = (await res.json()) as { results: { ok: boolean; error: string }[] }
    expect(body.results[0]!.ok).toBe(false)
    expect(body.results[0]!.error).toContain('Reconnect')
    // The doomed call was never made.
    expect(calls).toHaveLength(0)
  })

  it('never includes a token in the save response', async () => {
    const { headers } = await seedSession({ twitch: token('channel:manage:broadcast') })
    platformFetch({
      'https://api.twitch.tv/helix/users': { data: [{ id: '42', display_name: 'S' }] },
      'https://api.twitch.tv/helix/channels': {},
    })

    const res = await app.request(
      `${BASE}/api/stream/title`,
      { method: 'PATCH', headers, body: JSON.stringify({ title: 'T' }) },
      env,
    )

    const text = await res.text()
    expect(text).not.toContain('SECRET-ACCESS')
    expect(text).not.toContain('SECRET-REFRESH')
  })
})

describe('PATCH /api/stream/category', () => {
  it('pushes each platform its own picked category and records history', async () => {
    const { headers, kv, sid } = await seedSession({
      twitch: token('channel:manage:broadcast'),
    })
    const calls = platformFetch({
      'https://api.twitch.tv/helix/users': { data: [{ id: '42', display_name: 'S' }] },
      'https://api.twitch.tv/helix/channels': {},
    })

    const res = await app.request(
      `${BASE}/api/stream/category`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          picks: { twitch: { id: '743', name: 'Chess', imageUrl: null } },
        }),
      },
      env,
    )

    expect(res.status).toBe(200)
    const patch = calls.find((call) => call.method === 'PATCH')!
    expect(JSON.parse(patch.body!)).toEqual({ game_id: '743' })

    const history = JSON.parse(kv.store.get(`history:${sid}`)!) as {
      categories: { twitch: { category: { name: string } }[] }
    }
    expect(history.categories.twitch[0]!.category.name).toBe('Chess')
  })

  it('rejects a request with no usable pick', async () => {
    const { headers } = await seedSession({ twitch: token('channel:manage:broadcast') })

    const res = await app.request(
      `${BASE}/api/stream/category`,
      { method: 'PATCH', headers, body: JSON.stringify({ picks: { youtube: { id: '1', name: 'X' } } }) },
      env,
    )
    expect(res.status).toBe(400)
  })
})

describe('GET /api/categories/search', () => {
  it('fans out to connected platforms and keys results by provider', async () => {
    const { headers } = await seedSession({
      twitch: token('channel:manage:broadcast'),
      kick: token('channel:write'),
    })
    platformFetch({
      'https://api.twitch.tv/helix/search/categories': {
        data: [{ id: '1', name: 'Elden Ring', box_art_url: '' }],
      },
      'https://api.kick.com/public/v1/categories': {
        data: [{ id: 7, name: 'Elden Ring' }],
      },
    })

    const res = await app.request(`${BASE}/api/categories/search?q=elden`, { headers }, env)

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      results: Record<string, { id: string; name: string }[]>
    }
    expect(body.results.twitch![0]!.name).toBe('Elden Ring')
    expect(body.results.kick![0]!.id).toBe('7')
    expect(body.results.vkvideo).toBeUndefined()
  })

  it('narrows to one platform with ?provider=', async () => {
    const { headers } = await seedSession({
      twitch: token('channel:manage:broadcast'),
      kick: token('channel:write'),
    })
    const calls = platformFetch({
      'https://api.kick.com/public/v1/categories': { data: [] },
    })

    const res = await app.request(
      `${BASE}/api/categories/search?q=elden&provider=kick`,
      { headers },
      env,
    )

    expect(res.status).toBe(200)
    expect(calls.every((call) => call.url.startsWith('https://api.kick.com'))).toBe(true)
  })

  it('requires a query', async () => {
    const { headers } = await seedSession({ twitch: token('channel:manage:broadcast') })
    const res = await app.request(`${BASE}/api/categories/search?q=`, { headers }, env)
    expect(res.status).toBe(400)
  })
})

describe('last-pushed backfill', () => {
  const offlineKick = {
    data: [
      {
        slug: 'streamer',
        stream_title: '',
        category: { id: 0, name: '', thumbnail: '' },
        stream: { is_live: false },
      },
    ],
  }

  async function saveTitleAndCategory(headers: Record<string, string>) {
    platformFetch({ 'https://api.kick.com/public/v1/channels': {} })
    await app.request(
      `${BASE}/api/stream/title`,
      { method: 'PATCH', headers, body: JSON.stringify({ title: 'Saved title' }) },
      env,
    )
    await app.request(
      `${BASE}/api/stream/category`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ picks: { kick: { id: '5', name: 'Elden Ring', imageUrl: null } } }),
      },
      env,
    )
  }

  it('keeps saved values on /api/me when Kick reads back offline zero-values', async () => {
    const { headers } = await seedSession({ kick: token('channel:write') })
    await saveTitleAndCategory(headers)

    platformFetch({ 'https://api.kick.com/public/v1/channels': offlineKick })
    const res = await app.request(`${BASE}/api/me`, { headers }, env)

    const body = (await res.json()) as MeResponse
    const kick = body.providers.find((p) => p.id === 'kick')!
    expect(kick.streamTitle).toBe('Saved title')
    expect(kick.category?.name).toBe('Elden Ring')
  })

  it('prefers platform-provided values over the remembered push', async () => {
    const { headers } = await seedSession({ kick: token('channel:write') })
    await saveTitleAndCategory(headers)

    platformFetch({
      'https://api.kick.com/public/v1/channels': {
        data: [
          {
            slug: 'streamer',
            stream_title: 'Live title',
            category: { id: 9, name: 'Just Chatting' },
            stream: { is_live: true },
          },
        ],
      },
    })
    const res = await app.request(`${BASE}/api/me`, { headers }, env)

    const body = (await res.json()) as MeResponse
    const kick = body.providers.find((p) => p.id === 'kick')!
    expect(kick.streamTitle).toBe('Live title')
    expect(kick.category?.name).toBe('Just Chatting')
  })
})

describe('history', () => {
  it('returns the empty shape before anything was saved', async () => {
    const { headers } = await seedSession({})
    const res = await app.request(`${BASE}/api/history`, { headers }, env)

    expect(await res.json()).toEqual({
      titles: [],
      categories: { twitch: [], kick: [], vkvideo: [] },
    })
  })

  it('pins a title and sorts pinned entries first', async () => {
    const { headers } = await seedSession({ twitch: token('channel:manage:broadcast') })
    platformFetch({
      'https://api.twitch.tv/helix/users': { data: [{ id: '42', display_name: 'S' }] },
      'https://api.twitch.tv/helix/channels': {},
    })

    await app.request(
      `${BASE}/api/stream/title`,
      { method: 'PATCH', headers, body: JSON.stringify({ title: 'First' }) },
      env,
    )
    await app.request(
      `${BASE}/api/stream/title`,
      { method: 'PATCH', headers, body: JSON.stringify({ title: 'Second' }) },
      env,
    )

    const before = (await (
      await app.request(`${BASE}/api/history`, { headers }, env)
    ).json()) as { titles: { id: string; text: string; pinned: boolean }[] }
    expect(before.titles.map((t) => t.text)).toEqual(['Second', 'First'])

    const first = before.titles.find((t) => t.text === 'First')!
    const res = await app.request(
      `${BASE}/api/history/title/pin`,
      { method: 'POST', headers, body: JSON.stringify({ id: first.id, pinned: true }) },
      env,
    )

    const after = (await res.json()) as { titles: { text: string; pinned: boolean }[] }
    expect(after.titles.map((t) => t.text)).toEqual(['First', 'Second'])
    expect(after.titles[0]!.pinned).toBe(true)
  })

  it('404s a pin for an unknown entry', async () => {
    const { headers } = await seedSession({})
    const res = await app.request(
      `${BASE}/api/history/title/pin`,
      { method: 'POST', headers, body: JSON.stringify({ id: 'nope', pinned: true }) },
      env,
    )
    expect(res.status).toBe(404)
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
