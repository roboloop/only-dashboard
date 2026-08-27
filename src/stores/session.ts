import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { apiJson } from '@/lib/api'
import type { Category, MeResponse, ProviderId, ProviderState, SaveOutcome } from '@/shared/types'

/**
 * The connection state of every platform, read from /api/me.
 *
 * There is deliberately nothing persisted here: the session lives in an
 * httpOnly cookie, so a reload re-reads it from the server. Mirroring any of it
 * into localStorage would only create a second, staler copy.
 */
export const useSessionStore = defineStore('session', () => {
  const providers = shallowRef<ProviderState[]>([])
  const error = ref<string | null>(null)
  const loading = ref(false)
  const loaded = ref(false)
  const fetchedAt = ref<number | null>(null)

  const connectedCount = computed(() => providers.value.filter((p) => p.connected).length)

  /** The handle shown in the header — the first connected account's name. */
  const handle = computed(
    () => providers.value.find((p) => p.connected && p.displayName)?.displayName ?? null,
  )

  async function refresh(): Promise<void> {
    loading.value = true
    error.value = null

    try {
      const body = await apiJson<MeResponse>('/api/me')
      providers.value = body.providers
      fetchedAt.value = body.fetchedAt
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
      loaded.value = true
    }
  }

  function patchProvider(id: ProviderId, patch: Partial<ProviderState>): void {
    providers.value = providers.value.map((p) => (p.id === id ? { ...p, ...patch } : p))
  }

  /**
   * Applies a save's per-platform outcomes to the cards optimistically:
   * successes show the new title/category immediately, failures surface inline
   * on that one card, and a dropped connection flips the card to CONNECT.
   */
  function applyOutcomes(
    outcomes: SaveOutcome[],
    change: { title?: string; picks?: Partial<Record<ProviderId, Category>> },
  ): void {
    for (const outcome of outcomes) {
      if (outcome.disconnected) {
        patchProvider(outcome.id, { connected: false, error: outcome.error })
      } else if (!outcome.ok) {
        patchProvider(outcome.id, { error: outcome.error })
      } else {
        patchProvider(outcome.id, {
          error: null,
          ...(change.title !== undefined ? { streamTitle: change.title } : {}),
          ...(change.picks?.[outcome.id] ? { category: change.picks[outcome.id] } : {}),
        })
      }
    }
  }

  async function disconnect(id: ProviderId): Promise<void> {
    await fetch(`/api/auth/${id}/disconnect`, { method: 'POST' })
    await refresh()
  }

  async function logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' })
    await refresh()
  }

  return {
    providers,
    error,
    loading,
    loaded,
    fetchedAt,
    connectedCount,
    handle,
    refresh,
    applyOutcomes,
    disconnect,
    logout,
  }
})
