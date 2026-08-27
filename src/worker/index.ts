import { Hono } from 'hono'
import type { HealthResponse, MeResponse, ProviderId } from '../shared/types'
import { randomToken, createCodeChallenge, createCodeVerifier } from './crypto'
import type { AppEnv } from './env'
import {
  buildAuthorizeUrl,
  exchangeCode,
  isProviderId,
  PROVIDERS,
  PROVIDER_LIST,
  revokeToken,
} from './providers'
import {
  consumeOAuthTransaction,
  destroySession,
  ensureSession,
  readSession,
  saveOAuthTransaction,
  writeSession,
} from './session'
import { resolveProvider } from './status'

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
  await writeSession(c, session)

  return c.json({ ok: true })
})

app.post('/api/auth/logout', async (c) => {
  await destroySession(c)
  return c.json({ ok: true })
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
