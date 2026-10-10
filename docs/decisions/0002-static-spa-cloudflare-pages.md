# ADR 0002 — Frontend is a static SPA on Cloudflare Pages

**Status:** Accepted
**Date:** 2026-06-04
**Relates to:** [ADR 0001](0001-auth-in-web-layer.md)

## Context

The `web/` Next.js app needed a hosting target. The API already runs on Railway.
The frontend is almost entirely static (the only server-rendered piece was an
API-health card), and ADR 0001 already put **auth in the browser** via the
Supabase client — an inherently client-side model.

Options weighed: Railway (full Next server, same platform as the API),
Cloudflare Pages as a static SPA, or Cloudflare via the OpenNext adapter for full
SSR (Next 16 adapter support was a risk).

## Decision

**The frontend is built as a static export (`output: 'export'`) and deployed to
Cloudflare Pages** — a single-page-app model where all data fetching and auth run
client-side. No server runtime.

Rationale:
- Matches ADR 0001 (client-side Supabase OAuth).
- The app is already ~static; making it fully static was a ~15-minute refactor.
- On-brand domain (`*.howldr.com`) with DNS already on Cloudflare; free tier;
  global CDN; no always-on server.
- Avoids the OpenNext-on-Cloudflare Next 16 compatibility risk entirely.

## Consequences

- `web/next.config.ts` sets `output: 'export'`; `next build` emits `web/out/`.
- No Next *server* components for data — fetch from the Express API in the
  browser (with the Supabase JWT). No server middleware for route guards; guard
  client-side.
- The `/` → `/dashboard` redirect is handled by `web/public/_redirects` at the
  Cloudflare edge, with a client-side fallback in `app/page.tsx`.
- The API-health card (`api-status.tsx`) is a client component.
- Cloudflare Pages build config: root directory `web`, build command
  `npm run build`, output directory `out`, Node 22 (`.nvmrc` / `NODE_VERSION`).
- Dynamic routes (e.g. `/policies/[id]`) will need `generateStaticParams` when
  built, or client-side rendering.
- The Railway Node pin (`web/.nvmrc`, `engines.node`) from the earlier Railway
  plan is retained — Cloudflare Pages reads it too.

## Alternatives considered

- **Railway (full Next server).** Simple, one platform, runs any Next feature —
  but an always-on Node server for static content, off to the side from the
  howldr/Cloudflare world. Reasonable fallback if we later need Next server
  components.
- **Cloudflare + OpenNext (full SSR).** Most flexible, but Next 16 adapter
  support was an unnecessary risk for an app that doesn't need SSR.
