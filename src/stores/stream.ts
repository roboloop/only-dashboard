import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { apiJson } from '@/lib/api'
import { useSessionStore } from '@/stores/session'
import type {
  Category,
  CategorySearchResponse,
  CategoryHistoryEntry,
  HistoryResponse,
  ProviderId,
  SaveResponse,
  TitleHistoryEntry,
  UpdateCategoryRequest,
  UpdateTitleRequest,
} from '@/shared/types'

const SEARCH_DEBOUNCE_MS = 300
const MIN_QUERY_LENGTH = 2

/**
 * Everything the title and category blocks edit: the drafts, the per-platform
 * category search state, and the KV-backed history. The session store keeps
 * owning what /api/me returns; saves report their outcomes back into it.
 */
export const useStreamStore = defineStore('stream', () => {
  const session = useSessionStore()

  // --- Title ---
  const draftTitle = ref('')
  const titleSaving = ref(false)
  const titleError = ref<string | null>(null)

  // --- Category ---
  const draftCategoryQuery = ref('')
  const candidates = shallowRef<Partial<Record<ProviderId, Category[]>>>({})
  const searchErrors = shallowRef<Partial<Record<ProviderId, string>>>({})
  const picks = shallowRef<Partial<Record<ProviderId, Category>>>({})
  const skipped = shallowRef<Partial<Record<ProviderId, boolean>>>({})
  /** True once a query has produced candidate lists that are still on screen. */
  const searchActive = ref(false)
  const searching = ref(false)
  const categorySaving = ref(false)
  const categoryError = ref<string | null>(null)

  // --- History ---
  const titleHistory = shallowRef<TitleHistoryEntry[]>([])
  const categoryHistory = shallowRef<Record<ProviderId, CategoryHistoryEntry[]>>({
    twitch: [],
    kick: [],
    vkvideo: [],
  })

  const connectedProviders = computed(() => session.providers.filter((p) => p.connected))

  /**
   * The free text alone is never a valid category — every connected platform
   * needs a clicked candidate (or an explicit skip), and at least one pick.
   */
  const canSaveCategory = computed(() => {
    const connected = connectedProviders.value
    if (!connected.some((p) => picks.value[p.id])) return false
    return connected.every((p) => picks.value[p.id] || skipped.value[p.id])
  })

  let searchTimer: ReturnType<typeof setTimeout> | undefined
  let searchSeq = 0

  /** Typing re-queries every connected platform and resets stale picks. */
  function setCategoryQuery(value: string): void {
    if (value === draftCategoryQuery.value) return
    draftCategoryQuery.value = value
    picks.value = {}
    skipped.value = {}
    categoryError.value = null

    if (searchTimer) clearTimeout(searchTimer)
    const query = value.trim()
    if (query.length < MIN_QUERY_LENGTH) {
      searchSeq++
      candidates.value = {}
      searchErrors.value = {}
      searchActive.value = false
      searching.value = false
      return
    }

    searching.value = true
    searchTimer = setTimeout(() => void runSearch(query), SEARCH_DEBOUNCE_MS)
  }

  async function runSearch(query: string): Promise<void> {
    const seq = ++searchSeq
    searching.value = true
    try {
      const body = await apiJson<CategorySearchResponse>(
        `/api/categories/search?q=${encodeURIComponent(query)}`,
      )
      if (seq !== searchSeq) return
      candidates.value = body.results
      searchErrors.value = body.errors
      searchActive.value = true
    } catch (err) {
      if (seq !== searchSeq) return
      categoryError.value = err instanceof Error ? err.message : String(err)
    } finally {
      if (seq === searchSeq) searching.value = false
    }
  }

  /** The per-platform override search: re-queries one platform only. */
  async function searchProvider(id: ProviderId, query: string): Promise<void> {
    const trimmed = query.trim()
    if (trimmed.length < MIN_QUERY_LENGTH) return

    try {
      const body = await apiJson<CategorySearchResponse>(
        `/api/categories/search?q=${encodeURIComponent(trimmed)}&provider=${id}`,
      )
      candidates.value = { ...candidates.value, [id]: body.results[id] ?? [] }

      const errors = { ...searchErrors.value }
      if (body.errors[id]) errors[id] = body.errors[id]
      else delete errors[id]
      searchErrors.value = errors

      // New candidates re-open the column, so an earlier pick no longer holds.
      clearPick(id)
      searchActive.value = true
    } catch (err) {
      categoryError.value = err instanceof Error ? err.message : String(err)
    }
  }

  function pickCategory(id: ProviderId, category: Category): void {
    picks.value = { ...picks.value, [id]: category }
  }

  function clearPick(id: ProviderId): void {
    const nextPicks = { ...picks.value }
    delete nextPicks[id]
    picks.value = nextPicks

    const nextSkipped = { ...skipped.value }
    delete nextSkipped[id]
    skipped.value = nextSkipped
  }

  function skipProvider(id: ProviderId): void {
    skipped.value = { ...skipped.value, [id]: true }
  }

  async function saveTitle(): Promise<void> {
    const title = draftTitle.value.trim()
    if (!title || titleSaving.value) return

    titleSaving.value = true
    titleError.value = null
    try {
      const body = await apiJson<SaveResponse>('/api/stream/title', {
        method: 'PATCH',
        body: JSON.stringify({ title } satisfies UpdateTitleRequest),
      })
      session.applyOutcomes(body.results, { title })
      await loadHistory()
    } catch (err) {
      titleError.value = err instanceof Error ? err.message : String(err)
    } finally {
      titleSaving.value = false
    }
  }

  /** History rows apply immediately — no confirm step. */
  async function applyTitle(text: string): Promise<void> {
    draftTitle.value = text
    await saveTitle()
  }

  async function saveCategory(): Promise<void> {
    if (!canSaveCategory.value || categorySaving.value) return

    const chosen: Partial<Record<ProviderId, Category>> = {}
    for (const provider of connectedProviders.value) {
      const pick = picks.value[provider.id]
      if (pick) chosen[provider.id] = pick
    }

    await pushCategories(chosen)
    if (!categoryError.value) {
      // The cards now show the saved categories; collapse the candidate lists.
      picks.value = {}
      skipped.value = {}
      candidates.value = {}
      searchErrors.value = {}
      searchActive.value = false
    }
  }

  /** Recent-category rows apply to that one platform immediately. */
  async function applyCategory(id: ProviderId, category: Category): Promise<void> {
    await pushCategories({ [id]: category })
  }

  async function pushCategories(chosen: Partial<Record<ProviderId, Category>>): Promise<void> {
    categorySaving.value = true
    categoryError.value = null
    try {
      const body = await apiJson<SaveResponse>('/api/stream/category', {
        method: 'PATCH',
        body: JSON.stringify({ picks: chosen } satisfies UpdateCategoryRequest),
      })
      session.applyOutcomes(body.results, { picks: chosen })
      await loadHistory()
    } catch (err) {
      categoryError.value = err instanceof Error ? err.message : String(err)
    } finally {
      categorySaving.value = false
    }
  }

  async function loadHistory(): Promise<void> {
    try {
      const body = await apiJson<HistoryResponse>('/api/history')
      titleHistory.value = body.titles
      categoryHistory.value = body.categories
    } catch {
      // History is a convenience; a failed load leaves the lists as they were.
    }
  }

  function adoptHistory(body: HistoryResponse): void {
    titleHistory.value = body.titles
    categoryHistory.value = body.categories
  }

  async function pinTitle(id: string, pinned: boolean): Promise<void> {
    try {
      adoptHistory(
        await apiJson<HistoryResponse>('/api/history/title/pin', {
          method: 'POST',
          body: JSON.stringify({ id, pinned }),
        }),
      )
    } catch {
      await loadHistory()
    }
  }

  async function pinCategory(provider: ProviderId, categoryId: string, pinned: boolean): Promise<void> {
    try {
      adoptHistory(
        await apiJson<HistoryResponse>('/api/history/category/pin', {
          method: 'POST',
          body: JSON.stringify({ provider, categoryId, pinned }),
        }),
      )
    } catch {
      await loadHistory()
    }
  }

  return {
    draftTitle,
    titleSaving,
    titleError,
    draftCategoryQuery,
    candidates,
    searchErrors,
    picks,
    skipped,
    searchActive,
    searching,
    categorySaving,
    categoryError,
    titleHistory,
    categoryHistory,
    connectedProviders,
    canSaveCategory,
    setCategoryQuery,
    searchProvider,
    pickCategory,
    clearPick,
    skipProvider,
    saveTitle,
    applyTitle,
    saveCategory,
    applyCategory,
    loadHistory,
    pinTitle,
    pinCategory,
  }
})
