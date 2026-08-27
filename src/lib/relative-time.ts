/**
 * Compact relative timestamps for history rows and the sync indicator:
 * seconds/minutes/hours while recent, a weekday inside a week, a date after.
 */
export function relativeTime(at: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - at) / 1000))
  if (seconds < 60) return `${seconds}s`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`

  const days = Math.floor(hours / 24)
  if (days < 7) return new Date(at).toLocaleDateString('en-US', { weekday: 'short' })

  return new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
