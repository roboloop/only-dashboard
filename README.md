# only-dashboard

A Vue 3 + TypeScript SPA and a Hono API, served by a **single** Cloudflare Worker.

Deliberately a hello-world, but a structurally complete one: same-origin frontend and backend,
types shared between them, and a deploy path that already works end to end.

## Stack

| Layer | Choice |
| --- | --- |
| Frontend | Vue 3, vue-router, Pinia, Vite |
| Backend | Hono on Cloudflare Workers |
| Language | TypeScript |
| Tests | Vitest (+ @vue/test-utils) |
| Lint/format | oxlint, ESLint, Prettier |
| Hosting | Cloudflare Workers with static assets |

## How a request is served

```
request
  └─ Worker  (src/worker/index.ts)
       ├─ /api/*  → Hono handlers → JSON
       ├─ /api/*  (unmatched) → JSON 404
       └─ *       → env.ASSETS → dist/client
                     └─ no matching file? → index.html (SPA fallback)
```

One Worker owns both halves, so the frontend calls `/api/...` on its own origin — no CORS, no
second deployment, no environment-specific API base URL.

Two details worth knowing before you change `wrangler.jsonc`:

- Because the Worker sets `main`, requests that don't match a built file are handed to the **Worker**,
  not resolved by Cloudflare's asset router. That's why `src/worker/index.ts` ends with an explicit
  `app.all('*', c => c.env.ASSETS.fetch(c.req.raw))`. Remove it and every client-side route 404s.
- `not_found_handling: "single-page-application"` is what makes that binding return `index.html` for
  an unknown path, which vue-router's history mode depends on.

The `/api/*` catch-all 404 matters for the same reason: without it an unknown API path would fall
through to the SPA and a `fetch()` expecting JSON would receive HTML.

## Layout

```
src/
  shared/types.ts       response shapes imported by BOTH sides — the contract
  worker/
    index.ts            Hono app: routes, JSON 404, error handler, SPA fallback
    data.ts             dummy dashboard data (swap this for D1/KV later)
    __tests__/          API tests via app.request(), no workerd needed
  composables/useApi.ts typed fetch → { data, error, loading, refresh }
  views/                HomeView (/api/hello + Pinia), StatsView (/api/stats)
  router/, stores/
```

## Local development

```sh
npm install
npm run dev          # http://localhost:5173 — Vite HMR, with the real Worker
                     # running in workerd behind it, so /api/* behaves as in prod
```

`@cloudflare/vite-plugin` runs the actual Worker in dev, so there is no proxy config and no
dev/prod divergence to get caught by.

```sh
npm run type-check   # vue-tsc across the app, node, vitest and worker projects
npm run lint         # oxlint + eslint, both with --fix
npm run format       # prettier
npm run test:unit    # vitest, single run
npm run test:watch   # vitest, watch mode
npm run preview      # production build served by wrangler dev — closest to prod
npm run cf-typegen   # regenerate worker-configuration.d.ts (run after editing wrangler.jsonc)
```

### The tsconfig split

There are four TS projects, and the split is load-bearing rather than incidental:

- `tsconfig.app.json` — the Vue app. DOM libs. **Excludes `src/worker/**`.**
- `tsconfig.worker.json` — the Worker and `src/shared`. Workers globals from
  `worker-configuration.d.ts`, no DOM lib.
- `tsconfig.vitest.json` — tests, jsdom. **Excludes `src/worker/**`** (worker tests are checked by
  the worker project).
- `tsconfig.node.json` — the config files themselves.

Worker code must never be compiled with the DOM lib: `Request`, `Response` and `fetch` exist in both
lib sets with different shapes, and mixing them produces type errors that don't look like the actual
cause. If you add a directory that both sides import, put it in `src/shared/`.

## Deploying

Deploys are handled by **Cloudflare Workers Builds** — pushes to `main` deploy, PRs get preview URLs.
There is no CI workflow in this repo and no API token in GitHub secrets, by design.

One-time setup in the Cloudflare dashboard:

1. **Workers & Pages** → **Create** → **Import a repository**
2. Authorize the GitHub app and pick `roboloop/only-dashboard`
3. Build settings:
   - Project name: `only-dashboard`
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
   - Root directory: `/`
4. Deploy — you get `only-dashboard.<subdomain>.workers.dev`

`.nvmrc` pins Node 24 for the builder; Vite 8 requires `^20.19.0 || >=22.12.0`.

To deploy by hand instead:

```sh
npm run deploy       # build + wrangler deploy
```

`vite build` writes the client to `dist/client` and the Worker to `dist/only_dashboard`, along with a
rewritten `wrangler.json`. Wrangler picks that up automatically via `.wrangler/deploy/config.json`,
which is why plain `wrangler deploy` works from the repo root after a build.

## Adding real data

`src/worker/data.ts` is the only file holding dummy values. To move to D1:

```sh
npx wrangler d1 create only-dashboard-db
```

Add the returned binding to `wrangler.jsonc`, run `npm run cf-typegen` so `Env` picks it up, then
replace the `STATS` constant with a query behind the same `StatsResponse` type. The frontend needs no
changes — that's what `src/shared/types.ts` is for.

## Verifying a deploy

Against any URL (dev, preview, or production), these four checks cover the whole surface:

```sh
curl -s $URL/api/health          # {"ok":true,...}, content-type application/json
curl -s $URL/api/stats           # the dummy rows
curl -s -o /dev/null -w '%{http_code}\n' $URL/api/nope    # 404, as JSON not HTML
curl -s -o /dev/null -w '%{http_code}\n' $URL/stats       # 200 text/html — SPA fallback
```

The last one is the one that breaks first if `wrangler.jsonc` is edited carelessly.
