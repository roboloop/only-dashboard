# only-dashboard

**One box to set your stream title and category on Twitch, Kick and VK Video Live at the same time.**

[![CI](https://github.com/roboloop/only-dashboard/actions/workflows/ci.yml/badge.svg)](https://github.com/roboloop/only-dashboard/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Live at [only-dashboard.stream](https://only-dashboard.stream/)**

## Why

If you go live on more than one platform, you already know the routine: type the same stream title
into Twitch, then into Kick, then into VK Video Live, then notice one of them still says what you
were playing last Tuesday.

only-dashboard is a single page that talks to all three. Connect your accounts once, type the title
once, hit save, and every connected platform gets it.

## What it does

- **One title, everywhere.** Type it once; it's pushed to every platform you've connected.
- **Categories, picked per platform.** Each platform runs its own catalog — a Twitch game doesn't
  exist as the same thing on Kick — so you search once and click the right match for each platform.
  Skip a platform and it's left alone.
- **Live status cards.** Each platform shows whether you're live, its current title and its current
  category, refreshing on its own every 30 seconds so a change made anywhere else shows up here.
- **Reusable titles and categories.** Recent ones are kept for you, and anything you use regularly
  can be pinned so it stays at the top.
- **One platform's bad day stays there.** If a platform is down, rate-limiting you, or your token
  expired, the error lands on that card — the other saves still go through.
- **Connect and disconnect each platform on its own**, or sign out of everything at once.

## Your accounts stay yours

- Your browser never holds a platform token. It holds an anonymous session id and nothing else —
  there is nothing in local storage to leak, and the page can't read your credentials because it
  never receives them.
- Access tokens are kept server-side, used to talk to the platforms, and never sent to the page.
  There's a test in the suite that fails if a token ever appears in an API response.
- Disconnecting a platform deletes its tokens, and actively revokes them with platforms that offer
  a revocation endpoint.

## Run it yourself

You'll need Node (the version in [`.nvmrc`](.nvmrc)) and a developer app registered on each platform
you want to connect.

```sh
npm install
cp .dev.vars.example .dev.vars   # then fill in the client id/secret for each platform
npm run dev                      # http://localhost:5173
```

Register these callback URLs with the platforms' developer consoles:

```
http://localhost:5173/auth/twitch/callback
http://localhost:5173/auth/kick/callback
http://localhost:5173/auth/vkvideo/callback
```

You can connect just one platform and the rest of the app works fine — nothing requires all three.

Deploying your own copy (Cloudflare KV setup, secrets, production callback URLs) is covered in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#setup).

## Built with

Vue 3 and Pinia on the front, [Hono](https://hono.dev/) on a single
[Cloudflare Worker](https://developers.cloudflare.com/workers/) that serves both the page and the
API, with sessions in Workers KV. There's no separate backend to run and no database to manage.

## Contributing

Bug reports and pull requests are welcome. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains how
the thing actually works — the OAuth differences between the three platforms, how sessions are
stored, and the one Cloudflare routing rule that everything depends on. Worth a read before changing
anything in `src/worker/`.

Before opening a PR:

```sh
npm run type-check && npm run lint && npm run test:unit
```

Adding a fourth platform is mostly one new file in `src/worker/providers/` — see
[Extending](docs/ARCHITECTURE.md#extending).

## License

[MIT](LICENSE) © roboloop
