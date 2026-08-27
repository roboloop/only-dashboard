/**
 * Response shapes shared by the Worker (src/worker) and the Vue app (src/views,
 * src/composables). Both sides import from here so the two can't drift apart.
 *
 * Nothing in this file may describe a token: it is, by construction, the set of
 * things the browser is allowed to see.
 */

export interface HealthResponse {
  ok: true
  ts: number
}

export const PROVIDER_IDS = ['twitch', 'kick', 'vkvideo'] as const

export type ProviderId = (typeof PROVIDER_IDS)[number]

/** What one platform card renders. */
export interface ProviderState {
  id: ProviderId
  label: string
  connected: boolean
  /** The account name on that platform, once connected. */
  displayName: string | null
  /** The current stream title. Null when connected but the platform has none set. */
  streamTitle: string | null
  isLive: boolean
  /** Category / game, where the platform exposes one. */
  category: string | null
  /** Set when the platform was reachable but this provider's lookup failed. */
  error: string | null
}

export interface MeResponse {
  providers: ProviderState[]
  fetchedAt: number
}

export interface ApiError {
  error: string
}
