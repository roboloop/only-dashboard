import type { ProviderState } from '../shared/types'
import type { AppEnv } from './env'
import { hasWriteScopes, isExpired, OAuthError, refreshTokens } from './providers/oauth'
import type { OAuthTokens, Provider, ProviderStatus } from './providers/types'
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

/** The outcome of one platform call made through `withFreshTokens`. */
export interface FreshCallResult<T> {
  /** The call's return value; null when it failed. */
  result: T | null
  /** Tokens to persist back, when a refresh produced new ones. */
  tokens: OAuthTokens | null
  /** True when the connection is unrecoverable and should be dropped. */
  drop: boolean
  /** Human-facing message when the call did not succeed. */
  error: string | null
}

/**
 * Runs one platform call with the stored tokens, owning the refresh policy:
 * a proactive refresh when the token is at or near expiry, and exactly one
 * refresh-and-retry on an unexpected 401. Both the status fan-out and the
 * write endpoints go through here so the policy exists once.
 */
export async function withFreshTokens<T>(
  provider: Provider,
  session: SessionData,
  env: AppEnv,
  redirectUri: string,
  fn: (accessToken: string) => Promise<T>,
): Promise<FreshCallResult<T>> {
  const stored = session.connections[provider.id]
  if (!stored) {
    return { result: null, tokens: null, drop: false, error: 'Not connected' }
  }

  let tokens = stored
  let refreshed = false

  // Refresh proactively when the token is at or near expiry, so the common case
  // costs one API call rather than a guaranteed 401 followed by a retry.
  if (isExpired(tokens)) {
    const next = await tryRefresh(provider, tokens, env, redirectUri)
    if (!next) {
      return {
        result: null,
        tokens: null,
        drop: true,
        error: 'Session expired — reconnect to continue',
      }
    }
    tokens = next
    refreshed = true
  }

  try {
    const result = await fn(tokens.accessToken)
    return { result, tokens: refreshed ? tokens : null, drop: false, error: null }
  } catch (error) {
    // A 401 despite a token we believed valid means it was revoked or expired
    // early. Worth exactly one refresh-and-retry.
    if (error instanceof OAuthError && error.status === 401 && !refreshed) {
      const next = await tryRefresh(provider, tokens, env, redirectUri)
      if (!next) {
        return {
          result: null,
          tokens: null,
          drop: true,
          error: 'Access was revoked — reconnect to continue',
        }
      }

      try {
        const result = await fn(next.accessToken)
        return { result, tokens: next, drop: false, error: null }
      } catch {
        return {
          result: null,
          tokens: next,
          drop: false,
          error: `${provider.label} could not be reached`,
        }
      }
    }

    // Any other failure is the platform's problem, not a broken connection:
    // keep the tokens and surface it on that one call.
    return {
      result: null,
      tokens: refreshed ? tokens : null,
      drop: false,
      error: `${provider.label} could not be reached`,
    }
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

  const call = await withFreshTokens(provider, session, env, redirectUri, (accessToken) =>
    provider.fetchStatus(accessToken, env),
  )

  if (call.drop) {
    return { ...disconnected(provider, call.error), drop: true }
  }

  const needsReauth = !hasWriteScopes(provider, call.tokens ?? stored)

  if (!call.result) {
    return {
      state: withLastPushed(
        {
          ...connected(provider, {
            displayName: null,
            streamTitle: null,
            isLive: false,
            category: null,
          }),
          needsReauth,
          error: call.error,
        },
        session,
      ),
      tokens: call.tokens,
      drop: false,
    }
  }

  return {
    state: withLastPushed({ ...connected(provider, call.result), needsReauth }, session),
    tokens: call.tokens,
    drop: false,
  }
}

/**
 * Fills stream fields a platform read back empty from what this app last
 * successfully wrote there. Kick zero-values title and category while the
 * channel is offline, even though the write took — without this, every status
 * refresh would wipe a freshly saved title off that card. Platform-provided
 * values always win; this only fills nulls.
 */
function withLastPushed(state: ProviderState, session: SessionData): ProviderState {
  const pushed = session.lastPushed?.[state.id]
  if (!pushed) return state

  return {
    ...state,
    streamTitle: state.streamTitle ?? pushed.title ?? null,
    category: state.category ?? pushed.category ?? null,
  }
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
      needsReauth: false,
      error,
    },
    tokens: null,
    drop: error !== null,
  }
}

function connected(provider: Provider, status: ProviderStatus): ProviderState {
  return {
    id: provider.id,
    label: provider.label,
    connected: true,
    displayName: status.displayName,
    streamTitle: status.streamTitle,
    isLive: status.isLive,
    category: status.category,
    needsReauth: false,
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
