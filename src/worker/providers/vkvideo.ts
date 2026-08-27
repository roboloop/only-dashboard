import type { Category } from '../../shared/types'
import type { AppEnv } from '../env'
import { OAuthError } from './oauth'
import type { Provider, ProviderStatus, StreamPatch } from './types'

interface VkCategory {
  id?: string
  title?: string
  type?: string
  cover_url?: string
}

interface VkCurrentUser {
  data?: {
    channel?: { url?: string } | null
    user?: { nick?: string } | null
  }
}

interface VkChannel {
  data?: {
    channel?: { nick?: string } | null
    stream?: {
      title?: string
      status?: string
      category?: VkCategory | null
    } | null
  }
}

interface VkCategorySearch {
  data?: {
    categories?: VkCategory[]
  }
}

const API = 'https://api.live.vkvideo.ru'

/**
 * VK Video Live. Three things differ from the other two platforms:
 *
 *  - the client authenticates with an HTTP Basic header, not body parameters;
 *  - scopes are comma-separated rather than space-separated;
 *  - `redirect_uri` is required on refresh as well as on the initial exchange.
 *
 * `channel:stream:settings` is required to change the stream via
 * POST /v1/channel/stream/edit; reading needs no scopes.
 */
export const vkvideo: Provider = {
  id: 'vkvideo',
  label: 'VK Video Live',
  authorizeUrl: 'https://auth.live.vkvideo.ru/app/oauth2/authorize',
  tokenUrl: `${API}/oauth/server/token`,
  revokeUrl: `${API}/oauth/server/revoke`,
  scopes: ['channel:stream:settings'],
  scopeSeparator: ',',
  clientAuth: 'basic',
  usesPkce: false,
  refreshNeedsRedirectUri: true,
  writeScopes: ['channel:stream:settings'],

  credentials: (env: AppEnv) => ({
    clientId: env.VKVIDEO_CLIENT_ID,
    clientSecret: env.VKVIDEO_CLIENT_SECRET,
  }),

  async fetchStatus(accessToken: string): Promise<ProviderStatus> {
    // VK has no "my channel" shortcut: resolve the user's own channel url first,
    // then read the stream from it.
    const me = await vkGet<VkCurrentUser>(`${API}/v1/current_user`, accessToken)
    const channelUrl = me.data?.channel?.url
    const nick = me.data?.user?.nick ?? null

    if (!channelUrl) {
      // A VK account that has never streamed has no channel. That is a valid
      // state, not an error — report the identity and leave the title empty.
      return { displayName: nick, streamTitle: null, isLive: false, category: null }
    }

    const channel = await vkGet<VkChannel>(
      `${API}/v1/channel?channel_url=${encodeURIComponent(channelUrl)}`,
      accessToken,
    )
    const stream = channel.data?.stream

    return {
      displayName: channel.data?.channel?.nick ?? nick,
      streamTitle: stream?.title || null,
      isLive: stream?.status === 'started',
      category: toCategory(stream?.category),
    }
  },

  async searchCategories(accessToken: string, _env: AppEnv, query: string): Promise<Category[]> {
    // `type` is a required parameter, so both kinds take a request each.
    const [games, irl] = await Promise.all(
      (['game', 'irl'] as const).map((type) =>
        vkGet<VkCategorySearch>(
          `${API}/v1/category/search?query=${encodeURIComponent(query)}&type=${type}&limit=10`,
          accessToken,
        ),
      ),
    )

    return [...(games?.data?.categories ?? []), ...(irl?.data?.categories ?? [])]
      .map(toCategory)
      .filter((category): category is Category => category !== null)
  },

  async updateStream(accessToken: string, _env: AppEnv, patch: StreamPatch): Promise<void> {
    const me = await vkGet<VkCurrentUser>(`${API}/v1/current_user`, accessToken)
    const channelUrl = me.data?.channel?.url
    if (!channelUrl) {
      throw new OAuthError('This VK account has no channel yet')
    }

    // The edit endpoint's partial-update semantics are not documented, so read
    // the current stream and always send both fields: a title-only save must
    // not clear the category, nor the other way around.
    const channel = await vkGet<VkChannel>(
      `${API}/v1/channel?channel_url=${encodeURIComponent(channelUrl)}`,
      accessToken,
    )
    const current = channel.data?.stream

    const stream: Record<string, unknown> = {}
    const title = patch.title ?? current?.title
    if (title !== undefined) stream.title = title

    const category = patch.category
      ? {
          id: patch.category.id,
          title: patch.category.name,
          type: patch.category.kind ?? 'game',
          cover_url: patch.category.imageUrl ?? '',
        }
      : current?.category
    if (category) stream.category = category

    const response = await fetch(
      `${API}/v1/channel/stream/edit?channel_url=${encodeURIComponent(channelUrl)}`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ stream }),
      },
    )

    if (!response.ok) {
      throw new OAuthError('VK Video API error', response.status)
    }
  },
}

function toCategory(raw: VkCategory | null | undefined): Category | null {
  if (!raw?.id || !raw.title) return null

  return {
    id: raw.id,
    name: raw.title,
    imageUrl: raw.cover_url || null,
    kind: raw.type === 'irl' ? 'irl' : 'game',
  }
}

async function vkGet<T>(url: string, accessToken: string): Promise<T> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
  })

  if (!response.ok) {
    // VK error bodies are { error, error_description }; error_description is
    // explicitly documented as human-facing and not to be branched on.
    throw new OAuthError('VK Video API error', response.status)
  }

  return (await response.json()) as T
}
