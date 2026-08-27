import { Hono } from 'hono'
import type { Context } from 'hono'
import type {
  Category,
  CategorySearchResponse,
  HealthResponse,
  MeResponse,
  PinCategoryRequest,
  PinTitleRequest,
  ProviderId,
  SaveOutcome,
  SaveResponse,
  UpdateCategoryRequest,
  UpdateTitleRequest,
} from '../shared/types'
import { randomToken, createCodeChallenge, createCodeVerifier } from './crypto'
import type { AppEnv } from './env'
import {
  readHistory,
  recordCategory,
  recordTitle,
  setCategoryPinned,
  setTitlePinned,
  writeHistory,
} from './history'
import {
  buildAuthorizeUrl,
  exchangeCode,
  hasWriteScopes,
  isProviderId,
  PROVIDERS,
  PROVIDER_LIST,
  revokeToken,
} from './providers'
import type { OAuthTokens, Provider, StreamPatch } from './providers/types'
import {
  consumeOAuthTransaction,
  destroySession,
  ensureSession,
  readSession,
  type SessionData,
  saveOAuthTransaction,
  writeSession,
} from './session'
import { resolveProvider, withFreshTokens } from './status'

const app = new Hono<{ Bindings: AppEnv }>()

/**
 * The callback paths are /auth/<provider>/callback rather than /api/... because
 * that is what is registered with each platform, and a redirect URI has to match
 * the registration exactly. They must be declared before the SPA fallback below.
 */
const callbackPath = (provider: ProviderId) => `/auth/${provider}/callback`

const redirectUriFor = (requestUrl: string, provider: ProviderId) =>
  new URL(callbackPath(provider), new URL(requestUrl).origin).toString()

app.get('/api/health', (c) => c.json<HealthResponse>({ ok: true, ts: Date.now() }))

/**
 * Begins an authorization. Creates the session up front so the OAuth
 * transaction has somewhere to land when the provider redirects back.
 */
app.get('/auth/:provider/start', async (c) => {
  const id = c.req.param('provider')
  if (!isProviderId(id)) return c.json({ error: 'Unknown provider' }, 404)

  const provider = PROVIDERS[id]
  await ensureSession(c)

  const state = randomToken()
  const redirectUri = redirectUriFor(c.req.url, id)
  const codeVerifier = provider.usesPkce ? createCodeVerifier() : null

  await saveOAuthTransaction(c, state, { provider: id, codeVerifier, redirectUri })

  const authorizeUrl = buildAuthorizeUrl(provider, c.env, {
    redirectUri,
    state,
    codeChallenge: codeVerifier ? await createCodeChallenge(codeVerifier) : undefined,
  })

  return c.redirect(authorizeUrl, 302)
})

app.get('/auth/:provider/callback', async (c) => {
  const id = c.req.param('provider')
  if (!isProviderId(id)) return c.json({ error: 'Unknown provider' }, 404)

  // The user declined, or the provider rejected the request.
  const denied = c.req.query('error')
  if (denied) return c.redirect(`/?error=${encodeURIComponent(denied)}`, 302)

  const code = c.req.query('code')
  const state = c.req.query('state')
  if (!code || !state) return c.redirect('/?error=missing_code', 302)

  // Single-use: consuming the state here means a replayed callback URL fails.
  const transaction = await consumeOAuthTransaction(c, state)
  if (!transaction || transaction.provider !== id) {
    return c.redirect('/?error=invalid_state', 302)
  }

  const session = await ensureSession(c)

  try {
    const tokens = await exchangeCode(PROVIDERS[id], c.env, {
      code,
      redirectUri: transaction.redirectUri,
      codeVerifier: transaction.codeVerifier ?? undefined,
    })

    session.connections[id] = tokens
    await writeSession(c, session)
  } catch (error) {
    console.error(`${id} code exchange failed`, error)
    return c.redirect('/?error=exchange_failed', 302)
  }

  return c.redirect('/', 302)
})

/**
 * The one endpoint the dashboard reads. Returns display fields only — never a
 * token, and never anything derived from one.
 */
app.get('/api/me', async (c) => {
  const session = await readSession(c)

  if (!session) {
    return c.json<MeResponse>({
      providers: PROVIDER_LIST.map((provider) => ({
        id: provider.id,
        label: provider.label,
        connected: false,
        displayName: null,
        streamTitle: null,
        isLive: false,
        category: null,
        dashboardUrl: null,
        needsReauth: false,
        error: null,
      })),
      fetchedAt: Date.now(),
    })
  }

  // Fan out in parallel: one slow or broken platform must not hold up the rest.
  const resolved = await Promise.all(
    PROVIDER_LIST.map((provider) =>
      resolveProvider(provider, session, c.env, redirectUriFor(c.req.url, provider.id)),
    ),
  )

  // Persist refreshed tokens and drop dead connections in a single write.
  let mutated = false
  for (const [index, result] of resolved.entries()) {
    const provider = PROVIDER_LIST[index]!
    if (result.drop) {
      delete session.connections[provider.id]
      delete session.lastPushed?.[provider.id]
      mutated = true
    } else if (result.tokens) {
      session.connections[provider.id] = result.tokens
      mutated = true
    }
  }
  if (mutated) await writeSession(c, session)

  return c.json<MeResponse>({
    providers: resolved.map((result) => result.state),
    fetchedAt: Date.now(),
  })
})

