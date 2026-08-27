import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import HomeView from '../HomeView.vue'
import type { HelloResponse } from '@/shared/types'

function mockFetch(body: HelloResponse, ok = true) {
  return vi.fn<typeof fetch>().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as Response)
}

describe('HomeView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the greeting and the message from the API', async () => {
    vi.stubGlobal('fetch', mockFetch({ message: 'Hello from the test' }))

    const wrapper = mount(HomeView)
    await flushPromises()

    expect(wrapper.text()).toContain('Hello, world')
    expect(wrapper.text()).toContain('Hello from the test')
  })

  it('surfaces an API failure instead of rendering stale state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'boom' }),
      } as Response),
    )

    const wrapper = mount(HomeView)
    await flushPromises()

    expect(wrapper.find('.error').text()).toBe('boom')
  })

  it('increments the Pinia counter', async () => {
    vi.stubGlobal('fetch', mockFetch({ message: 'hi' }))

    const wrapper = mount(HomeView)
    await flushPromises()

    const buttons = wrapper.findAll('button')
    const increment = buttons[buttons.length - 1]!
    await increment.trigger('click')

    expect(wrapper.text()).toContain('count: 1')
  })
})
