# only-dashboard

Connect a streamer's **Twitch**, **Kick** and **VK Video Live** accounts and show each platform's
current stream title. A Vue 3 SPA and a Hono API served by one Cloudflare Worker.

## How auth works

The client secrets are real and the access tokens are credentials for the user's streaming accounts,
so nothing sensitive is allowed near the browser:

```
browser                     Worker                        KV
 cookie sid=<opaque>   ──▶  read session:<sid>  ────────▶  { connections: {
 HttpOnly, SameSite=Lax     attach Bearer                      twitch: {access,refresh,expiresAt},
 Secure when https          server-side                        kick:   {...} } }
                            │
                            └─▶ platform API ──▶ display fields only ──▶ /api/me
```

- **Secrets stay in the Worker.** Never in the bundle, never in a `VITE_*` var (those are inlined
  into client JS at build time), never in the repo.
- **Tokens never reach the browser.** `/api/me` returns display fields only. There is a test that
  asserts the serialized response contains neither the access nor the refresh token.
- **The PKCE verifier and OAuth `state` are server-side too**, in KV, short-TTL and single-use, so a
  replayed callback URL fails.

Reload-persistence follows from this rather than being bolted on: the cookie *is* the state, so
there is nothing in `localStorage` to go stale and no token for client JS to leak.

Two KV key shapes, both TTL'd so nothing needs manual cleanup:

| Key | Holds | TTL |
| --- | --- | --- |
| `session:<sid>` | per-platform tokens | 30 days, extended on use |
| `oauth:<state>` | one in-flight authorization (`provider`, `codeVerifier`) | 10 min, deleted on first use |

`SameSite=Lax` is deliberate. The provider sends the user back via a top-level GET navigation, which
Lax permits; `Strict` would withhold the cookie on exactly that request, so the session would look
empty only on the callback.

## The three platforms are not the same protocol

"OAuth 2.0" varies enough between them that the differences are data on a `Provider` record
(`src/worker/providers/`) rather than branches in the flow. Only `fetchStatus` is bespoke per
platform; `src/worker/providers/oauth.ts` handles the rest for all three.

| | Twitch | Kick | VK Video Live |
| --- | --- | --- | --- |
| Client auth | body params | body params | **HTTP Basic header** |
| PKCE | no | **yes (S256)** | no |
| Scope separator | space | space | **comma** |
| `redirect_uri` on refresh | no | no | **required** |
| Scopes needed to read a title | **none** | `user:read channel:read` | **none** |

The refresh column is the sharp edge: VK is the only one that needs `redirect_uri` when refreshing,
and omitting it fails an hour later, not at connect time.

### Endpoints

| | Twitch | Kick | VK Video Live |
| --- | --- | --- | --- |
| Authorize | `id.twitch.tv/oauth2/authorize` | `id.kick.com/oauth/authorize` | `auth.live.vkvideo.ru/app/oauth2/authorize` |
| Token | `id.twitch.tv/oauth2/token` | `id.kick.com/oauth/token` | `api.live.vkvideo.ru/oauth/server/token` |
| Revoke | — | — | `api.live.vkvideo.ru/oauth/server/revoke` |
| Title | `helix/channels?broadcaster_id=` → `title` | `public/v1/channels` (no params) → `stream_title` | `v1/current_user` → `v1/channel` → `stream.title` |

Twitch needs `Client-Id` alongside the bearer token on every Helix call. Kick's channels endpoint
called with no parameters returns the token holder's own channel, so it needs no identity lookup;
VK has no such shortcut and takes two calls.

## Redirect URIs

Registered with each platform — note they are **not** under `/api`, so the Worker routes them
explicitly before the SPA fallback:

```
http://localhost:5173/auth/twitch/callback
http://localhost:5173/auth/kick/callback
http://localhost:5173/auth/vkvideo/callback
```

`redirect_uri` is derived from the incoming request's origin rather than hard-coded, so the same
build works on localhost, on `wrangler dev` (port 8787) and on `workers.dev`. **Register the
production callbacks with all three platforms before deploying.**

## Setup

