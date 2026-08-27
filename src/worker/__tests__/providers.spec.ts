import { describe, it, expect, vi, afterEach } from 'vitest'
import { PROVIDERS } from '../providers'
import type { AppEnv } from '../env'

const env = {
  TWITCH_CLIENT_ID: 'twitch-id',
  TWITCH_CLIENT_SECRET: 'twitch-secret',
} as AppEnv

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Answers each URL from a map (longest prefix wins, so `/v1/channel` cannot
 * swallow `/v1/channel/stream/edit`), recording every request made.
 */
function routeFetch(routes: Record<string, unknown>) {
  const calls: { url: string; method: string; body: string | null }[] = []
  const mock = async (input: string | URL | Request, init?: RequestInit) => {
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

    return new Response(JSON.stringify(routes[match]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  vi.stubGlobal('fetch', mock as unknown as typeof fetch)
  return calls
}

describe('twitch fetchStatus', () => {
  it('reads the title from the channel and liveness from /streams', async () => {
    routeFetch({
      'https://api.twitch.tv/helix/users': {
        // The login is deliberately not the display name lowercased: the
        // dashboard url must follow the login.
        data: [{ id: '42', display_name: 'Streamer', login: 'streamer_tv' }],
      },
      'https://api.twitch.tv/helix/channels': {
        data: [
          {
            broadcaster_id: '42',
            title: 'Playing something',
            game_id: '743',
            game_name: 'Chess',
          },
        ],
      },
      'https://api.twitch.tv/helix/streams': { data: [{ id: 'live-1' }] },
      'https://api.twitch.tv/helix/games': {
        data: [{ id: '743', name: 'Chess', box_art_url: 'https://img/{width}x{height}.jpg' }],
      },
    })

    const status = await PROVIDERS.twitch.fetchStatus('token', env)

    expect(status).toEqual({
      displayName: 'Streamer',
      streamTitle: 'Playing something',
      isLive: true,
      category: { id: '743', name: 'Chess', imageUrl: 'https://img/68x90.jpg' },
      dashboardUrl: 'https://dashboard.twitch.tv/u/streamer_tv/stream-manager',
    })
  })

  it('reports offline when /streams returns nothing', async () => {
    routeFetch({
      'https://api.twitch.tv/helix/users': {
        // The login is deliberately not the display name lowercased: the
        // dashboard url must follow the login.
        data: [{ id: '42', display_name: 'Streamer', login: 'streamer_tv' }],
      },
      'https://api.twitch.tv/helix/channels': {
        data: [{ title: 'Offline title', game_id: '', game_name: '' }],
      },
      'https://api.twitch.tv/helix/streams': { data: [] },
    })

    const status = await PROVIDERS.twitch.fetchStatus('token', env)

    expect(status.isLive).toBe(false)
    expect(status.streamTitle).toBe('Offline title')
    expect(status.category).toBeNull()
  })

  it('sends both the bearer token and Client-Id', async () => {
    const headers: Record<string, string>[] = []
    vi.stubGlobal('fetch', (async (_url: string, init?: RequestInit) => {
      headers.push((init?.headers ?? {}) as Record<string, string>)
      return new Response(JSON.stringify({ data: [{ id: '1', display_name: 'x' }] }), {
        status: 200,
      })
    }) as unknown as typeof fetch)

    await PROVIDERS.twitch.fetchStatus('the-token', env)

    expect(headers[0]!.authorization).toBe('Bearer the-token')
    expect(headers[0]!['client-id']).toBe('twitch-id')
  })
})

describe('twitch categories and updates', () => {
  it('maps search results to shared categories', async () => {
    const calls = routeFetch({
      'https://api.twitch.tv/helix/search/categories': {
        data: [{ id: '1', name: 'Elden Ring', box_art_url: 'https://art/er.jpg' }],
      },
    })

    const results = await PROVIDERS.twitch.searchCategories('token', env, 'elden ring')

    expect(calls[0]!.url).toContain('query=elden%20ring')
    expect(results).toEqual([{ id: '1', name: 'Elden Ring', imageUrl: 'https://art/er.jpg' }])
  })

  it('PATCHes the channel keyed by the token holder’s own id', async () => {
    const calls = routeFetch({
      'https://api.twitch.tv/helix/users': {
        // The login is deliberately not the display name lowercased: the
        // dashboard url must follow the login.
        data: [{ id: '42', display_name: 'Streamer', login: 'streamer_tv' }],
      },
      'https://api.twitch.tv/helix/channels': {},
    })

    await PROVIDERS.twitch.updateStream('token', env, {
      title: 'New title',
      category: { id: '9', name: 'Chess', imageUrl: null },
    })

    const patch = calls.find((call) => call.method === 'PATCH')!
    expect(patch.url).toContain('broadcaster_id=42')
    expect(JSON.parse(patch.body!)).toEqual({ title: 'New title', game_id: '9' })
  })
})

describe('kick fetchStatus', () => {
  it('reads the authenticated user’s own channel with no query parameters', async () => {
    const calls = routeFetch({
      'https://api.kick.com/public/v1/channels': {
        data: [
          {
            slug: 'streamer',
            stream_title: 'Kick stream',
            category: { id: 5, name: 'Just Chatting', thumbnail: 'https://thumb.jpg' },
            stream: { is_live: true },
          },
        ],
      },
    })

    const status = await PROVIDERS.kick.fetchStatus('token', env)

    expect(calls[0]!.url).toBe('https://api.kick.com/public/v1/channels')
    expect(status).toEqual({
      displayName: 'streamer',
      streamTitle: 'Kick stream',
      isLive: true,
      category: { id: '5', name: 'Just Chatting', imageUrl: 'https://thumb.jpg' },
      dashboardUrl: 'https://dashboard.kick.com/stream',
    })
  })

  it('treats a missing stream object as offline', async () => {
    routeFetch({
      'https://api.kick.com/public/v1/channels': {
        data: [{ slug: 'streamer', stream_title: '', category: null, stream: null }],
      },
    })

    const status = await PROVIDERS.kick.fetchStatus('token', env)

    expect(status.isLive).toBe(false)
    expect(status.streamTitle).toBeNull()
  })

  it('treats offline zero-values as absent, not as category 0', async () => {
    // While offline, Kick returns Go zero values instead of nulls.
    routeFetch({
      'https://api.kick.com/public/v1/channels': {
        data: [
          {
            slug: 'streamer',
            stream_title: '',
            category: { id: 0, name: '', thumbnail: '' },
            stream: { is_live: false },
          },
        ],
      },
    })

    const status = await PROVIDERS.kick.fetchStatus('token', env)

    expect(status.streamTitle).toBeNull()
    expect(status.category).toBeNull()
  })
})

describe('kick categories and updates', () => {
  it('sends the category id as a number', async () => {
    const calls = routeFetch({ 'https://api.kick.com/public/v1/channels': {} })

    await PROVIDERS.kick.updateStream('token', env, {
      title: 'T',
      category: { id: '5', name: 'Just Chatting', imageUrl: null },
    })

    expect(calls[0]!.method).toBe('PATCH')
    expect(JSON.parse(calls[0]!.body!)).toEqual({ stream_title: 'T', category_id: 5 })
  })

  it('refuses a non-numeric category id instead of sending junk', async () => {
    routeFetch({ 'https://api.kick.com/public/v1/channels': {} })

    await expect(
      PROVIDERS.kick.updateStream('token', env, {
        category: { id: 'not-a-number', name: 'X', imageUrl: null },
      }),
    ).rejects.toThrow('Kick category id is not numeric')
  })
})

describe('vkvideo fetchStatus', () => {
  it('resolves the channel url from current_user, then reads the stream', async () => {
    const calls = routeFetch({
      'https://api.live.vkvideo.ru/v1/current_user': {
        data: { channel: { url: 'my-channel' }, user: { nick: 'Nick' } },
      },
      'https://api.live.vkvideo.ru/v1/channel': {
        data: {
          channel: { nick: 'Channel Nick' },
          stream: {
            title: 'VK stream',
            status: 'started',
            category: { id: 'g1', title: 'Games', type: 'game', cover_url: 'https://cover.jpg' },
          },
        },
      },
    })

    const status = await PROVIDERS.vkvideo.fetchStatus('token', env)

    expect(calls[1]!.url).toContain('channel_url=my-channel')
    expect(status).toEqual({
      displayName: 'Channel Nick',
      streamTitle: 'VK stream',
      isLive: true,
      category: { id: 'g1', name: 'Games', imageUrl: 'https://cover.jpg', kind: 'game' },
      // Keyed by the channel url, not the nick.
      dashboardUrl: 'https://live.vkvideo.ru/my-channel/studio',
    })
  })

  it('is offline for any status other than started', async () => {
    routeFetch({
      'https://api.live.vkvideo.ru/v1/current_user': {
        data: { channel: { url: 'c' }, user: { nick: 'Nick' } },
      },
      'https://api.live.vkvideo.ru/v1/channel': {
        data: { channel: { nick: 'Nick' }, stream: { title: 'Old', status: 'finished' } },
      },
    })

    expect((await PROVIDERS.vkvideo.fetchStatus('token', env)).isLive).toBe(false)
  })

  it('handles an account that has no channel yet', async () => {
    routeFetch({
      'https://api.live.vkvideo.ru/v1/current_user': {
        data: { channel: null, user: { nick: 'Viewer' } },
      },
    })

    const status = await PROVIDERS.vkvideo.fetchStatus('token', env)

    expect(status).toEqual({
      displayName: 'Viewer',
      streamTitle: null,
      isLive: false,
      category: null,
      // No channel means no studio to link to.
      dashboardUrl: null,
    })
  })

  it('url-encodes the channel url', async () => {
    const calls = routeFetch({
      'https://api.live.vkvideo.ru/v1/current_user': {
        data: { channel: { url: 'a b/c' }, user: { nick: 'n' } },
      },
      'https://api.live.vkvideo.ru/v1/channel': { data: { stream: { title: 't' } } },
    })

    await PROVIDERS.vkvideo.fetchStatus('token', env)

    expect(calls[1]!.url).toContain('channel_url=a%20b%2Fc')
  })
})

describe('vkvideo categories and updates', () => {
  it('searches both game and irl categories', async () => {
    const calls = routeFetch({
      'https://api.live.vkvideo.ru/v1/category/search': {
        data: { categories: [{ id: 'g1', title: 'Games', type: 'game', cover_url: '' }] },
      },
    })

    const results = await PROVIDERS.vkvideo.searchCategories('token', env, 'gam')

    expect(calls.map((call) => call.url).join(' ')).toContain('type=game')
    expect(calls.map((call) => call.url).join(' ')).toContain('type=irl')
    expect(results).toHaveLength(2)
    expect(results[0]).toEqual({ id: 'g1', name: 'Games', imageUrl: null, kind: 'game' })
  })

  it('preserves the current category when only the title changes', async () => {
    const calls = routeFetch({
      'https://api.live.vkvideo.ru/v1/current_user': {
        data: { channel: { url: 'my-channel' }, user: { nick: 'n' } },
      },
      'https://api.live.vkvideo.ru/v1/channel/stream/edit': {},
      'https://api.live.vkvideo.ru/v1/channel': {
        data: {
          stream: {
            title: 'Old title',
            status: 'started',
            category: { id: 'c1', title: 'IRL Walk', type: 'irl', cover_url: '' },
          },
        },
      },
    })

    await PROVIDERS.vkvideo.updateStream('token', env, { title: 'New title' })

    const edit = calls.find((call) => call.url.includes('/stream/edit'))!
    const body = JSON.parse(edit.body!) as {
      stream: { title: string; category: { id: string } }
    }
    expect(body.stream.title).toBe('New title')
    expect(body.stream.category.id).toBe('c1')
  })
})
