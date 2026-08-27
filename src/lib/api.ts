import type { ApiError } from '@/shared/types'

/**
 * Fetches JSON from the Worker's API, throwing the server's error message on a
 * non-2xx response. Same-origin, so paths are relative and there is no CORS.
 */
export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  })

  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message = (body as ApiError | null)?.error ?? `Request failed (${response.status})`
    throw new Error(message)
  }

  return body as T
}
