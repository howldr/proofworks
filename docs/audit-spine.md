# Audit Event Spine

**howldr ProofWorks — core (not module-gated)**

The spine is the cross-module, append-only, hash-chained ledger. Every
instrumented action in every module lands here in one normalized shape, so
"what happened in this workspace" is a single query — and the answer is
tamper-evident.

---

## // why it exists

Each module keeps its own event table (`policy_changelog`, `evidence_events`,
`risk_events`) as module-local detail. The spine is the layer above them
(ADR 0003 §7–8): one table, one shape, one integrity guarantee, feeding the
suite dashboard, the audit pack, and chain verification.

```
policy action ──► logChange ─────────┐
evidence action ► logEvidenceEvent ──┼──► appendAuditEvent ──► audit_events
risk action ────► logRiskEvent ──────┘         (hash chain)
```

Writers don't call the spine directly from routes — it is fed automatically by
the existing `db.logChange` / `db.logEvidenceEvent` / `db.logRiskEvent`
chokepoints. Future modules may call `db.appendAuditEvent` directly.

## // the chain

Each event is chained to its predecessor **per tenant**:

```
event_hash = sha256( prev_hash + '\n' + canonicalise(core fields) )
```

- Core fields: `tenant_id, occurred_at, actor_email, action, object_type,
  object_id, metadata` — canonicalised with sorted keys so the same logical
  event always hashes identically (`src/audit/spine.js`).
- Genesis `prev_hash` is 64 zeros.
- Appends are serialised per tenant with a transaction-scoped advisory lock,
  so concurrent writers cannot chain onto the same predecessor.
- Editing, deleting, or reordering **any** past row breaks every hash after
  it. A `BEFORE UPDATE OR DELETE` trigger additionally rejects mutation at the
  database layer, so immutability doesn't depend on application discipline.
- Spine rows carry **no foreign key to their objects** — a deleted policy's
  history is still evidence.
- Per-event signatures are deferred until a key-custody story exists
  (ADR 0003); the chain carries the integrity guarantee until then.

## // API

Mounted behind `requireTenant + requireUser + requireSameTenant +
requireRole(admin | governance_lead | viewer | howldr_support)`. Read-only —
the spine has no write endpoints.

| Route | Purpose |
|---|---|
| `GET /api/audit` | List events, latest first. Filters: `?object_type=`, `?object_id=`, `?action=`, `?limit=` (default 100, max 500). |
| `GET /api/audit/verify` | Recompute the tenant's whole chain from genesis. Returns `{ intact, events_checked, break_at, reason }`. |

## // failure policy

`appendAuditEvent` failures **propagate** — an action isn't complete until its
evidence is recorded. This is evidence-by-construction, not best-effort
logging.

## // what writes today

| Module | Feeder | `object_type` |
|---|---|---|
| Policy Hub | `db.logChange` (status transitions, approvals, distribution, acknowledgements, reviews) | `policy` |
| Evidence Locker | `db.logEvidenceEvent` (registered, file, fingerprint, verify, retire) | `evidence` |
| Risk Register | `db.logRiskEvent` (created, assessed, accepted, closed, reopened) | `risk` |
| Access Reviews | `db.appendAuditEvent` directly (opened, lines added, attested, reopened) | `access_review` |
| Vendor Assessments | `db.logVendorEvent` (registered, assessed, approved/declined, offboarded, reactivated) | `vendor` |
| Obligations | `db.logObligationEvent` (recorded, updated, reviewed, retired, reactivated) | `obligation` |

---

*howldr ProofWorks · [howldr.com](https://howldr.com)*