app.post('/api/auth/:provider/disconnect', async (c) => {
  const id = c.req.param('provider')
  if (!isProviderId(id)) return c.json({ error: 'Unknown provider' }, 404)

  const session = await readSession(c)
  const tokens = session?.connections[id]
  if (!session || !tokens) return c.json({ ok: true })

  // Best-effort revocation where the platform offers it, so disconnecting here
  // actually invalidates the token rather than just forgetting it.
  try {
    await revokeToken(PROVIDERS[id], c.env, tokens.accessToken, 'access_token')
  } catch (error) {
    console.error(`${id} token revocation failed`, error)
  }

  delete session.connections[id]
  delete session.lastPushed?.[id]
  await writeSession(c, session)

  return c.json({ ok: true })
})

app.post('/api/auth/logout', async (c) => {
  await destroySession(c)
  return c.json({ ok: true })
})

/**
 * Pushes one change to one platform, respecting the shared refresh policy.
 * A token that predates the write scopes is refused up front: the platform
 * would only 401, and the card already tells the user to reconnect.
 */
async function pushToProvider(
  c: Context<{ Bindings: AppEnv }>,
  session: SessionData,
  provider: Provider,
  patch: StreamPatch,
): Promise<{ outcome: SaveOutcome; tokens: OAuthTokens | null; drop: boolean }> {
  const stored = session.connections[provider.id]
  if (!stored || !hasWriteScopes(provider, stored)) {
    return {
      outcome: {
        id: provider.id,
        ok: false,
        error: 'Reconnect to grant permission to make changes',
        disconnected: false,
      },
      tokens: null,
      drop: false,
    }
  }

  const call = await withFreshTokens(provider, session, c.env, redirectUriFor(c.req.url, provider.id), (accessToken) =>
    provider.updateStream(accessToken, c.env, patch),
  )

  return {
    outcome: {
      id: provider.id,
      ok: call.error === null,
      error: call.error,
      disconnected: call.drop,
    },
    tokens: call.tokens,
    drop: call.drop,
  }
}

/**
 * Applies refreshed tokens / dropped connections from a fan-out, in one write.
 * `alsoMutated` forces the write when the caller changed the session itself
 * (e.g. recorded a successful push).
 */
async function persistTokenChanges(
  c: Context<{ Bindings: AppEnv }>,
  session: SessionData,
  changes: { id: ProviderId; tokens: OAuthTokens | null; drop: boolean }[],
  alsoMutated = false,
): Promise<void> {
  let mutated = alsoMutated
  for (const change of changes) {
    if (change.drop) {
      delete session.connections[change.id]
      delete session.lastPushed?.[change.id]
      mutated = true
    } else if (change.tokens) {
      session.connections[change.id] = change.tokens
      mutated = true
    }
  }
  if (mutated) await writeSession(c, session)
}

/** Remembers a successful write so /api/me can backfill an empty read. */
function recordPush(session: SessionData, id: ProviderId, patch: StreamPatch): void {
  const lastPushed = (session.lastPushed ??= {})
  const entry = (lastPushed[id] ??= { at: 0 })
  if (patch.title !== undefined) entry.title = patch.title
  if (patch.category !== undefined) entry.category = patch.category
  entry.at = Date.now()
}

app.patch('/api/stream/title', async (c) => {
  const session = await readSession(c)
  if (!session) return c.json({ error: 'Not signed in' }, 401)

  const body = await c.req.json<UpdateTitleRequest>().catch(() => null)
  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  if (!title) return c.json({ error: 'Title is required' }, 400)
  if (title.length > 300) return c.json({ error: 'Title is too long' }, 400)

  const connected = PROVIDER_LIST.filter((provider) => session.connections[provider.id])
  if (connected.length === 0) return c.json({ error: 'No platform is connected' }, 400)

  // Fan out in parallel; each platform succeeds or fails on its own.
  const pushes = await Promise.all(
    connected.map((provider) => pushToProvider(c, session, provider, { title })),
  )

  const succeeded = pushes.filter((push) => push.outcome.ok)
  for (const push of succeeded) {
    recordPush(session, push.outcome.id, { title })
  }
  await persistTokenChanges(
    c,
    session,
    pushes.map((push) => ({ id: push.outcome.id, tokens: push.tokens, drop: push.drop })),
    succeeded.length > 0,
  )

  if (succeeded.length > 0) {
    const history = await readHistory(c)
    recordTitle(history, title)
    await writeHistory(c, history)
  }

  return c.json<SaveResponse>({
    results: pushes.map((push) => push.outcome),
    fetchedAt: Date.now(),
  })
})

