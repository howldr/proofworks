# howldr ProofWorks

**Governance, built for proof — powered by LiquidFiles.**

howldr ProofWorks turns governance work — policies, approvals, staff acknowledgements, evidence, and risk decisions — into audit-ready proof. Its modules share one evidence spine: **Policy Hub** (policy lifecycle), **Evidence Locker** (hash-pinned evidence items and evidence packs), and **Risk Register** (5×5 assessments with acceptance receipts). Modules are enabled per workspace.

Policy Hub, the flagship module, handles the full lifecycle of your organisational policies: drafting, approval, distribution, staff acceptance, and periodic review. Every step is backed by LiquidFiles secure messaging with authenticated read receipts and non-repudiation logging — so when an auditor asks who signed off on what and when, you have a clean, server-side answer.

Built and maintained by [howldr Services Group, LLC](https://howldr.com) — Technology. Security. AI.

---

## // what it does

Organisations need policies. Policies need to be written, approved, distributed, acknowledged by staff, and reviewed on a schedule. Most companies do this with email threads, shared drives, and spreadsheets — which works until an auditor, regulator, or incident response asks for proof.

Policy Hub replaces that with a structured, auditable workflow:

```
Initiation → Drafting → Approval → Distribution → Acceptance → Active → Review → (repeat)
```

Every transition is logged. Every approver sign-off produces a non-repudiable read receipt. Every staff acknowledgement is timestamped and tied to an authenticated identity. The policy register gives you a live view of every policy's status, version, and next review date.

---

## // key features

- **Serialised policies** — permanent `POL-YYYY-NNN` identifiers, semantic versioning (draft minor, published major)
- **LiquidFiles folder hierarchy** — deterministic `/current/`, `/drafts/`, `/archive/`, `/acknowledgements/` structure per policy
- **Non-repudiation** — LiquidFiles authenticated Secure Messages with per-recipient download receipts; `authorization: 3` + `private: true` on all audit-critical messages
- **Role-based gates** — policy owners, contributors, approvers, and staff recipients each see and do only what their role permits
- **Policy register** — `register.json` per policy + master CSV export; tracks status, version, owner, approvers, applicable roles, next review date
- **Automated reminders** — configurable reminder cadence for outstanding acceptances (3 / 7 / 14 days); overdue escalation to line managers
- **Scheduled review** — daily scheduler fires 30-day advance warnings, triggers review cycles, escalates overdue reviews
- **New staff onboarding** — automatically sends acceptance messages for all active policies applicable to a new employee's role
- **Audit trail** — every status transition, message ID, read receipt, and download event retained for regulatory inspection
- **Audit event spine** — a cross-module, append-only, hash-chained ledger every module writes to; tampering with any past event breaks the chain, and `GET /api/audit/verify` proves it intact (see [docs/audit-spine.md](docs/audit-spine.md))
- **Suite dashboard** — one cross-module "needs attention" view: policies in flight, overdue reviews, outstanding acknowledgements, expiring evidence, risks awaiting acceptance, and the spine's recent activity
- **Audit pack export** — one zip an auditor can verify offline: evidence + held files, the policy register + every decision receipt, the risk register + assessment rounds + acceptance receipts (when enabled), and the full audit ledger with its hash chain verified at export time — the pack certifies its own integrity in `manifest.json`
- **Risk ↔ policy ↔ evidence links** — risks cite the policies that treat them and the evidence that proves the treatment operates; links are validated references (unknown IDs are rejected), and policy/evidence pages show the risks citing them
- **Access Reviews** *(module)* — CSV-first access attestation: paste an access export, decide each line (keep / flag / remove), and attest the list; the attestation is an append-only receipt with the decision counts pinned, and every step lands on the audit spine
- **Vendor Assessments** *(module)* — a vendor is a risk until understood: 5×5 inherent → residual assessment rounds (append-only), then an **approve or decline** receipt pinned to the round — declining is evidence of due diligence too; high/critical tier vendors escalate the decision to an admin or governance lead

---

## // tech stack

| Layer | Choice |
|---|---|
| API | Node.js 18+ · Express · JSON over REST (`src/`) |
| Web app | Next.js 16 · React 19 · Tailwind 4, built as a static SPA (`web/`) |
| Database | PostgreSQL 14+ (Supabase Postgres in howldr's hosted deployment) |
| Sign-in | Supabase Auth (Google / Microsoft OAuth) in the web app; the API only verifies the JWT |
| Documents, delivery, receipts | LiquidFiles (REST API v4.x) — Secure Messages with authenticated download |
| Scheduler | node-cron (review notices, reminders, receipt polling) |
| Tests | Jest + Supertest |

---

## // repository structure

```
proofworks/
├── README.md · CHANGELOG.md · LICENSE · TRADEMARKS.md · SECURITY.md
├── .env.example                  ← every setting the API reads
├── docs/
│   ├── user-guide.md             ← for people doing the work
│   ├── admin-guide.md            ← for workspace admins
│   ├── specification.md          ← system design
│   ├── audit-spine.md            ← the append-only, hash-chained ledger
│   ├── workflow-stages.md        ← policy lifecycle stages
│   ├── api-reference.md          ← LiquidFiles API integration notes
│   └── decisions/                ← architecture decision records (ADRs)
├── src/                          ← Express JSON API
│   ├── api/                      ← routes, one file per module
│   ├── audit/                    ← evidence spine (hash-chained ledger)
│   ├── auth/ · middleware/       ← JWT verification, tenant + module gates
│   ├── liquidfiles/              ← LiquidFiles API client
│   ├── notifications/ · scheduler/ · register/
│   ├── modules.js                ← the optional modules
│   └── schema.sql                ← idempotent Postgres schema
├── scripts/                      ← migrate, create-tenant, invite-user, set-entitlements
├── tests/                        ← Jest API tests
└── web/                          ← Next.js frontend (static export → Cloudflare Pages)
```

---

## // getting started

### Prerequisites

- **Node.js 22** (the web app pins 22; the API runs on 18+)
- **PostgreSQL 14+**
- **A Supabase project** for sign-in — Google and/or Microsoft OAuth enabled
- **A LiquidFiles appliance** and a service-account API key. LiquidFiles is a
  commercial product; howldr is an authorised reseller.

### 1. The API

```bash
npm install
cp .env.example .env      # fill in DATABASE_URL, SUPABASE_*, LIQUIDFILES_*
npm run migrate           # applies src/schema.sql (idempotent — safe to re-run)
npm run dev               # http://localhost:4000
```

Every setting is described in [`.env.example`](.env.example). `npm start`
migrates and starts in one step, for production.

### 2. A workspace and its first admin

```bash
npm run create-tenant -- --slug=acme --name="Acme Corp" --admin-email=you@acme.com
npm run invite-user   -- --tenant=acme --email=colleague@acme.com --role=owner
node scripts/set-entitlements.js acme policy_hub,obligations,evidence_locker,risk_register,access_reviews,vendor_assessments
```

`create-tenant` prints a sign-in link for the admin. New workspaces get
Policy Hub; `set-entitlements` turns on the other modules.

### 3. The web app

```bash
cd web
npm install
cp .env.example .env.local   # NEXT_PUBLIC_API_BASE_URL + the Supabase URL and publishable key
npm run dev                  # http://localhost:3000
```

No database handy? Run `node scripts/dev-api-stub.js` from the repo root and
point `NEXT_PUBLIC_API_BASE_URL` at `http://localhost:4100`. Leave the Supabase
settings empty to browse with demo data.

### 4. Tests

```bash
npm test                     # API tests — no database or LiquidFiles needed
cd web && npx tsc --noEmit && npm run lint
```

### Deploying

howldr runs the API on Railway and the web app on Cloudflare Pages (root
`web`, output `out` — see [ADR 0002](docs/decisions/0002-static-spa-cloudflare-pages.md)).
Anything that runs Node and serves static files works.

---

## // policy identifier format

```
POL-YYYY-NNN
```

- `YYYY` — four-digit year of initiation
- `NNN` — zero-padded sequential number within that year

Examples: `POL-2025-001`, `POL-2025-042`, `POL-2026-001`

Version format: `vX.Y` where X is the published major version and Y is the draft iteration. `v2.0` is the second published edition. `v2.3` is the third draft of the second review cycle.

---

## // lifecycle stages

| Status | What's happening |
|---|---|
| `DRAFT` | The owner is writing or revising the policy |
| `UNDER_REVIEW` | Submitted; approvers sign off stage by stage (quorum or all) |
| `OWNER_ACCEPTANCE` | *Optional, per workspace* — the owner formally accepts the approved version |
| `EXEC_REVIEW` | *Optional, by category* — an executive authorises it |
| `PENDING_ACCEPTANCE` | Distributed; waiting for staff acknowledgements |
| `ACTIVE` | Everyone required has acknowledged; the policy is live |
| `RETIRED` | Withdrawn |

Any approval step can send the policy back to `DRAFT`. A review cycle starts a
new draft version; every decision is a receipt pinned to the exact version and
file hash. Full detail: [docs/workflow-stages.md](docs/workflow-stages.md).

---

## // non-repudiation

Policy Hub uses LiquidFiles' authenticated Secure Message feature for all audit-critical events. When `authorization: 3` is set on a message, LiquidFiles requires the recipient to authenticate before access and records:

- Authenticated email identity
- Timestamp of access
- IP address
- Download count per recipient

This log lives on your LiquidFiles infrastructure and constitutes the evidentiary record for regulatory compliance. Retain LiquidFiles access logs for the minimum period required by your regulatory framework (typically 5–7 years).

---

## // howldr

ProofWorks is free to run yourself. howldr also offers it as a service on [howldr.com](https://howldr.com), alongside howldr's Secure File Transfer product. Both are powered by LiquidFiles.

- **Hosted** — howldr runs everything. Your branding, your policies, our infrastructure.
- **Self-hosted, supported** — deploy on your own VMware, AWS, or Azure environment. howldr handles setup, handoff, and ongoing support.
- **Self-hosted, on your own** — clone this repository and run it. Enable modules for a workspace with `scripts/set-entitlements.js`.

**ProofWorks needs a LiquidFiles appliance.** LiquidFiles is a commercial product with its own licence, and howldr is an authorised reseller.

Questions: [hello@howldr.com](mailto:hello@howldr.com)

---

## // licence

The code is [MIT-licensed](LICENSE) — © 2025-2026 howldr Services Group, LLC. Use it, change it, host it.

The names "howldr" and "ProofWorks" and the howldr logo are not covered by the MIT licence. See [TRADEMARKS.md](TRADEMARKS.md) for how to name a fork or a hosted offering. To report a vulnerability, see [SECURITY.md](SECURITY.md). Why the code is MIT: [ADR 0004](docs/decisions/0004-mit-licence-service-business.md).
