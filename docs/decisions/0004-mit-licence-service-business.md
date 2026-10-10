# ADR 0004 — MIT licence; the business is the service, not the software

**Status:** Accepted
**Date:** 2026-10-09

## Context

ProofWorks shipped under a custom source-available licence ("all rights
reserved"; no production use without a licence from howldr; no redistribution;
no competing service). That licence assumed howldr would sell rights to the
software.

The owner does not want to sell rights to the software. The aim is for the code
to be openly available to anyone who finds it useful, and to demonstrate the
infrastructure, cybersecurity, and GRC engineering behind howldr's services.
Revenue comes from **hosting** (howldr-hosted ProofWorks) and **support**
(setup, handoff, and ongoing support for self-hosted deployments) — and from the
LiquidFiles licence ProofWorks depends on, which howldr resells.

## Decision

1. **The code is licensed under MIT**, copyright howldr Services Group, LLC. The
   custom source-available `LICENSE` is replaced.
2. **The names are not.** "howldr", "howldr ProofWorks", and the howldr marks
   are reserved in `TRADEMARKS.md`. Forks are welcome; a fork or a hosted
   offering must not present itself as howldr or ProofWorks. The brand — not the
   code — is what distinguishes the hosted service.
3. **Module entitlements stay, re-scoped.** `tenants.entitlements` and
   `requireModule()` remain the mechanism that switches modules on per
   workspace. They are product configuration, not licence enforcement:
   - howldr-hosted: howldr enables modules as part of the hosted service.
   - self-hosted: the operator enables whatever they want with
     `scripts/set-entitlements.js`.
   The planned "signed license key" flow for self-hosted is **dropped** — under
   MIT any such check could be removed, so it would only add friction.
4. **User-facing copy says "enabled for your workspace", not "licensed".**
   Internal names (`entitlements`, `requireModule`, `MODULE_KEYS`) are unchanged.

## Consequences

- Anyone may host ProofWorks, including commercially. Accepted: the hosted
  service, support, and brand are the product.
- ProofWorks requires a LiquidFiles appliance (a commercial product). Self-hosters
  need a LiquidFiles licence; howldr is an authorised reseller. The README says so.
- Before the repository is made public: full-history secret scan (done
  2026-10-09 — gitleaks v8.24.3, 107 commits, no leaks; plus a manual pattern
  pass over every added line), and `SECURITY.md` for vulnerability reports.
- Historical records (ADRs 0001–0003) keep their original wording — they
  describe what was decided at the time.
- The public repository starts from a single commit. Development history before
  it is kept privately.
