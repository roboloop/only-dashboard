import { ref, shallowRef, type Ref, type ShallowRef } from 'vue'
import type { ApiError } from '@/shared/types'

export interface UseApiResult<T> {
  data: ShallowRef<T | null>
  error: Ref<string | null>
  loading: Ref<boolean>
  /** Re-runs the request. Safe to call while one is already in flight. */
  refresh: () => Promise<void>
}

/**
 * Fetches JSON from the Worker's API and exposes it as reactive state.
 *
 * The Vue app and the Worker are served from the same origin (one Worker serves
 * both), so paths are relative and there is no CORS to configure.
 */
export function useApi<T>(path: string, options: { immediate?: boolean } = {}): UseApiResult<T> {
  const data = shallowRef<T | null>(null)
  const error = ref<string | null>(null)
  const loading = ref(false)

  let requestId = 0

  async function refresh(): Promise<void> {
    const id = ++requestId
    loading.value = true
    error.value = null

    try {
      const response = await fetch(path, { headers: { accept: 'application/json' } })
      const body: unknown = await response.json()

      if (!response.ok) {
        const message = (body as ApiError | null)?.error ?? `Request failed (${response.status})`
        throw new Error(message)
      }

      // A slower earlier request must not overwrite a newer response.
      if (id !== requestId) return
      data.value = body as T
    } catch (err) {
      if (id !== requestId) return
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      if (id === requestId) loading.value = false
    }
  }

  if (options.immediate !== false) void refresh()

  return { data, error, loading, refresh }
}
