import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import type { MeResponse, ProviderId, ProviderState } from '@/shared/types'

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

  const connectedCount = computed(() => providers.value.filter((p) => p.connected).length)

  async function refresh(): Promise<void> {
    loading.value = true
    error.value = null

    try {
      const response = await fetch('/api/me', { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`Could not load connections (${response.status})`)

      const body = (await response.json()) as MeResponse
      providers.value = body.providers
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
      loaded.value = true
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

  return { providers, error, loading, loaded, connectedCount, refresh, disconnect, logout }
})
