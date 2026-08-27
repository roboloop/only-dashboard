# Architecture

Design notes for only-dashboard — how the OAuth, session and routing layers actually work, and the
traps that are not obvious from the code. See [the README](../README.md) for what the app is and how
to run it.

A Vue 3 SPA and a Hono API served by one Cloudflare Worker, connecting a streamer's **Twitch**,
**Kick** and **VK Video Live** accounts.

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
| Scopes requested | `channel:manage:broadcast` | `user:read channel:read channel:write` | `channel:stream:settings` |

Reading a title needs no scopes anywhere; the requested scopes exist for *writing* the title and
category back (`updateStream`). A token minted before the write scopes were requested still reads
fine — `/api/me` flags it as `needsReauth` and the card offers Reconnect instead of a doomed save.

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

# 2. Copy .dev.vars.example to .dev.vars and fill in the six credentials
```

`.dev.vars` needs the six credentials; `.dev.vars.example` lists the names. For production set the
same six with `npx wrangler secret put <NAME>`.

Local `vite dev` and `wrangler dev` simulate KV, so the placeholder ids in `wrangler.jsonc` are
enough to develop against — real ids are only needed to deploy.

`wrangler.jsonc` is committed on purpose, KV ids included: namespace ids are resource identifiers,
not credentials, and are inert without Cloudflare account auth. The actual secrets are the six OAuth
values in `.dev.vars` (gitignored) and your Cloudflare API token — neither is in the repo.

### Known dev-server quirk

Editing `.dev.vars` or `wrangler.jsonc` **while `npm run dev` is running** can throw up a Vite error
overlay:

> Cannot read properties of null (reading 'invalidateTypeCache')

It is harmless and self-clearing — dismiss it, or restart the dev server. `@cloudflare/vite-plugin`
restarts Vite when either file changes, which resets `@vitejs/plugin-vue`'s lazily-resolved
`compiler` to null, and the same file-change event can race into `handleHotUpdate` before the new
instance's `buildStart` re-resolves it. Upstream has no null guard there as of `@vitejs/plugin-vue`
6.0.8. It cannot affect a production build — `handleHotUpdate` only exists in dev — and
`server.watch.ignored` is *not* the fix: the Cloudflare plugin needs that same watcher event to
reload your secrets.

## Request flow

```
request
  │
  ├─ path matches assets.run_worker_first  ──▶  Worker (src/worker/index.ts)
  │    ("/auth/*", "/api/*")                      ├─ /auth/<p>/start     → 302 to the platform
  │                                               ├─ /auth/<p>/callback  → exchange code, 302 to /
  │                                               ├─ /api/me             → per-platform state
  │                                               ├─ /api/stream/…       → title/category saves (fan-out)
  │                                               ├─ /api/categories/…   → per-platform category search
  │                                               ├─ /api/history…       → title/category history + pins
  │                                               ├─ /api/auth/<p>/…     → disconnect, logout
  │                                               ├─ /api/* (unmatched)  → JSON 404
  │                                               └─ *                   → env.ASSETS
  │
  └─ everything else  ──▶  asset router ──▶ dist/client
                             └─ no matching file? → index.html (SPA fallback)
```

**The asset router runs before the Worker.** This is the single most surprising thing in the setup
and it is easy to get wrong. With `not_found_handling: "single-page-application"`, the asset layer
answers any browser *navigation* to an unmatched path with `index.html` and the Worker is never
invoked. Setting `main` does not change that.

That is why `assets.run_worker_first` in `wrangler.jsonc` lists `/auth/*` and `/api/*`. Without it,
`/auth/<provider>/start` and the provider's redirect back to `/auth/<provider>/callback` are both
served the SPA, and the entire OAuth flow dies with a vue-router "No match found" in the console.

**Any new Worker route reachable by a top-level navigation must be added to `run_worker_first`.**
`src/__tests__/routing-config.spec.ts` enforces this for every provider's start and callback path.

The trap is that this is invisible to `curl` and to the Hono tests. The discriminator is the
`Sec-Fetch-Mode: navigate` header, which only a real top-level navigation sends — `fetch`, XHR and
plain `curl` all reach the Worker fine. To test a route the way a browser hits it:

```sh
curl -s -o /dev/null -w '%{http_code}\n' -H 'Sec-Fetch-Mode: navigate' \
  http://localhost:5173/auth/twitch/start     # 302, not 200
```

The Worker still ends with `app.all('*', …)` delegating to `env.ASSETS`, which covers paths routed to
it by `run_worker_first` that none of its routes match. The `/api/*` JSON-404 catch-all matters
separately: without it an unknown API path falls through to the SPA and a `fetch()` expecting JSON
receives HTML.

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
    history.ts           KV-backed title/category history with pinning
    status.ts            tokens → display state, with refresh-on-demand (withFreshTokens)
    crypto.ts            base64url, random tokens, PKCE S256
    env.ts               bindings + the six secrets
    providers/           oauth.ts (shared flow) + twitch/kick/vkvideo
  stores/
    session.ts           Pinia store over /api/me
    stream.ts            title/category drafts, per-platform search, history
  components/
    ProviderCard.vue     one platform's status micro-card
    TitleBlock.vue       shared title editor + history
    CategoryBlock.vue    category search + per-platform selectors + recents
    CategorySelector.vue one platform's candidate column
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

Writing the title and category back is implemented: `updateStream` and `searchCategories` are one
method per provider behind the same registry (Kick `channel:write`, Twitch
`channel:manage:broadcast`, VK `POST /v1/channel/stream/edit` with `channel:stream:settings`), and
`PATCH /api/stream/title` / `PATCH /api/stream/category` fan out to every connected platform with
per-platform results — one platform failing never blocks the others.

Adding a platform is a new file in `src/worker/providers/` plus an entry in its registry — the flow
itself needs no changes unless the platform differs along some axis beyond the four in the table.
