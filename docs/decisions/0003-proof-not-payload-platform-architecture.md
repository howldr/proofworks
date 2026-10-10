# ADR 0003 — "Proof, not payload" platform architecture

**Status:** Proposed (captured from ideation, not yet built)
**Date:** 2026-06-12

> This ADR records the platform-level architecture direction for howldr's
> governance suite (of which PLMS / Policy Hub is module 1). It came out of an
> ideation session and is intentionally captured with its diagrams and
> reasoning intact. Nothing here is implemented yet — it is the direction to
> build toward and to revisit before committing engineering.

## Context

howldr is building an "evidence engine" for small/mid organizations that have
obligations (cyber insurance, audits, client questionnaires) but no compliance
team. The product sells **service, structure, a means of data storage, and
accountability**.

The central risk is data custody: if howldr becomes a bucket that all of a
customer's sensitive data pours into, it inherits enormous liability, cost, and
regulatory exposure. howldr should not host customers' private data, especially
at full-suite scale.

The resolution is architectural, and it also changes how certification
questions (SOC 2, HIPAA) apply.

## Decision

### 1. Core posture — proof, not payload

howldr stores evidence *about* data (pointers, receipts, SHA-256 hashes, an
append-only signed audit ledger) — **never the sensitive payload itself.**

Keeping the hash + the proven tool's receipt lets you prove what a thing was and
that it was handled correctly **even after the payload is deleted.** Proof
outlives payload.

```
howldr = system of record for what HAPPENED
         never the warehouse for what it happened TO

  ┌─ holds ──────────────┐     ┌─ never holds ────────┐
  │ • hashes             │     │ • payloads / files   │
  │ • receipts (LF, mask)│     │ • PHI / regulated    │
  │ • pointers / manifest│     │ • customer keys      │
  │ • append-only ledger │     │ • (→ vendor, not BA) │
  └──────────────────────┘     └──────────────────────┘
```

### 2. Liability follows the data, not the software

If the data stays in the customer's plane, howldr is a **software vendor**, not
a data processor / Business Associate → dramatically smaller liability surface.

- **SOC 2** is not a law. It's an AICPA attestation report — a market/procurement
  gate, not a legal requirement. Lacking it costs deals, not legal standing.
- **"HIPAA compliant" is not a cert** — there is no official HIPAA certification.
  HIPAA binds by *role*: handle PHI for a covered entity → you're a Business
  Associate, sign a BAA, meet the Security Rule. Liability = law + contract, not
  a badge.
- **Architecture substitutes for the cert.** "Your data never leaves your plane,
  on your keys" answers the same security-questionnaire objection SOC 2 would —
  so the data-local model shrinks both the liability *and* the need for the cert.
- **Custody no customer keys.** The moment howldr holds decryption keys it is
  back in the blast radius regardless of where the bytes live.

### 3. Two-plane design

```
              ┌─────────────────────────────────────────────┐
              │           CONTROL PLANE (howldr-run)          │
              │           multi-tenant, the ONLY SaaS part    │
              │                                               │
              │  • Fleet registry (who's installed, version,  │
              │    health, last-seen)                         │
              │  • Release service — SIGNED artifacts,        │
              │    stable/canary channels                     │
              │  • Config service — per-tenant config as data │
              │  • License / entitlement                      │
              │  • Telemetry + fleet alerting (heartbeats,    │
              │    "job X overdue on tenant Y") — METADATA    │
              │  • Customer admin portal                       │
              │                                               │
              │   ✗ no evidence  ✗ no files  ✗ no PHI  ✗ no keys│
              └───────────────▲───────────────────────────────┘
                              │  outbound-only, mTLS, per-install identity
                              │  pull updates ↓   push heartbeats ↑
                              │  (howldr NEVER initiates inbound)
              ┌───────────────┴───────────────────────────────┐
              │      DATA PLANE (customer-resident)            │
              │      single-tenant, isolated, owns everything  │
              │                                               │
              │  • App (Next.js + Express)                     │
              │  • PostgreSQL — system of record + append-only │
              │    audit_events ledger                         │
              │  • Object storage (MinIO/S3) — receipts, PDFs, │
              │    hashes (NOT raw sensitive payloads)         │
              │  • Worker + scheduler (BullMQ/Redis) — the     │
              │    governance jobs run HERE                    │
              │  • Secrets/keys — KMS/sealed, CUSTOMER-custodied│
              │  • Connectors: LiquidFiles, SMTP, masking,     │
              │    Entra/SAML — all egress from here           │
              │                                               │
              │   ✓ all sensitive data + key material stays    │
              └───────────────────────────────────────────────┘
```

