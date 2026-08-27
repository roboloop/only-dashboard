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

/** Answers each URL from a map, so multi-call providers can be exercised. */
function routeFetch(routes: Record<string, unknown>) {
  const seen: string[] = []
  const mock = async (input: string | URL | Request) => {
    const url = String(input)
    seen.push(url)

    const match = Object.keys(routes).find((key) => url.startsWith(key))
    if (!match) return new Response('{}', { status: 404 })

    return new Response(JSON.stringify(routes[match]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  vi.stubGlobal('fetch', mock as unknown as typeof fetch)
  return seen
}

describe('twitch fetchStatus', () => {
  it('reads the title from the channel and liveness from /streams', async () => {
    routeFetch({
      'https://api.twitch.tv/helix/users': { data: [{ id: '42', display_name: 'Streamer' }] },
      'https://api.twitch.tv/helix/channels': {
        data: [{ broadcaster_id: '42', title: 'Playing something', game_name: 'Chess' }],
      },
      'https://api.twitch.tv/helix/streams': { data: [{ id: 'live-1' }] },
    })

    const status = await PROVIDERS.twitch.fetchStatus('token', env)

    expect(status).toEqual({
      displayName: 'Streamer',
      streamTitle: 'Playing something',
      isLive: true,
      category: 'Chess',
    })
  })

  it('reports offline when /streams returns nothing', async () => {
    routeFetch({
      'https://api.twitch.tv/helix/users': { data: [{ id: '42', display_name: 'Streamer' }] },
      'https://api.twitch.tv/helix/channels': { data: [{ title: 'Offline title', game_name: '' }] },
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

describe('kick fetchStatus', () => {
  it('reads the authenticated user’s own channel with no query parameters', async () => {
    const seen = routeFetch({
      'https://api.kick.com/public/v1/channels': {
        data: [
          {
            slug: 'streamer',
            stream_title: 'Kick stream',
            category: { name: 'Just Chatting' },
            stream: { is_live: true },
          },
        ],
      },
    })

    const status = await PROVIDERS.kick.fetchStatus('token', env)

    expect(seen[0]).toBe('https://api.kick.com/public/v1/channels')
    expect(status).toEqual({
      displayName: 'streamer',
      streamTitle: 'Kick stream',
      isLive: true,
      category: 'Just Chatting',
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
})

describe('vkvideo fetchStatus', () => {
  it('resolves the channel url from current_user, then reads the stream', async () => {
    const seen = routeFetch({
      'https://api.live.vkvideo.ru/v1/current_user': {
        data: { channel: { url: 'my-channel' }, user: { nick: 'Nick' } },
      },
      'https://api.live.vkvideo.ru/v1/channel': {
        data: {
          channel: { nick: 'Channel Nick' },
          stream: { title: 'VK stream', status: 'started', category: { title: 'Games' } },
        },
      },
    })

    const status = await PROVIDERS.vkvideo.fetchStatus('token', env)

    expect(seen[1]).toContain('channel_url=my-channel')
    expect(status).toEqual({
      displayName: 'Channel Nick',
      streamTitle: 'VK stream',
      isLive: true,
      category: 'Games',
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
    })
  })

  it('url-encodes the channel url', async () => {
    const seen = routeFetch({
      'https://api.live.vkvideo.ru/v1/current_user': {
        data: { channel: { url: 'a b/c' }, user: { nick: 'n' } },
      },
      'https://api.live.vkvideo.ru/v1/channel': { data: { stream: { title: 't' } } },
    })

    await PROVIDERS.vkvideo.fetchStatus('token', env)

    expect(seen[1]).toContain('channel_url=a%20b%2Fc')
  })
})
