import type { Category } from '../../shared/types'
import type { AppEnv } from '../env'
import { OAuthError } from './oauth'
import type { Provider, ProviderStatus, StreamPatch } from './types'

interface TwitchUser {
  id: string
  display_name: string
  /** The URL-safe channel name. Not always `display_name` lowercased. */
  login: string
}

interface TwitchChannel {
  broadcaster_id: string
  title: string
  game_id: string
  game_name: string
}

interface TwitchStream {
  id: string
}

interface TwitchGame {
  id: string
  name: string
  /** Template URL containing literal `{width}x{height}` placeholders. */
  box_art_url: string
}

interface TwitchCategory {
  id: string
  name: string
  box_art_url: string
}

interface HelixResponse<T> {
  data?: T[]
}

const HELIX = 'https://api.twitch.tv/helix'

/** The 34×45 thumbnails render crisply from a 68×90 source. */
const BOX_ART_SIZE = '68x90'

/**
 * Twitch: plain authorization-code flow with a client secret, no PKCE.
 *
 * `channel:manage:broadcast` covers both reading and modifying the channel's
 * title and category via PATCH /helix/channels.
 */
export const twitch: Provider = {
  id: 'twitch',
  label: 'Twitch',
  authorizeUrl: 'https://id.twitch.tv/oauth2/authorize',
  tokenUrl: 'https://id.twitch.tv/oauth2/token',
  scopes: ['channel:manage:broadcast'],
  scopeSeparator: ' ',
  clientAuth: 'body',
  usesPkce: false,
  refreshNeedsRedirectUri: false,
  writeScopes: ['channel:manage:broadcast'],

  credentials: (env: AppEnv) => ({
    clientId: env.TWITCH_CLIENT_ID,
    clientSecret: env.TWITCH_CLIENT_SECRET,
  }),

  async fetchStatus(accessToken: string, env: AppEnv): Promise<ProviderStatus> {
    const headers = helixHeaders(accessToken, env)

    const user = await helixFirst<TwitchUser>(`${HELIX}/users`, headers)
    if (!user) throw new OAuthError('Twitch returned no user for this token')

    // The title lives on the channel, which is keyed by the user's own id.
    const [channel, stream] = await Promise.all([
      helixFirst<TwitchChannel>(`${HELIX}/channels?broadcaster_id=${user.id}`, headers),
      helixFirst<TwitchStream>(`${HELIX}/streams?user_id=${user.id}`, headers),
    ])

    // The channel carries only the game's id and name; box art needs /games.
    let category: Category | null = null
    if (channel?.game_id) {
      const game = await helixFirst<TwitchGame>(`${HELIX}/games?id=${channel.game_id}`, headers)
      category = {
        id: channel.game_id,
        name: channel.game_name,
        imageUrl: game?.box_art_url.replace('{width}x{height}', BOX_ART_SIZE) || null,
      }
    }

    return {
      displayName: user.display_name,
      streamTitle: channel?.title || null,
      // /streams returns an entry only while actually broadcasting.
      isLive: stream !== null,
      category,
      dashboardUrl: `https://dashboard.twitch.tv/u/${encodeURIComponent(user.login)}/stream-manager`,
    }
  },

  async searchCategories(accessToken: string, env: AppEnv, query: string): Promise<Category[]> {
    const headers = helixHeaders(accessToken, env)
    const url = `${HELIX}/search/categories?query=${encodeURIComponent(query)}&first=10`
    const results = await helixAll<TwitchCategory>(url, headers)

    return results.map((category) => ({
      id: category.id,
      name: category.name,
      imageUrl: category.box_art_url || null,
    }))
  },

  async updateStream(accessToken: string, env: AppEnv, patch: StreamPatch): Promise<void> {
    const headers = helixHeaders(accessToken, env)

    const user = await helixFirst<TwitchUser>(`${HELIX}/users`, headers)
    if (!user) throw new OAuthError('Twitch returned no user for this token')

    const body: Record<string, string> = {}
    if (patch.title !== undefined) body.title = patch.title
    if (patch.category !== undefined) body.game_id = patch.category.id

    const response = await fetch(`${HELIX}/channels?broadcaster_id=${user.id}`, {
      method: 'PATCH',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new OAuthError('Twitch API error', response.status)
    }
  },
}

/** Twitch requires Client-Id alongside the bearer token on every Helix call. */
function helixHeaders(accessToken: string, env: AppEnv): Record<string, string> {
  return {
    authorization: `Bearer ${accessToken}`,
    'client-id': env.TWITCH_CLIENT_ID,
  }
}

async function helixAll<T>(url: string, headers: Record<string, string>): Promise<T[]> {
  const response = await fetch(url, { headers })

  if (!response.ok) {
    throw new OAuthError(`Twitch API error`, response.status)
  }

  const body = (await response.json()) as HelixResponse<T>
  return body.data ?? []
}

async function helixFirst<T>(url: string, headers: Record<string, string>): Promise<T | null> {
  const results = await helixAll<T>(url, headers)
  return results[0] ?? null
}