```sh
npm install

# 1. Create the KV namespace and paste both ids into wrangler.jsonc
npx wrangler kv namespace create SESSIONS
npx wrangler kv namespace create SESSIONS --preview
npm run cf-typegen

# 2. Fill in .dev.vars (already created, gitignored, currently empty)
```

`.dev.vars` needs the six credentials; `.dev.vars.example` lists the names. For production set the
same six with `npx wrangler secret put <NAME>`.

Local `vite dev` and `wrangler dev` simulate KV, so the placeholder ids in `wrangler.jsonc` are
enough to develop against — real ids are only needed to deploy.

## Request flow

```
request
  └─ Worker  (src/worker/index.ts)
       ├─ /auth/<provider>/start     → 302 to the platform
       ├─ /auth/<provider>/callback  → exchange code, store tokens, 302 to /
       ├─ /api/me                    → per-platform display state
       ├─ /api/auth/<p>/disconnect   → revoke where supported, drop the connection
       ├─ /api/* (unmatched)         → JSON 404
       └─ *                          → env.ASSETS → dist/client (SPA fallback)
```

Because the Worker sets `main`, requests that don't match a built file are handed to the **Worker**,
not resolved by Cloudflare's asset router — hence the explicit `app.all('*', …)` at the end of
`src/worker/index.ts`. Remove it and every client-side route 404s. The `/api/*` catch-all matters for
the same reason: without it an unknown API path falls through to the SPA and a `fetch()` expecting
JSON receives HTML.

`/api/me` fans out to the connected platforms in parallel and each result is independent — one
platform being down or token-expired renders as an error on that card, not a failed page. Tokens are
refreshed on demand: near expiry, or once on a 401, after which a failed refresh drops the connection
so the card offers Connect again.

## Layout

```
src/
  shared/types.ts        the contract — by construction, only what the browser may see
  worker/
    index.ts             routes
    session.ts           cookie + KV session and OAuth transaction storage
    status.ts            tokens → display state, with refresh-on-demand
    crypto.ts            base64url, random tokens, PKCE S256
    env.ts               bindings + the six secrets
    providers/           oauth.ts (shared flow) + twitch/kick/vkvideo
  stores/session.ts      Pinia store over /api/me
  components/ProviderCard.vue
  views/DashboardView.vue
```

## Commands

```sh
npm run dev          # http://localhost:5173 — Vite HMR with the real Worker in workerd behind it
npm run type-check   # vue-tsc across the app, node, vitest and worker projects
npm run lint         # oxlint + eslint
npm run test:unit    # vitest
npm run preview      # production build served by wrangler dev
npm run cf-typegen   # regenerate worker-configuration.d.ts after editing wrangler.jsonc
npm run deploy       # build + wrangler deploy
```

### The tsconfig split

Four TS projects, and the split is load-bearing. Worker code must never be compiled with the DOM lib:
`Request`, `Response` and `fetch` exist in both lib sets with different shapes, and mixing them
produces errors that don't look like the actual cause.

- `tsconfig.app.json` — the Vue app, DOM libs, **excludes `src/worker/**`**
- `tsconfig.worker.json` — Worker + `src/shared`, workerd globals, no DOM
- `tsconfig.vitest.json` — jsdom tests, **excludes `src/worker/**`** (worker tests belong to the worker project)
- `tsconfig.node.json` — the config files themselves

Anything both sides import belongs in `src/shared/`.

## Deploying

Cloudflare Workers Builds — pushes to `main` deploy, PRs get preview URLs. Dashboard setup:
**Workers & Pages → Create → Import a repository**, build command `npm run build`, deploy command
`npx wrangler deploy`, root `/`. `.nvmrc` pins Node 24 for the builder.

Before the first deploy: real KV ids in `wrangler.jsonc`, the six secrets via `wrangler secret put`,
and the production callback URLs registered with all three platforms.

## Extending

Writing the title back is one method per provider behind the same registry, and only the scope lists
change: Kick `channel:write`, Twitch `channel:manage:broadcast`, VK
`POST /v1/channel/stream/edit` with `channel:stream:settings`.

Adding a platform is a new file in `src/worker/providers/` plus an entry in its registry — the flow
itself needs no changes unless the platform differs along some axis beyond the four in the table.
