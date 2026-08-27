import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createWebHistory } from 'vue-router'
import DashboardView from '../DashboardView.vue'
import type { HistoryResponse, MeResponse, ProviderState } from '@/shared/types'

function providerState(overrides: Partial<ProviderState> = {}): ProviderState {
  return {
    id: 'twitch',
    label: 'Twitch',
    connected: false,
    displayName: null,
    streamTitle: null,
    isLive: false,
    category: null,
    dashboardUrl: null,
    needsReauth: false,
    error: null,
    ...overrides,
  }
}

function emptyHistory(): HistoryResponse {
  return { titles: [], categories: { twitch: [], kick: [], vkvideo: [] } }
}

/** Answers /api/me and /api/history; anything else gets an empty object. */
function stubApi(providers: ProviderState[], history: HistoryResponse = emptyHistory()) {
  vi.stubGlobal(
    'fetch',
    vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
      const url = String(input)
      const body: unknown = url.includes('/api/history')
        ? history
        : url.includes('/api/me')
          ? ({ providers, fetchedAt: Date.now() } satisfies MeResponse)
          : {}
      return { ok: true, status: 200, json: async () => body } as Response
    }) as unknown as typeof fetch,
  )
}

const router = createRouter({
  history: createWebHistory(),
  routes: [{ path: '/', name: 'dashboard', component: DashboardView }],
})

async function mountView(location = '/') {
  await router.push(location)
  await router.isReady()
  const wrapper = mount(DashboardView, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DashboardView', () => {
  it('offers a real link for a disconnected platform', async () => {
    stubApi([providerState()])
    const wrapper = await mountView()

    const link = wrapper.get(`a[href="/auth/twitch/start"]`)
    // A plain navigation, not a fetch — the consent screen must be top-level.
    expect(link.text()).toContain('CONNECT')
    expect(wrapper.text()).toContain('NOT CONNECTED')
  })

  it('shows the live state, title and category once connected', async () => {
    stubApi([
      providerState({
        connected: true,
        displayName: 'Streamer',
        streamTitle: 'Building a dashboard',
        isLive: true,
        category: { id: '1', name: 'Science & Technology', imageUrl: null },
      }),
    ])
    const wrapper = await mountView()

    expect(wrapper.text()).toContain('Building a dashboard')
    expect(wrapper.text()).toContain('@Streamer')
    expect(wrapper.text()).toContain('LIVE')
    expect(wrapper.text()).toContain('Science & Technology')
    expect(wrapper.find('a[href="/auth/twitch/start"]').exists()).toBe(false)
  })

  it('links a connected card to that platform’s own console', async () => {
    stubApi([
      providerState({
        connected: true,
        displayName: 'Streamer',
        dashboardUrl: 'https://dashboard.twitch.tv/u/streamer_tv/stream-manager',
      }),
      providerState({ id: 'kick', label: 'Kick', connected: true }),
    ])
    const wrapper = await mountView()

    const link = wrapper.get('a.dashboard')
    expect(link.attributes('href')).toBe('https://dashboard.twitch.tv/u/streamer_tv/stream-manager')
    expect(link.attributes('target')).toBe('_blank')
    expect(link.text()).toContain('DASHBOARD')
    // A platform that reported no url — like Kick here — offers no link.
    expect(wrapper.findAll('a.dashboard')).toHaveLength(1)
  })

  it('pre-fills the title input with the current shared title', async () => {
    stubApi([providerState({ connected: true, streamTitle: 'Current title' })])
    const wrapper = await mountView()

    const input = wrapper.get<HTMLInputElement>('input[placeholder="Stream title"]')
    expect(input.element.value).toBe('Current title')
  })

  it('distinguishes a connected platform with no title set', async () => {
    stubApi([providerState({ connected: true, displayName: 'Streamer', streamTitle: null })])
    const wrapper = await mountView()

    expect(wrapper.text()).toContain('No title')
    expect(wrapper.text()).toContain('OFFLINE')
  })

  it('renders one platform’s error without hiding the others', async () => {
    stubApi([
      providerState({ id: 'twitch', label: 'Twitch', connected: true, streamTitle: 'Fine' }),
      providerState({
        id: 'kick',
        label: 'Kick',
        connected: true,
        error: 'Kick could not be reached',
      }),
    ])
    const wrapper = await mountView()

    expect(wrapper.text()).toContain('Fine')
    expect(wrapper.text()).toContain('Kick could not be reached')
  })

  it('asks for a reconnect when the stored token cannot write', async () => {
    stubApi([providerState({ connected: true, needsReauth: true })])
    const wrapper = await mountView()

    expect(wrapper.text()).toContain('RECONNECT')
    const link = wrapper.get(`a[href="/auth/twitch/start"]`)
    expect(link.text()).toContain('RECONNECT')
  })

  it('lists title history with APPLY on pinned rows and times on the rest', async () => {
    stubApi([providerState({ connected: true })], {
      titles: [
        { id: 'a', text: 'Souls Sunday', pinned: true, at: Date.now() - 60_000 },
        { id: 'b', text: 'attempt 41', pinned: false, at: Date.now() - 41 * 60_000 },
      ],
      categories: { twitch: [], kick: [], vkvideo: [] },
    })
    const wrapper = await mountView()

    expect(wrapper.text()).toContain('Souls Sunday')
    expect(wrapper.text()).toContain('APPLY')
    expect(wrapper.text()).toContain('attempt 41')
    expect(wrapper.text()).toContain('41m')
  })

  it('explains a denied authorization from the callback query', async () => {
    stubApi([providerState()])
    const wrapper = await mountView('/?error=access_denied')

    expect(wrapper.text()).toContain('Authorization was declined.')
  })

  it('re-reads platform status every 30 seconds', async () => {
    vi.useFakeTimers()
    let meCalls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
        const url = String(input)
        let body: unknown = {}
        if (url.includes('/api/history')) {
          body = emptyHistory()
        } else if (url.includes('/api/me')) {
          meCalls++
          body = {
            providers: [
              providerState({
                connected: true,
                streamTitle: meCalls > 1 ? 'Changed elsewhere' : 'Original title',
                isLive: meCalls > 1,
              }),
            ],
            fetchedAt: Date.now(),
          } satisfies MeResponse
        }
        return { ok: true, status: 200, json: async () => body } as Response
      }) as unknown as typeof fetch,
    )

    try {
      const wrapper = await mountView()
      expect(wrapper.text()).toContain('Original title')
      expect(meCalls).toBe(1)

      await vi.advanceTimersByTimeAsync(30_000)
      await flushPromises()

      // The cards picked up the overridden title and the live flip.
      expect(meCalls).toBe(2)
      expect(wrapper.text()).toContain('Changed elsewhere')
      expect(wrapper.text()).toContain('LIVE')
      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })
})
