import type { AppEnv } from '../env'
import { OAuthError } from './oauth'
import type { Provider, ProviderStatus } from './types'

interface KickChannel {
  slug: string
  stream_title: string
  category?: { name: string } | null
  stream?: { is_live: boolean } | null
}

interface KickResponse {
  data?: KickChannel[]
}

/**
 * Kick: authorization-code flow that requires *both* PKCE and a client secret.
 * It is the only one of the three that uses PKCE.
 */
export const kick: Provider = {
  id: 'kick',
  label: 'Kick',
  authorizeUrl: 'https://id.kick.com/oauth/authorize',
  tokenUrl: 'https://id.kick.com/oauth/token',
  scopes: ['user:read', 'channel:read'],
  scopeSeparator: ' ',
  clientAuth: 'body',
  usesPkce: true,
  refreshNeedsRedirectUri: false,

  credentials: (env: AppEnv) => ({
    clientId: env.KICK_CLIENT_ID,
    clientSecret: env.KICK_CLIENT_SECRET,
  }),

  async fetchStatus(accessToken: string): Promise<ProviderStatus> {
    // Called with no query parameters, this returns the token holder's own
    // channel — so there is no separate identity lookup to do first.
    const response = await fetch('https://api.kick.com/public/v1/channels', {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    })

    if (!response.ok) {
      throw new OAuthError('Kick API error', response.status)
    }

    const body = (await response.json()) as KickResponse
    const channel = body.data?.[0]
    if (!channel) throw new OAuthError('Kick returned no channel for this token')

    return {
      displayName: channel.slug || null,
      streamTitle: channel.stream_title || null,
      isLive: channel.stream?.is_live ?? false,
      category: channel.category?.name || null,
    }
  },
}
