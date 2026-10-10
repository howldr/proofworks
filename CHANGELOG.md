# Changelog

Notable changes to howldr ProofWorks. Versions follow
[Semantic Versioning](https://semver.org/); while the version starts with `0.`,
any release may change behaviour.

## [0.1.0] — 2026-10-10

First public release, under the MIT licence.

ProofWorks records governance work as audit-ready proof. Every module writes to
one append-only, hash-chained evidence spine, and every decision is a receipt
pinned to the exact version and file hash it was made on.

### Modules

- **Policy Hub** — the policy lifecycle: drafting, staged approval routes
  (quorum or all), optional owner-acceptance and executive gates, distribution
  through LiquidFiles, authenticated staff acknowledgements, and periodic review.
- **Obligations** — what the organisation must honour and why (laws, contract
  clauses, insurance conditions, standards), linked to the policies, risks, and
  evidence that answer them. Unanswered obligations are flagged.
- **Evidence Locker** — the register of proof behind your controls: held,
  fingerprinted, or declared, with verification receipts.
- **Risk Register** — 5×5 inherent and residual scoring in append-only
  assessment rounds, with formal risk acceptance by a named acceptor.
- **Access Reviews** — periodic attestations that access is still appropriate.
- **Vendor Assessments** — third parties assessed as risks, approved or declined
  on the record, with tier-escalated sign-off.

### Platform

- Multi-tenant workspaces with per-workspace module switching.
- Roles: admin, governance lead, owner, authoriser, acceptor, staff, and viewer.
- Audit pack export: one zip an auditor can verify offline, with the ledger's
  hash chain checked at export time.
- Workspace themes and logo.
- Sign-in with Google or Microsoft via Supabase; the API only verifies JWTs.
