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

/**
 * A category as one platform knows it. Ids are platform-native and only
 * meaningful on the platform that produced them (Kick's numeric id arrives
 * stringified).
 */
export interface Category {
  id: string
  name: string
  /** Box art / cover; null renders the striped placeholder. */
  imageUrl: string | null
  /** VK distinguishes game and IRL categories and wants the value echoed back on save. */
  kind?: 'game' | 'irl'
}

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
  category: Category | null
  /**
   * Connected, but the stored token predates the write scopes — saves would
   * fail until the user reconnects.
   */
  needsReauth: boolean
  /** Set when the platform was reachable but this provider's lookup failed. */
  error: string | null
}

export interface MeResponse {
  providers: ProviderState[]
  fetchedAt: number
}

export interface UpdateTitleRequest {
  title: string
}

/** One clicked category per platform; a platform the user skipped is absent. */
export interface UpdateCategoryRequest {
  picks: Partial<Record<ProviderId, Category>>
}

/** The result of one platform's save. Failures are per-platform, never global. */
export interface SaveOutcome {
  id: ProviderId
  ok: boolean
  /** Human-facing message shown inline on that platform's card. */
  error: string | null
  /** The connection was dropped (e.g. revoked token) — the card flips to CONNECT. */
  disconnected: boolean
}

export interface SaveResponse {
  results: SaveOutcome[]
  fetchedAt: number
}

export interface CategorySearchResponse {
  results: Partial<Record<ProviderId, Category[]>>
  errors: Partial<Record<ProviderId, string>>
}

export interface TitleHistoryEntry {
  id: string
  text: string
  pinned: boolean
  at: number
}

export interface CategoryHistoryEntry {
  category: Category
  pinned: boolean
  at: number
}

export interface HistoryResponse {
  titles: TitleHistoryEntry[]
  categories: Record<ProviderId, CategoryHistoryEntry[]>
}

export interface PinTitleRequest {
  id: string
  pinned: boolean
}

export interface PinCategoryRequest {
  provider: ProviderId
  categoryId: string
  pinned: boolean
}

export interface ApiError {
  error: string
}
