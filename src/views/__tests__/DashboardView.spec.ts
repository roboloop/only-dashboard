import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createWebHistory } from 'vue-router'
import DashboardView from '../DashboardView.vue'
import type { MeResponse, ProviderState } from '@/shared/types'

function providerState(overrides: Partial<ProviderState> = {}): ProviderState {
  return {
    id: 'twitch',
    label: 'Twitch',
    connected: false,
    displayName: null,
    streamTitle: null,
    isLive: false,
    category: null,
    error: null,
    ...overrides,
  }
}

function stubMe(providers: ProviderState[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ providers, fetchedAt: Date.now() }) as MeResponse,
    } as Response),
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
    stubMe([providerState()])
    const wrapper = await mountView()

    const link = wrapper.get('a.button')
    // A plain navigation, not a fetch — the consent screen must be top-level.
    expect(link.attributes('href')).toBe('/auth/twitch/start')
    expect(link.text()).toContain('Connect Twitch')
  })

  it('shows the stream title once connected', async () => {
    stubMe([
      providerState({
        connected: true,
        displayName: 'Streamer',
        streamTitle: 'Building a dashboard',
        isLive: true,
        category: 'Science & Technology',
      }),
    ])
    const wrapper = await mountView()

    expect(wrapper.text()).toContain('Building a dashboard')
    expect(wrapper.text()).toContain('Streamer')
    expect(wrapper.text()).toContain('Live')
    expect(wrapper.find('a.button').exists()).toBe(false)
  })

  it('distinguishes a connected platform with no title set', async () => {
    stubMe([providerState({ connected: true, displayName: 'Streamer', streamTitle: null })])
    const wrapper = await mountView()

    expect(wrapper.text()).toContain('No title set')
  })

  it('renders one platform’s error without hiding the others', async () => {
    stubMe([
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

  it('explains a denied authorization from the callback query', async () => {
    stubMe([providerState()])
    const wrapper = await mountView('/?error=access_denied')

    expect(wrapper.text()).toContain('Authorization was declined.')
  })
})