The boundary is the design: the data plane talks **out** to the control plane
and nothing talks **in**. The control plane ships signed software + config and
receives health beacons; it never sees evidence, files, or keys. Supply-chain
integrity (sign + attest artifacts) is mandatory — the update channel is the one
thing howldr pushes into the customer's trust boundary. Every install must be
**byte-identical** (config-as-data, no per-site forks) or fleet management cost
explodes.

### 4. Deployment is a spectrum, not a binary

Same artifact, four postures. Liability slides as the data leaves howldr's plane.

```
SaaS multi-tenant ──► BYOC ──► on-prem appliance ──► air-gapped
   highest your        (data plane in    ownership +     control-plane
   liability;          customer's own    regulatory      link severed;
   you're the          cloud account —   comfort; more   defense/sovereign/
   processor           THE SWEET SPOT)   ops             contractual only
```

Sell **"your data, your box — we keep it alive."** The customer gets the
ownership/regulatory story; howldr operates the fleet via the control plane so
on-prem doesn't become N snowflakes and a pile of truck-rolls. For most
customers, **BYOC** (data plane in their own cloud subscription) is the best of
both: residency + ownership, no hardware, still centrally managed.

### 5. Modules classified by payload vs proof

The custody risk is **not uniform** — it concentrates in specific modules.

```
PROOF-ONLY (metadata-grade, safe to hold, even SaaS-able at the low end)
├── Policy Hub core (policy docs + lifecycle)
├── Acknowledgements, approvals, review schedules
├── Access-review attestations
├── Vendor-review records, risk register
└── the audit_events ledger itself

PAYLOAD-TOUCHING (never custody → data-plane-local or pure passthrough)
├── Evidence Vault file ingest
├── Data Handling / masking
└── Secure File Transfer of real content
```

Caveat: the acknowledgement ledger holds employee name/email = mild
(directory-grade) PII → still push it data-plane-local. Policy *content* is
near-boilerplate but can be recon-valuable confidential business info → encrypt
at rest, but it is not regulated PII.

### 6. The ingest fork

When a sensitive thing arrives it splits at the boundary — payload one way, proof
the other — and howldr only ever follows the proof.

```
                sensitive thing arrives
                          │
              ════════════╪════════════  ← the boundary
                          │
                ┌─────────┴─────────┐
                │                   │
             PAYLOAD               PROOF
                │                   │
                ▼                   ▼
        data-plane store /     append-only ledger
        LiquidFiles /          • payload_hash (not the payload)
        customer cloud         • pointer/object_ref
                │              • receipt (LF / masking tool)
                │              • actor · action · time
                │              • prev_hash → signature
                ▼                   ▼
        ✗ howldr never         ✓ howldr holds THIS
          holds the bytes        small · safe · the moat
```

### 7. The proof object (per-event)

```
evidence_event
├── id · tenant · timestamp        (signed)
├── actor ──────────── who + role
├── action ─────────── what happened (acknowledged / approved / sent / masked)
├── object_ref ─────── pointer → where the payload lives (LF id, object key, URI)
├── payload_hash ───── SHA-256 of the thing  ✗ NOT the thing
├── receipt ────────── the proven tool's own proof (LF delivery, mask job)
├── prev_hash ──────── chains to the prior event  → tamper-evident
└── signature ──────── so the record itself can't be forged or altered
```

