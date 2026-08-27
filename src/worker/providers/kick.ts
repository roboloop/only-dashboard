import type { Category } from '../../shared/types'
import type { AppEnv } from '../env'
import { OAuthError } from './oauth'
import type { Provider, ProviderStatus, StreamPatch } from './types'

interface KickChannel {
  slug: string
  stream_title: string
  category?: { id: number; name: string; thumbnail?: string } | null
  stream?: { is_live: boolean } | null
}

interface KickCategory {
  id: number
  name: string
  thumbnail?: string
}

interface KickResponse<T> {
  data?: T[]
}

const API = 'https://api.kick.com/public/v1'

/**
 * Kick: authorization-code flow that requires *both* PKCE and a client secret.
 * It is the only one of the three that uses PKCE.
 */
export const kick: Provider = {
  id: 'kick',
  label: 'Kick',
  authorizeUrl: 'https://id.kick.com/oauth/authorize',
  tokenUrl: 'https://id.kick.com/oauth/token',
  scopes: ['user:read', 'channel:read', 'channel:write'],
  scopeSeparator: ' ',
  clientAuth: 'body',
  usesPkce: true,
  refreshNeedsRedirectUri: false,
  writeScopes: ['channel:write'],

  credentials: (env: AppEnv) => ({
    clientId: env.KICK_CLIENT_ID,
    clientSecret: env.KICK_CLIENT_SECRET,
  }),

  async fetchStatus(accessToken: string): Promise<ProviderStatus> {
    // Called with no query parameters, this returns the token holder's own
    // channel — so there is no separate identity lookup to do first.
    const channel = (await kickGet<KickChannel>(`${API}/channels`, accessToken))[0]
    if (!channel) throw new OAuthError('Kick returned no channel for this token')

    return {
      displayName: channel.slug || null,
      streamTitle: channel.stream_title || null,
      isLive: channel.stream?.is_live ?? false,
      // While offline, Kick zero-values the stream fields rather than nulling
      // them: category comes back as {id: 0, name: ""}. Id 0 means "none".
      category: channel.category?.id
        ? {
            id: String(channel.category.id),
            name: channel.category.name,
            imageUrl: channel.category.thumbnail || null,
          }
        : null,
      // Kick's console resolves the channel from the session, so the URL is
      // the same for every account.
      dashboardUrl: 'https://dashboard.kick.com/stream',
    }
  },

  async searchCategories(accessToken: string, _env: AppEnv, query: string): Promise<Category[]> {
    const url = `${API}/categories?q=${encodeURIComponent(query)}`
    const results = await kickGet<KickCategory>(url, accessToken)

    return results.map((category) => ({
      id: String(category.id),
      name: category.name,
      imageUrl: category.thumbnail || null,
    }))
  },

  async updateStream(accessToken: string, _env: AppEnv, patch: StreamPatch): Promise<void> {
    const body: Record<string, string | number> = {}
    if (patch.title !== undefined) body.stream_title = patch.title
    if (patch.category !== undefined) {
      const id = Number(patch.category.id)
      if (Number.isNaN(id)) throw new OAuthError('Kick category id is not numeric')
      body.category_id = id
    }

    const response = await fetch(`${API}/channels`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new OAuthError('Kick API error', response.status)
    }
  },
}

async function kickGet<T>(url: string, accessToken: string): Promise<T[]> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
  })

  if (!response.ok) {
    throw new OAuthError('Kick API error', response.status)
  }

  const body = (await response.json()) as KickResponse<T>
  return body.data ?? []
}
