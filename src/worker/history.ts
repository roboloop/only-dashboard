import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import type {
  Category,
  CategoryHistoryEntry,
  HistoryResponse,
  ProviderId,
  TitleHistoryEntry,
} from '../shared/types'
import { PROVIDER_IDS } from '../shared/types'
import type { AppEnv } from './env'
import { SESSION_COOKIE } from './session'

/**
 * Title and category history live in KV next to the session, keyed by the same
 * sid — the browser holds nothing. Entries are deduplicated (re-saving a title
 * moves it up rather than repeating it) and unpinned entries are capped so the
 * record cannot grow without bound.
 */

const HISTORY_TTL_SECONDS = 60 * 60 * 24 * 30 // matches the session's lifetime
const MAX_UNPINNED_TITLES = 10
const MAX_UNPINNED_CATEGORIES = 10

const historyKey = (sid: string) => `history:${sid}`

export function emptyHistory(): HistoryResponse {
  return {
    titles: [],
    categories: { twitch: [], kick: [], vkvideo: [] },
  }
}

export async function readHistory(c: Context<{ Bindings: AppEnv }>): Promise<HistoryResponse> {
  const sid = getCookie(c, SESSION_COOKIE)
  if (!sid) return emptyHistory()

  const stored = await c.env.SESSIONS.get<Partial<HistoryResponse>>(historyKey(sid), 'json')
  if (!stored) return emptyHistory()

  // Merge over the empty shape so a record written before a new provider was
  // added still deserializes with every key present.
  const history = emptyHistory()
  history.titles = stored.titles ?? []
  for (const id of PROVIDER_IDS) {
    history.categories[id] = stored.categories?.[id] ?? []
  }
  return history
}

export async function writeHistory(
  c: Context<{ Bindings: AppEnv }>,
  history: HistoryResponse,
): Promise<void> {
  const sid = getCookie(c, SESSION_COOKIE)
  if (!sid) return

  await c.env.SESSIONS.put(historyKey(sid), JSON.stringify(history), {
    expirationTtl: HISTORY_TTL_SECONDS,
  })
}

/** Prepends a title, or refreshes its timestamp when it was already recorded. */
export function recordTitle(history: HistoryResponse, text: string): void {
  const existing = history.titles.find((entry) => entry.text === text)
  if (existing) {
    existing.at = Date.now()
  } else {
    history.titles.unshift({ id: crypto.randomUUID(), text, pinned: false, at: Date.now() })
  }
  history.titles = normalize(history.titles, MAX_UNPINNED_TITLES)
}

export function recordCategory(
  history: HistoryResponse,
  provider: ProviderId,
  category: Category,
): void {
  const list = history.categories[provider]
  const existing = list.find((entry) => entry.category.id === category.id)
  if (existing) {
    existing.at = Date.now()
    // The platform may have refreshed the name or box art since last time.
    existing.category = { ...category }
  } else {
    list.unshift({ category: { ...category }, pinned: false, at: Date.now() })
  }
  history.categories[provider] = normalize(list, MAX_UNPINNED_CATEGORIES)
}

export function setTitlePinned(history: HistoryResponse, id: string, pinned: boolean): boolean {
  const entry = history.titles.find((title) => title.id === id)
  if (!entry) return false

  entry.pinned = pinned
  history.titles = normalize(history.titles, MAX_UNPINNED_TITLES)
  return true
}

export function setCategoryPinned(
  history: HistoryResponse,
  provider: ProviderId,
  categoryId: string,
  pinned: boolean,
): boolean {
  const entry = history.categories[provider].find((item) => item.category.id === categoryId)
  if (!entry) return false

  entry.pinned = pinned
  history.categories[provider] = normalize(history.categories[provider], MAX_UNPINNED_CATEGORIES)
  return true
}

/** Pinned first (never dropped), newest first within each group, unpinned capped. */
function normalize<T extends TitleHistoryEntry | CategoryHistoryEntry>(
  entries: T[],
  maxUnpinned: number,
): T[] {
  const pinned = entries.filter((entry) => entry.pinned).sort((a, b) => b.at - a.at)
  const unpinned = entries.filter((entry) => !entry.pinned).sort((a, b) => b.at - a.at)
  return [...pinned, ...unpinned.slice(0, maxUnpinned)]
}