Pointers can rot; keep the **hash + receipt** (small, self-contained) so the
proof survives the payload's deletion. Reference the payload; *own* the proof of
it.

### 8. Write path ≠ read path

- **Writes are append-only and tamper-evident — for everyone, including the
  tenant admin and howldr.** Nobody edits an evidence record. That immutability
  is what makes it proof, not just a log.
- **Reads are RBAC and *logged* — viewing sensitive evidence is itself an
  evidence event.** Auditor role is scoped, time-boxed, and leaves its own
  trail. Immutability makes it proof; access-logging makes the proof survive
  scrutiny (you can show exactly who looked and when).

### 9. Cornerstones — integrated behind swappable connectors

Use proven, available tools; deliver the orchestration + logic; lean hard, marry
none.

- **LiquidFiles** — secure-transfer + non-repudiation layer, and the
  liability-shedding **passthrough** for payloads (file moves person → LF →
  person; howldr keeps the receipt + hash).
- **JAMS-style scheduler** — the "prove it ran / alert if not" engine. (JAMS
  itself was divested Fortra → PSG mid-2025.) Start with own cron/BullMQ; offer
  JAMS for enterprise installs.
- **Third-party masking** (Delphix / Tonic / IRI / Purview) — transforms data
  *in place* in the customer's environment; howldr records the job + before/after
  hashes.

Wrap each behind an abstraction (transfer interface, scheduler interface,
data-handling connector) so a vendor change is a connector swap, not a rewrite.

### 10. The four product pillars → architecture

```
howldr offers ...        ... which in architecture is:
─────────────────────────────────────────────────────────
SERVICE          →   orchestration / workflow engine (run it, schedule it,
                     escalate if it didn't happen)
STRUCTURE        →   the governance data model (obligations, policies, the
                     ontology that gives events meaning)
DATA STORAGE     →   a vault provisioned IN the data plane — howldr makes the
                     box, the customer owns the bytes, howldr holds the manifest
ACCOUNTABILITY   →   append-only tamper-evident proof ledger (hashes, receipts,
                     signatures, chain)
```

## Consequences

- **Smaller liability + lower cost:** not hosting payloads is cheaper,
  lower-liability, *and* more differentiated. "We hold the proof, never your
  payload" beats any competitor who ingests everything. The constraint is the
  product.
- **Selling "proof" raises the bar:** the failure mode isn't "app is down," it's
  "the evidence didn't hold up when it mattered." Design so the **customer owns
  and can export** their evidence intact (trust feature + liability shield).
  Carry tech E&O + cyber liability insurance.
- **Adoption tradeoff:** evidence-by-construction (work runs *through* howldr) is
  harder to fake and more defensible than evidence-by-collection, but requires
  the work to move into the system — higher adoption friction. That tradeoff is
  the go-to-market problem to solve.
- **PLMS reconciliation needed:** today PLMS may store files directly; it should
  move toward storing receipts + pointers + hashes by default, ingesting payload
  only when a customer opts into a data-plane-local deployment.

## Open questions

```
├── obligation / scheduler model ... the "prove it ran, alert if not" engine
├── proof-ledger integrity ......... hash chain + signatures + external timestamp
├── connector abstraction .......... transfer iface (LF) · scheduler iface (JAMS)
└── PLMS reconciliation ............ make it store receipts+pointers, not files
```

## ASCII convention (for future diagrams in this repo)

```
┌─ box ─┐        a component / service / node
└───────┘
   ▲ │           data flow + direction
   │ ▼
  ═══════         a trust / plane boundary (the important line)
  ✓  held / allowed        ✗  never held / blocked
  •  list item inside a node
```

## Related

- ADR 0001 — Authentication in the web layer
- ADR 0002 — Static SPA on Cloudflare Pages
- `docs/specification.md`, `docs/workflow-stages.md`