app.patch('/api/stream/category', async (c) => {
  const session = await readSession(c)
  if (!session) return c.json({ error: 'Not signed in' }, 401)

  const body = await c.req.json<UpdateCategoryRequest>().catch(() => null)
  if (!body?.picks || typeof body.picks !== 'object') {
    return c.json({ error: 'No category picked' }, 400)
  }

  // Rebuild each pick from scratch: only known providers, only expected fields.
  const picks: [ProviderId, Category][] = []
  for (const [id, pick] of Object.entries(body.picks)) {
    if (!isProviderId(id) || !session.connections[id]) continue
    if (typeof pick?.id !== 'string' || !pick.id || typeof pick.name !== 'string' || !pick.name) {
      return c.json({ error: 'Malformed category pick' }, 400)
    }
    picks.push([
      id,
      {
        id: pick.id,
        name: pick.name,
        imageUrl: typeof pick.imageUrl === 'string' ? pick.imageUrl : null,
        kind: pick.kind === 'irl' ? 'irl' : pick.kind === 'game' ? 'game' : undefined,
      },
    ])
  }
  if (picks.length === 0) return c.json({ error: 'No category picked' }, 400)

  const pushes = await Promise.all(
    picks.map(([id, category]) => pushToProvider(c, session, PROVIDERS[id], { category })),
  )

  const saved = picks.filter((_, index) => pushes[index]!.outcome.ok)
  for (const [id, category] of saved) {
    recordPush(session, id, { category })
  }
  await persistTokenChanges(
    c,
    session,
    pushes.map((push) => ({ id: push.outcome.id, tokens: push.tokens, drop: push.drop })),
    saved.length > 0,
  )

  if (saved.length > 0) {
    const history = await readHistory(c)
    for (const [id, category] of saved) recordCategory(history, id, category)
    await writeHistory(c, history)
  }

  return c.json<SaveResponse>({
    results: pushes.map((push) => push.outcome),
    fetchedAt: Date.now(),
  })
})

app.get('/api/categories/search', async (c) => {
  const session = await readSession(c)
  if (!session) return c.json({ error: 'Not signed in' }, 401)

  const query = (c.req.query('q') ?? '').trim()
  if (!query) return c.json({ error: 'Query is required' }, 400)
  if (query.length > 100) return c.json({ error: 'Query is too long' }, 400)

  // An optional ?provider= narrows the search to one platform (the
  // per-platform override search box in the category block).
  const only = c.req.query('provider')
  if (only !== undefined && !isProviderId(only)) {
    return c.json({ error: 'Unknown provider' }, 404)
  }

  const targets = PROVIDER_LIST.filter(
    (provider) => session.connections[provider.id] && (!only || provider.id === only),
  )

  const calls = await Promise.all(
    targets.map((provider) =>
      withFreshTokens(provider, session, c.env, redirectUriFor(c.req.url, provider.id), (accessToken) =>
        provider.searchCategories(accessToken, c.env, query),
      ),
    ),
  )
  await persistTokenChanges(
    c,
    session,
    calls.map((call, index) => ({ id: targets[index]!.id, tokens: call.tokens, drop: call.drop })),
  )

  const response: CategorySearchResponse = { results: {}, errors: {} }
  for (const [index, call] of calls.entries()) {
    const id = targets[index]!.id
    if (call.result) response.results[id] = call.result
    else response.errors[id] = call.error ?? 'Search failed'
  }

  return c.json(response)
})

app.get('/api/history', async (c) => c.json(await readHistory(c)))

app.post('/api/history/title/pin', async (c) => {
  const body = await c.req.json<PinTitleRequest>().catch(() => null)
  if (typeof body?.id !== 'string' || typeof body.pinned !== 'boolean') {
    return c.json({ error: 'Malformed request' }, 400)
  }

  const history = await readHistory(c)
  if (!setTitlePinned(history, body.id, body.pinned)) {
    return c.json({ error: 'Unknown title' }, 404)
  }
  await writeHistory(c, history)

  return c.json(history)
})

app.post('/api/history/category/pin', async (c) => {
  const body = await c.req.json<PinCategoryRequest>().catch(() => null)
  if (
    !body ||
    !isProviderId(body.provider) ||
    typeof body.categoryId !== 'string' ||
    typeof body.pinned !== 'boolean'
  ) {
    return c.json({ error: 'Malformed request' }, 400)
  }

  const history = await readHistory(c)
  if (!setCategoryPinned(history, body.provider, body.categoryId, body.pinned)) {
    return c.json({ error: 'Unknown category' }, 404)
  }
  await writeHistory(c, history)

  return c.json(history)
})

// Unknown API paths must fail as JSON: without this they fall through to the
// SPA and a fetch() expecting JSON receives index.html.
app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404))

// Everything else is the SPA. Static files and the history-mode fallback both
// come from the assets binding.
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw))

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: 'Internal server error' }, 500)
})

export default app
