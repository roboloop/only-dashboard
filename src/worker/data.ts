import type { Stat } from '../shared/types'

/**
 * Dummy dashboard data. Swapping this for a real source (D1, KV, an upstream
 * API) should only ever touch this file — the handlers and the frontend are
 * written against the shared types, not against these literals.
 */
export const STATS: Stat[] = [
  { id: 'visitors', label: 'Visitors', value: 18432, unit: '', delta: 0.124 },
  { id: 'signups', label: 'Signups', value: 1290, unit: '', delta: -0.031 },
  { id: 'revenue', label: 'Revenue', value: 42890, unit: 'USD', delta: 0.087 },
  { id: 'latency', label: 'p95 latency', value: 143, unit: 'ms', delta: -0.212 },
]
