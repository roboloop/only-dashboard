import type { ProviderState } from '../shared/types'
import type { AppEnv } from './env'
import { isExpired, OAuthError, refreshTokens } from './providers/oauth'
import type { OAuthTokens, Provider } from './providers/types'
import type { SessionData } from './session'

/**
 * Turns stored tokens into something the browser may see, refreshing them when
 * needed. Nothing here returns a token to the caller — only the display fields.
 */

export interface ResolvedProvider {
  state: ProviderState
  /** Tokens to persist back, when a refresh produced new ones. */
  tokens: OAuthTokens | null
  /** True when the connection is unrecoverable and should be dropped. */
  drop: boolean
}

function disconnected(provider: Provider, error: string | null = null): ResolvedProvider {
  return {
    state: {
      id: provider.id,
      label: provider.label,
      connected: false,
      displayName: null,
      streamTitle: null,
      isLive: false,
      category: null,
      error,
    },
    tokens: null,
    drop: error !== null,
  }
}

export async function resolveProvider(
  provider: Provider,
  session: SessionData,
  env: AppEnv,
  redirectUri: string,
): Promise<ResolvedProvider> {
  const stored = session.connections[provider.id]
  if (!stored) return disconnected(provider)

  let tokens = stored
  let refreshed = false

  // Refresh proactively when the token is at or near expiry, so the common case
  // costs one API call rather than a guaranteed 401 followed by a retry.
  if (isExpired(tokens)) {
    const next = await tryRefresh(provider, tokens, env, redirectUri)
    if (!next) return disconnected(provider, 'Session expired — reconnect to continue')
    tokens = next
    refreshed = true
  }

  try {
    const status = await provider.fetchStatus(tokens.accessToken, env)
    return { state: connected(provider, status), tokens: refreshed ? tokens : null, drop: false }
  } catch (error) {
    // A 401 despite a token we believed valid means it was revoked or expired
    // early. Worth exactly one refresh-and-retry.
    if (error instanceof OAuthError && error.status === 401 && !refreshed) {
      const next = await tryRefresh(provider, tokens, env, redirectUri)
      if (!next) return disconnected(provider, 'Access was revoked — reconnect to continue')

      try {
        const status = await provider.fetchStatus(next.accessToken, env)
        return { state: connected(provider, status), tokens: next, drop: false }
      } catch {
        return { ...disconnected(provider, `${provider.label} could not be reached`), drop: false }
      }
    }

    // Any other failure is the platform's problem, not a broken connection:
    // keep the tokens and surface it on that one card.
    return {
      state: {
        ...connected(provider, {
          displayName: null,
          streamTitle: null,
          isLive: false,
          category: null,
        }),
        error: `${provider.label} could not be reached`,
      },
      tokens: refreshed ? tokens : null,
      drop: false,
    }
  }
}

function connected(
  provider: Provider,
  status: {
    displayName: string | null
    streamTitle: string | null
    isLive: boolean
    category: string | null
  },
): ProviderState {
  return {
    id: provider.id,
    label: provider.label,
    connected: true,
    displayName: status.displayName,
    streamTitle: status.streamTitle,
    isLive: status.isLive,
    category: status.category,
    error: null,
  }
}

async function tryRefresh(
  provider: Provider,
  tokens: OAuthTokens,
  env: AppEnv,
  redirectUri: string,
): Promise<OAuthTokens | null> {
  if (!tokens.refreshToken) return null

  try {
    return await refreshTokens(provider, env, {
      refreshToken: tokens.refreshToken,
      redirectUri,
    })
  } catch {
    return null
  }
}
