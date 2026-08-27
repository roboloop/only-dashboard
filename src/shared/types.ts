/**
 * Response shapes shared by the Worker (src/worker) and the Vue app (src/views,
 * src/composables). Both sides import from here so the two can't drift apart.
 */

export interface HelloResponse {
  message: string
}

export interface HealthResponse {
  ok: true
  ts: number
}

export interface Stat {
  id: string
  label: string
  value: number
  unit: string
  /** Change versus the previous period, as a fraction (0.12 === +12%). */
  delta: number
}

export interface StatsResponse {
  stats: Stat[]
  generatedAt: number
}

export interface ApiError {
  error: string
}
