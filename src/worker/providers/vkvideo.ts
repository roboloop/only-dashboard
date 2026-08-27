import type { AppEnv } from '../env'
import { OAuthError } from './oauth'
import type { Provider, ProviderStatus } from './types'

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
      category?: { title?: string } | null
    } | null
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
 * Reading a title needs no scopes. `channel:stream:settings` would be required
 * to *change* one via POST /v1/channel/stream/edit.
 */
export const vkvideo: Provider = {
  id: 'vkvideo',
  label: 'VK Video Live',
  authorizeUrl: 'https://auth.live.vkvideo.ru/app/oauth2/authorize',
  tokenUrl: `${API}/oauth/server/token`,
  revokeUrl: `${API}/oauth/server/revoke`,
  scopes: [],
  scopeSeparator: ',',
  clientAuth: 'basic',
  usesPkce: false,
  refreshNeedsRedirectUri: true,

  credentials: (env: AppEnv) => ({
    clientId: env.VKVIDEO_CLIENT_ID,
    clientSecret: env.VKVIDEO_CLIENT_SECRET,
  }),

  async fetchStatus(accessToken: string): Promise<ProviderStatus> {
    const headers = { authorization: `Bearer ${accessToken}`, accept: 'application/json' }

    // VK has no "my channel" shortcut: resolve the user's own channel url first,
    // then read the stream from it.
    const me = await vkGet<VkCurrentUser>(`${API}/v1/current_user`, headers)
    const channelUrl = me.data?.channel?.url
    const nick = me.data?.user?.nick ?? null

    if (!channelUrl) {
      // A VK account that has never streamed has no channel. That is a valid
      // state, not an error — report the identity and leave the title empty.
      return { displayName: nick, streamTitle: null, isLive: false, category: null }
    }

    const channel = await vkGet<VkChannel>(
      `${API}/v1/channel?channel_url=${encodeURIComponent(channelUrl)}`,
      headers,
    )

    return {
      displayName: channel.data?.channel?.nick ?? nick,
      streamTitle: channel.data?.stream?.title || null,
      isLive: channel.data?.stream?.status === 'started',
      category: channel.data?.stream?.category?.title || null,
    }
  },
}

async function vkGet<T>(url: string, headers: Record<string, string>): Promise<T> {
  const response = await fetch(url, { headers })

  if (!response.ok) {
    // VK error bodies are { error, error_description }; error_description is
    // explicitly documented as human-facing and not to be branched on.
    throw new OAuthError('VK Video API error', response.status)
  }

  return (await response.json()) as T
}
