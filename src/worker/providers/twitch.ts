import type { AppEnv } from '../env'
import { OAuthError } from './oauth'
import type { Provider, ProviderStatus } from './types'

interface TwitchUser {
  id: string
  display_name: string
}

interface TwitchChannel {
  broadcaster_id: string
  title: string
  game_name: string
}

interface TwitchStream {
  id: string
}

interface HelixResponse<T> {
  data?: T[]
}

const HELIX = 'https://api.twitch.tv/helix'

/**
 * Twitch: plain authorization-code flow with a client secret, no PKCE.
 *
 * No scopes are requested. Reading a channel's title needs none, and asking for
 * permissions the app doesn't use is both a worse consent screen and a larger
 * blast radius if a token leaks.
 */
export const twitch: Provider = {
  id: 'twitch',
  label: 'Twitch',
  authorizeUrl: 'https://id.twitch.tv/oauth2/authorize',
  tokenUrl: 'https://id.twitch.tv/oauth2/token',
  scopes: [],
  scopeSeparator: ' ',
  clientAuth: 'body',
  usesPkce: false,
  refreshNeedsRedirectUri: false,

  credentials: (env: AppEnv) => ({
    clientId: env.TWITCH_CLIENT_ID,
    clientSecret: env.TWITCH_CLIENT_SECRET,
  }),

  async fetchStatus(accessToken: string, env: AppEnv): Promise<ProviderStatus> {
    // Twitch requires Client-Id alongside the bearer token on every Helix call.
    const headers = {
      authorization: `Bearer ${accessToken}`,
      'client-id': env.TWITCH_CLIENT_ID,
    }

    const user = await helix<TwitchUser>(`${HELIX}/users`, headers)
    if (!user) throw new OAuthError('Twitch returned no user for this token')

    // The title lives on the channel, which is keyed by the user's own id.
    const [channel, stream] = await Promise.all([
      helix<TwitchChannel>(`${HELIX}/channels?broadcaster_id=${user.id}`, headers),
      helix<TwitchStream>(`${HELIX}/streams?user_id=${user.id}`, headers),
    ])

    return {
      displayName: user.display_name,
      streamTitle: channel?.title || null,
      // /streams returns an entry only while actually broadcasting.
      isLive: stream !== null,
      category: channel?.game_name || null,
    }
  },
}

async function helix<T>(url: string, headers: Record<string, string>): Promise<T | null> {
  const response = await fetch(url, { headers })

  if (!response.ok) {
    throw new OAuthError(`Twitch API error`, response.status)
  }

  const body = (await response.json()) as HelixResponse<T>
  return body.data?.[0] ?? null
}
