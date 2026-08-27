import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { Category, ProviderId } from '../shared/types'
import { randomToken } from './crypto'
import type { AppEnv } from './env'
import type { OAuthTokens } from './providers/types'

/**
 * Sessions live in KV; the browser only ever holds an opaque id in an httpOnly
 * cookie. No access or refresh token is ever serialized to the client.
 */

export const SESSION_COOKIE = 'sid'

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30 // 30 days
const OAUTH_TTL_SECONDS = 60 * 10 // one in-flight authorization

/** What this app last successfully wrote to one platform. */
export interface PushedState {
  title?: string
  category?: Category
  at: number
}

export interface SessionData {
  createdAt: number
  connections: Partial<Record<ProviderId, OAuthTokens>>
  /**
   * Fallback display state per platform. Some platforms (Kick while offline)
   * read back empty stream fields even though a write succeeded; when a read
   * returns nothing, `/api/me` fills the gap from here. Platform-provided
   * values always win.
   */
  lastPushed?: Partial<Record<ProviderId, PushedState>>
}

/** The server-side half of one in-flight authorization. */
export interface OAuthTransaction {
  provider: ProviderId
  codeVerifier: string | null
  redirectUri: string
}

const sessionKey = (sid: string) => `session:${sid}`
const oauthKey = (state: string) => `oauth:${state}`

export async function readSession(c: Context<{ Bindings: AppEnv }>): Promise<SessionData | null> {
  const sid = getCookie(c, SESSION_COOKIE)
  if (!sid) return null

  return await c.env.SESSIONS.get<SessionData>(sessionKey(sid), 'json')
}

export async function writeSession(
  c: Context<{ Bindings: AppEnv }>,
  data: SessionData,
): Promise<void> {
  const sid = getCookie(c, SESSION_COOKIE) ?? issueSessionCookie(c)
  await c.env.SESSIONS.put(sessionKey(sid), JSON.stringify(data), {
    expirationTtl: SESSION_TTL_SECONDS,
  })
}

/** Reads the current session, creating an empty one (and cookie) if absent. */
export async function ensureSession(c: Context<{ Bindings: AppEnv }>): Promise<SessionData> {
  const existing = await readSession(c)
  if (existing) return existing

  const fresh: SessionData = { createdAt: Date.now(), connections: {} }
  await writeSession(c, fresh)
  return fresh
}

export async function destroySession(c: Context<{ Bindings: AppEnv }>): Promise<void> {
  const sid = getCookie(c, SESSION_COOKIE)
  if (sid) await c.env.SESSIONS.delete(sessionKey(sid))
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
}

export async function saveOAuthTransaction(
  c: Context<{ Bindings: AppEnv }>,
  state: string,
  transaction: OAuthTransaction,
): Promise<void> {
  await c.env.SESSIONS.put(oauthKey(state), JSON.stringify(transaction), {
    expirationTtl: OAUTH_TTL_SECONDS,
  })
}

/**
 * Reads and immediately deletes the transaction, so a replayed callback URL
 * cannot be exchanged twice.
 */
export async function consumeOAuthTransaction(
  c: Context<{ Bindings: AppEnv }>,
  state: string,
): Promise<OAuthTransaction | null> {
  const transaction = await c.env.SESSIONS.get<OAuthTransaction>(oauthKey(state), 'json')
  if (!transaction) return null

  await c.env.SESSIONS.delete(oauthKey(state))
  return transaction
}

function issueSessionCookie(c: Context<{ Bindings: AppEnv }>): string {
  const sid = randomToken()

  setCookie(c, SESSION_COOKIE, sid, {
    path: '/',
    httpOnly: true,
    // Lax, not Strict: the provider sends the user back via a top-level GET
    // navigation, and Strict would withhold the cookie on exactly that request.
    sameSite: 'Lax',
    // localhost is plain http in development; anything else must be https.
    secure: new URL(c.req.url).protocol === 'https:',
    maxAge: SESSION_TTL_SECONDS,
  })

  return sid
}
