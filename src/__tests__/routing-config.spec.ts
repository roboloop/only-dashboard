import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { PROVIDER_IDS } from '@/shared/types'

/**
 * Guards the routing layer *in front of* the Worker.
 *
 * Cloudflare's asset router runs before the Worker and, with
 * not_found_handling: "single-page-application", answers browser navigations
 * for unmatched paths with index.html — never invoking the Worker. Any Worker
 * route reached by a top-level navigation must therefore also be listed in
 * assets.run_worker_first, or it silently returns the SPA instead.
 *
 * The OAuth start and callback routes are exactly that: both are reached by
 * navigation. The Hono tests can't catch this, because app.request() bypasses
 * asset routing entirely.
 */

interface WranglerConfig {
  assets?: { run_worker_first?: string[] | boolean }
}

function readWranglerConfig(): WranglerConfig {
  // vitest.config.ts pins `root` to the project root, so cwd is stable here.
  // import.meta.url is not a file: URL once Vite has transformed the module.
  const source = readFileSync(join(process.cwd(), 'wrangler.jsonc'), 'utf8')

  // Enough of a JSONC parser for this file: it has only whole-line `//`
  // comments and no `//` inside any string value.
  const stripped = source
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')

  return JSON.parse(stripped) as WranglerConfig
}

/** Cloudflare static-routing rule: leading `/`, `*` matches any remainder. */
function ruleMatches(rule: string, path: string): boolean {
  const pattern = rule
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${pattern}$`).test(path)
}

const config = readWranglerConfig()
const rules = config.assets?.run_worker_first

describe('assets.run_worker_first', () => {
  it('is configured as a list of rules', () => {
    expect(Array.isArray(rules)).toBe(true)
  })

  it.each(PROVIDER_IDS.flatMap((id) => [`/auth/${id}/start`, `/auth/${id}/callback`]))(
    'routes %s to the Worker before the asset router',
    (path) => {
      expect(Array.isArray(rules) && rules.some((rule) => ruleMatches(rule, path))).toBe(true)
    },
  )

  it('routes the API to the Worker', () => {
    expect(Array.isArray(rules) && rules.some((rule) => ruleMatches(rule, '/api/me'))).toBe(true)
  })

  it('leaves client-side routes to the asset router, so the SPA fallback still applies', () => {
    for (const path of ['/', '/some-future-client-route']) {
      expect(Array.isArray(rules) && rules.some((rule) => ruleMatches(rule, path))).toBe(false)
    }
  })

  it('uses only rules Cloudflare will accept', () => {
    // parseStaticRouting requires every rule to start with "/" or "!/", and at
    // least one to be non-negative.
    expect(
      Array.isArray(rules) && rules.every((r) => r.startsWith('/') || r.startsWith('!/')),
    ).toBe(true)
    expect(Array.isArray(rules) && rules.some((r) => !r.startsWith('!'))).toBe(true)
  })
})
