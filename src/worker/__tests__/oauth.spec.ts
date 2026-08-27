import { describe, it, expect, vi, afterEach } from 'vitest'
import { createCodeChallenge, createCodeVerifier, base64UrlEncode } from '../crypto'
import { buildAuthorizeUrl, exchangeCode, refreshTokens } from '../providers/oauth'
import { PROVIDERS } from '../providers'
import type { AppEnv } from '../env'

const env = {
  TWITCH_CLIENT_ID: 'twitch-id',
  TWITCH_CLIENT_SECRET: 'twitch-secret',
  KICK_CLIENT_ID: 'kick-id',
  KICK_CLIENT_SECRET: 'kick-secret',
  VKVIDEO_CLIENT_ID: 'vk-id',
  VKVIDEO_CLIENT_SECRET: 'vk-secret',
} as AppEnv

const REDIRECT = 'http://localhost:5173/auth/twitch/callback'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PKCE', () => {
  it('derives an unpadded base64url SHA-256 challenge from the verifier', async () => {
    const verifier = 'test-verifier-value'
    const challenge = await createCodeChallenge(verifier)

    const expected = base64UrlEncode(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
    )

    expect(challenge).toBe(expected)
    expect(challenge).not.toMatch(/[+/=]/)
  })

  it('produces a verifier within the length the RFC allows', () => {
    const verifier = createCodeVerifier()
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(verifier.length).toBeLessThanOrEqual(128)
  })
})

describe('authorize URLs', () => {
  it('includes PKCE for Kick only', async () => {
    const challenge = await createCodeChallenge('v')

    const kick = new URL(
      buildAuthorizeUrl(PROVIDERS.kick, env, {
        redirectUri: REDIRECT,
        state: 's',
        codeChallenge: challenge,
      }),
    )
    const twitch = new URL(
      buildAuthorizeUrl(PROVIDERS.twitch, env, { redirectUri: REDIRECT, state: 's' }),
    )

    expect(kick.searchParams.get('code_challenge')).toBe(challenge)
    expect(kick.searchParams.get('code_challenge_method')).toBe('S256')
    expect(twitch.searchParams.has('code_challenge')).toBe(false)
  })

  it('omits scope entirely when a provider needs none', () => {
    const twitch = new URL(
      buildAuthorizeUrl(PROVIDERS.twitch, env, { redirectUri: REDIRECT, state: 's' }),
    )
    // scope= would request "no scopes" explicitly, which is not the same thing.
    expect(twitch.searchParams.has('scope')).toBe(false)
  })

  it('joins Kick scopes with spaces', () => {
    const url = new URL(
      buildAuthorizeUrl(PROVIDERS.kick, env, {
        redirectUri: REDIRECT,
        state: 's',
        codeChallenge: 'c',
      }),
    )
    expect(url.searchParams.get('scope')).toBe('user:read channel:read')
  })

  it('sends the state and redirect_uri it was given', () => {
    const url = new URL(
      buildAuthorizeUrl(PROVIDERS.twitch, env, { redirectUri: REDIRECT, state: 'abc123' }),
    )
    expect(url.searchParams.get('state')).toBe('abc123')
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT)
    expect(url.searchParams.get('response_type')).toBe('code')
  })

  it('refuses to build a PKCE provider URL without a challenge', () => {
    expect(() =>
      buildAuthorizeUrl(PROVIDERS.kick, env, { redirectUri: REDIRECT, state: 's' }),
    ).toThrow(/PKCE/)
  })
})

/** Captures the single fetch a token call makes, so its shape can be asserted. */
function captureTokenRequest(response: unknown = { access_token: 'a', expires_in: 3600 }) {
  const calls: { url: string; headers: Record<string, string>; body: URLSearchParams }[] = []

  const fetchMock = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: new URLSearchParams(String(init?.body ?? '')),
    })
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  return { calls, fetchMock: fetchMock as unknown as typeof fetch }
}

describe('token requests', () => {
  it('sends Twitch credentials in the body, with no Basic header', async () => {
    const { calls, fetchMock } = captureTokenRequest()
    vi.stubGlobal('fetch', fetchMock)

    await exchangeCode(PROVIDERS.twitch, env, { code: 'c', redirectUri: REDIRECT })

    const call = calls[0]!
    expect(call.body.get('client_id')).toBe('twitch-id')
    expect(call.body.get('client_secret')).toBe('twitch-secret')
    expect(call.headers.authorization).toBeUndefined()
  })

  it('sends VK credentials as HTTP Basic, with none in the body', async () => {
    const { calls, fetchMock } = captureTokenRequest()
    vi.stubGlobal('fetch', fetchMock)

    await exchangeCode(PROVIDERS.vkvideo, env, { code: 'c', redirectUri: REDIRECT })

    const call = calls[0]!
    expect(call.headers.authorization).toBe(`Basic ${btoa('vk-id:vk-secret')}`)
    expect(call.body.get('client_id')).toBeNull()
    expect(call.body.get('client_secret')).toBeNull()
  })

  it('includes code_verifier for Kick and not for Twitch', async () => {
    const { calls, fetchMock } = captureTokenRequest()
    vi.stubGlobal('fetch', fetchMock)

    await exchangeCode(PROVIDERS.kick, env, {
      code: 'c',
      redirectUri: REDIRECT,
      codeVerifier: 'verifier',
    })
    await exchangeCode(PROVIDERS.twitch, env, { code: 'c', redirectUri: REDIRECT })

    expect(calls[0]!.body.get('code_verifier')).toBe('verifier')
    expect(calls[1]!.body.get('code_verifier')).toBeNull()
  })

  it('sends redirect_uri when refreshing VK, but not Twitch', async () => {
    const { calls, fetchMock } = captureTokenRequest()
    vi.stubGlobal('fetch', fetchMock)

    await refreshTokens(PROVIDERS.vkvideo, env, { refreshToken: 'r', redirectUri: REDIRECT })
    await refreshTokens(PROVIDERS.twitch, env, { refreshToken: 'r', redirectUri: REDIRECT })

    expect(calls[0]!.body.get('redirect_uri')).toBe(REDIRECT)
    expect(calls[1]!.body.get('redirect_uri')).toBeNull()
  })

  it('keeps the previous refresh token when the provider does not rotate it', async () => {
    const { fetchMock } = captureTokenRequest({ access_token: 'new', expires_in: 3600 })
    vi.stubGlobal('fetch', fetchMock)

    const tokens = await refreshTokens(PROVIDERS.twitch, env, {
      refreshToken: 'original',
      redirectUri: REDIRECT,
    })

    expect(tokens.accessToken).toBe('new')
    expect(tokens.refreshToken).toBe('original')
  })

  it('converts expires_in into an absolute expiry', async () => {
    const { fetchMock } = captureTokenRequest({ access_token: 'a', expires_in: 100 })
    vi.stubGlobal('fetch', fetchMock)

    const before = Date.now()
    const tokens = await exchangeCode(PROVIDERS.twitch, env, { code: 'c', redirectUri: REDIRECT })

    expect(tokens.expiresAt).toBeGreaterThanOrEqual(before + 100_000)
  })

  it('does not put the error body into the thrown message', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response('{"error":"invalid_client","client_secret":"leaked"}', { status: 400 }),
    )

    await expect(
      exchangeCode(PROVIDERS.twitch, env, { code: 'c', redirectUri: REDIRECT }),
    ).rejects.toThrow(/^twitch token request failed$/)
  })
})
