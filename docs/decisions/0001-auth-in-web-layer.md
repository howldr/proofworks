# ADR 0001 — Authentication lives in the web layer

**Status:** Accepted
**Date:** 2026-06-04

## Context

Policy Hub is split into two programs:

- **`src/` — Express backend (API server).** Pure JSON API. Owns the database,
  the LiquidFiles integration, the scheduler, and all business logic. Already
  verifies Supabase-issued JWTs in `src/middleware/auth.js` and provisions users
  via Supabase invite links (`scripts/_admin-client.js`).
- **`web/` — Next.js frontend (UI).** The browser-facing dashboard. Currently a
  bare scaffold.

We needed to decide where the user-facing login flow (OAuth sign-in) lives.

## Decision

**Authentication is owned by the web layer (`web/`), not the Express backend.**

- The Next.js app drives the login flow using the Supabase JS client.
- Sign-in is via **OAuth — Google and Microsoft** as identity providers,
  configured in Supabase.
- Supabase handles the OAuth dance and issues a JWT to the web app.
- The web app attaches that JWT as a `Bearer` token on every call to the Express
  backend.
- The Express backend's role is unchanged: it only *verifies* the JWT
  (`src/middleware/auth.js`) and applies role/tenant gates. It never talks to
  Google or Microsoft directly and serves no login pages.

## Consequences

- The Express backend stays a pure JSON API — no view rendering, no OAuth
  redirect handling added to it.
- Existing JWT verification works unchanged; the web app just needs to produce a
  Supabase JWT.
- New work needed in `web/`: Supabase client setup, Google/Microsoft sign-in UI,
  OAuth callback handling, session management, and a JWT-attaching API client.
- Supabase project must have Google and Microsoft OAuth providers enabled.
- Note: `.env.example` is stale (predates the Supabase migration). The real
  config keys are `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and
  `SUPABASE_JWT_SECRET` (backend), plus public Supabase URL + anon key for the
  web app. This should be reconciled.

## Alternatives considered

- **Express serves login pages / handles OAuth redirects.** Rejected — would add
  view rendering and OAuth flow handling to a server that is currently pure JSON,
  for no benefit. Supabase + Next.js is the supported, simpler path.
