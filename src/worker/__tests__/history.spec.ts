import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { emptyHistory, recordCategory, recordTitle, setTitlePinned } from '../history'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-27T12:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

/** Records `texts` in order, one second apart, so recency is unambiguous. */
function recordAll(history: ReturnType<typeof emptyHistory>, texts: string[]) {
  for (const text of texts) {
    recordTitle(history, text)
    vi.advanceTimersByTime(1000)
  }
}

describe('title history', () => {
  it('keeps only the 10 most recent unpinned titles', () => {
    const history = emptyHistory()
    recordAll(
      history,
      Array.from({ length: 11 }, (_, i) => `title ${i}`),
    )

    expect(history.titles).toHaveLength(10)
    // The oldest fell off; the newest leads.
    expect(history.titles.map((t) => t.text)).not.toContain('title 0')
    expect(history.titles[0]!.text).toBe('title 10')
  })

  it('never drops pinned titles, however many there are', () => {
    const history = emptyHistory()
    recordAll(
      history,
      Array.from({ length: 12 }, (_, i) => `pinned ${i}`),
    )
    // Pin everything currently in the list (the 10 unpinned survivors)…
    const survivors = history.titles.map((entry) => entry.id)
    for (const id of survivors) {
      setTitlePinned(history, id, true)
    }
    // …then push 11 more unpinned titles through.
    recordAll(
      history,
      Array.from({ length: 11 }, (_, i) => `later ${i}`),
    )

    const pinned = history.titles.filter((t) => t.pinned)
    const unpinned = history.titles.filter((t) => !t.pinned)
    expect(pinned).toHaveLength(10)
    expect(unpinned).toHaveLength(10)
    // Pinned first, then the recent unpinned.
    expect(history.titles.slice(0, pinned.length).every((t) => t.pinned)).toBe(true)
  })

  it('re-saving an existing title refreshes it instead of duplicating', () => {
    const history = emptyHistory()
    recordAll(history, ['same', 'other', 'same'])

    expect(history.titles.filter((t) => t.text === 'same')).toHaveLength(1)
    expect(history.titles[0]!.text).toBe('same')
  })
})

describe('category history', () => {
  it('dedupes by category id and updates the stored name', () => {
    const history = emptyHistory()
    recordCategory(history, 'twitch', { id: '1', name: 'Old Name', imageUrl: null })
    vi.advanceTimersByTime(1000)
    recordCategory(history, 'twitch', { id: '1', name: 'New Name', imageUrl: null })

    expect(history.categories.twitch).toHaveLength(1)
    expect(history.categories.twitch[0]!.category.name).toBe('New Name')
  })
})
