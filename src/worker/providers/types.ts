import type { ProviderId } from '../../shared/types'
import type { AppEnv } from '../env'

/** What a provider can tell us about the user's current stream. */
export interface ProviderStatus {
  displayName: string | null
  streamTitle: string | null
  isLive: boolean
  category: string | null
}

/** Tokens as we persist them. `expiresAt` is absolute so it survives storage. */
export interface OAuthTokens {
  accessToken: string
  refreshToken: string | null
  /** Epoch milliseconds. */
  expiresAt: number
  scope: string | null
}

/**
 * The differences between the three platforms are all data, not code — see the
 * table in the README. Only `fetchStatus` is genuinely bespoke per provider.
 */
export interface Provider {
  id: ProviderId
  label: string
  authorizeUrl: string
  tokenUrl: string
  scopes: string[]
  /**
   * Twitch and Kick take space-delimited scopes (the OAuth 2.0 default); VK
   * takes them comma-delimited.
   */
  scopeSeparator: ' ' | ','
  /**
   * How the client authenticates to the token endpoint: credentials in the form
   * body (Twitch, Kick) or an HTTP Basic header (VK).
   */
  clientAuth: 'body' | 'basic'
  /** Only Kick requires PKCE. */
  usesPkce: boolean
  /**
   * VK alone requires `redirect_uri` on the refresh call as well as the initial
   * exchange. Omitting it there fails only once a token expires, so it is worth
   * carrying as an explicit flag rather than always sending the parameter.
   */
  refreshNeedsRedirectUri: boolean
  /** Optional RFC 7009-style revocation, used on disconnect where available. */
  revokeUrl?: string
  credentials(env: AppEnv): { clientId: string; clientSecret: string }
  fetchStatus(accessToken: string, env: AppEnv): Promise<ProviderStatus>
}

/** Raw token endpoint response, common to all three platforms. */
export interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
  scope?: string
}
