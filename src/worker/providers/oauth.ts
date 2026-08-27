import { basicAuthHeader } from '../crypto'
import type { AppEnv } from '../env'
import type { OAuthTokens, Provider, TokenResponse } from './types'

/**
 * The provider-agnostic half of the OAuth flow. Everything that varies between
 * Twitch, Kick and VK is read off the Provider record rather than branched on
 * by name, so adding a platform means adding data, not editing this file.
 */

/** Treat a token as expired slightly early, so a call never races the clock. */
const EXPIRY_SKEW_MS = 60_000

/** Providers that omit `expires_in` are assumed to last an hour. */
const DEFAULT_LIFETIME_SECONDS = 3600

export class OAuthError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'OAuthError'
  }
}

export function buildAuthorizeUrl(
  provider: Provider,
  env: AppEnv,
  params: { redirectUri: string; state: string; codeChallenge?: string },
): string {
  const { clientId } = provider.credentials(env)
  const url = new URL(provider.authorizeUrl)

  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', params.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('state', params.state)

  // An empty scope list means "no permissions beyond identity", which is what
  // Twitch and VK need to read a title. Sending scope= would be wrong, not just
  // redundant, so omit the parameter entirely.
  if (provider.scopes.length > 0) {
    url.searchParams.set('scope', provider.scopes.join(provider.scopeSeparator))
  }

  if (provider.usesPkce) {
    if (!params.codeChallenge) {
      throw new OAuthError(`${provider.id} requires PKCE but no code challenge was supplied`)
    }
    url.searchParams.set('code_challenge', params.codeChallenge)
    url.searchParams.set('code_challenge_method', 'S256')
  }

  return url.toString()
}

export async function exchangeCode(
  provider: Provider,
  env: AppEnv,
  params: { code: string; redirectUri: string; codeVerifier?: string },
): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
  })

  if (provider.usesPkce) {
    if (!params.codeVerifier) {
      throw new OAuthError(`${provider.id} requires PKCE but no code verifier was stored`)
    }
    body.set('code_verifier', params.codeVerifier)
  }

  return requestToken(provider, env, body)
}

export async function refreshTokens(
  provider: Provider,
  env: AppEnv,
  params: { refreshToken: string; redirectUri: string },
): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
  })

  if (provider.refreshNeedsRedirectUri) {
    body.set('redirect_uri', params.redirectUri)
  }

  const tokens = await requestToken(provider, env, body)

  // Some providers rotate the refresh token, others return only a new access
  // token. Keep the previous one rather than dropping the connection.
  return { ...tokens, refreshToken: tokens.refreshToken ?? params.refreshToken }
}

export async function revokeToken(
  provider: Provider,
  env: AppEnv,
  token: string,
  hint: 'access_token' | 'refresh_token',
): Promise<void> {
  if (!provider.revokeUrl) return

  const { clientId, clientSecret } = provider.credentials(env)
  const body = new URLSearchParams({ token, token_type_hint: hint })

  await fetch(provider.revokeUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: basicAuthHeader(clientId, clientSecret),
    },
    body,
  })
}

/** Applies the provider's client-authentication style and parses the response. */
async function requestToken(
  provider: Provider,
  env: AppEnv,
  body: URLSearchParams,
): Promise<OAuthTokens> {
  const { clientId, clientSecret } = provider.credentials(env)
  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
    accept: 'application/json',
  }

  if (provider.clientAuth === 'basic') {
    headers.authorization = basicAuthHeader(clientId, clientSecret)
  } else {
    body.set('client_id', clientId)
    body.set('client_secret', clientSecret)
  }

  const response = await fetch(provider.tokenUrl, { method: 'POST', headers, body })
  const text = await response.text()

  if (!response.ok) {
    // Deliberately does not include the body: token endpoints echo back request
    // parameters on error, and this string reaches the logs.
    throw new OAuthError(`${provider.id} token request failed`, response.status)
  }

  let parsed: TokenResponse
  try {
    parsed = JSON.parse(text) as TokenResponse
  } catch {
    throw new OAuthError(`${provider.id} returned a non-JSON token response`)
  }

  if (!parsed.access_token) {
    throw new OAuthError(`${provider.id} token response contained no access_token`)
  }

  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token ?? null,
    expiresAt: Date.now() + (parsed.expires_in ?? DEFAULT_LIFETIME_SECONDS) * 1000,
    scope: parsed.scope ?? null,
  }
}

export function isExpired(tokens: OAuthTokens, now = Date.now()): boolean {
  return tokens.expiresAt - EXPIRY_SKEW_MS <= now
}
