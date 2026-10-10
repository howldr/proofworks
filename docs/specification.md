# Policy Hub — System Design & Integration Specification

**Version 1.0 | howldr Services Group, LLC**

---

## 1. Purpose and scope

This document specifies the design, workflow, data structures, and integration architecture for Policy Hub — the flagship module of **howldr ProofWorks** (originally specified standalone as howldr's Policy Lifecycle Management System, PLMS). The module manages the full lifecycle of organisational policies from initiation through drafting, approval, distribution, staff acceptance, and periodic review.

LiquidFiles serves as the secure document storage, versioning, and communication platform. Its authenticated secure messaging, download receipts, and non-repudiation logging provide the evidentiary trail required for regulatory compliance and audit.

**Scope of this document.** This specification covers **Policy Hub** only. ProofWorks
is now a suite of modules built on a shared, append-only evidence spine — alongside
Policy Hub sit the **Obligations**, **Evidence Locker**, **Risk Register**,
**Access Reviews**, and **Vendor Assessments** modules, each enabled per tenant
and writing to the same hash-chained event ledger.
Those modules are documented for users in the [User Guide](user-guide.md) and for
administrators in the [Admin & Support Guide](admin-guide.md); the ledger itself is
specified in [Audit event spine](audit-spine.md). The design below is specific to the
policy lifecycle.

---

## 2. System overview

Policy Hub is composed of four logical layers:

- **Workflow engine** — orchestrates lifecycle state transitions and enforces role-based gates
- **Document store** — LiquidFiles shared folders with a deterministic folder hierarchy
- **Notification layer** — LiquidFiles Secure Messages with authentication required, delivering non-repudiable read receipts
- **Policy register** — a master index of all policies, their serialised IDs, current version, status, and next review date

---

## 3. Policy serialisation and versioning

### 3.1 Policy identifier format

Every policy is assigned a permanent identifier at initiation:

```
POL-YYYY-NNN
```

`YYYY` is the four-digit year of initiation. `NNN` is a zero-padded three-digit sequential number within that year.

Examples: `POL-2025-001`, `POL-2025-002`

### 3.2 Version numbering

Versions follow semantic versioning adapted for policy use:

- **Major version (X.0)** — approved and published edition. Increments on each review cycle that results in substantive change.
- **Minor version (X.Y)** — draft iteration within a cycle. Resets to 0 on each new major version.

| Version | Meaning |
|---|---|
| `v1.0` | First published edition |
| `v1.1` | First draft of first review cycle |
| `v1.3` | Third draft of first review cycle |
| `v2.0` | Second published edition (first review cycle completed) |
| `v2.3` | Third draft of second review cycle |

### 3.3 LiquidFiles folder hierarchy

The following structure is created in LiquidFiles at policy initiation via the Shares / Folder API:

```
/policies/
  POL-YYYY-NNN/
    register.json          ← machine-readable policy metadata
    current/               ← live approved version
      POL-YYYY-NNN-vX.0.pdf
      training/
    drafts/                ← work-in-progress (restricted access)
      POL-YYYY-NNN-vX.Y.docx
    archive/               ← superseded major versions
      v1.0/
        POL-YYYY-NNN-v1.0.pdf
    acknowledgements/      ← signed receipts export
      POL-YYYY-NNN-v1.0-acknowledgements.pdf
```

---

## 4. Lifecycle stages

### Stage 1 — Initiation

**Trigger sources:** manual creation by a policy owner, or an automated review-due alert from the scheduler.

**Actions:**
- Assign a new `POL-YYYY-NNN` identifier (or reuse existing for a review cycle)
- Create the LiquidFiles folder hierarchy via the Shares / Folder API
- Create `register.json` with initial metadata
- Notify the assigned policy owner via LiquidFiles Secure Message (authentication required)
- Set register status to `DRAFT`

### Stage 2 — Drafting

The policy owner and nominated contributors draft the policy document. All working documents are stored in `/drafts/`.

**Controls:**
- `/drafts/` has restricted access — only the policy owner and contributors group
- Each saved draft increments the minor version number
- LiquidFiles Secure Message is used for all review comments, with `private: true` so the message body is not transmitted in plain email
- Register status remains `DRAFT`

### Stage 3 — Approval

When the owner declares the draft ready, the system initiates the approval gate.

**Process:**
1. ProofWorks uploads the candidate document to LiquidFiles and sends a Secure Message to each approver
2. Authentication is required — LiquidFiles issues a Temporary User account to any external approvers automatically
3. Message access permission set to "Only this recipient" — link cannot be forwarded
4. LiquidFiles returns a read receipt and download receipt per approver, timestamped and tied to authenticated identity — **this is the non-repudiation record**
5. Approver replies via the Secure Message thread to approve or return with feedback
6. If any approver returns the document → status reverts to `DRAFT`, owner notified
7. When all required approvers approve → version promoted to next major (e.g. `v1.3 → v2.0`), status advances to `PENDING ACCEPTANCE`

### Stage 4 — Distribution and training

Immediately after approval:

- Approved document moved to `/current/`; previous version archived to `/archive/vX.0/`
- Training materials placed in `/current/training/`
- ProofWorks sends a LiquidFiles Secure Message to all required acknowledgement recipients
- Message includes the policy document as a LiquidFiles attachment
- Authentication required; `expires_after` set to 1 download per recipient
- Register status set to `PENDING ACCEPTANCE`

### Stage 5 — Acceptance

Recipients must acknowledge they have read, understood, and accepted the policy.

**Mechanism:**
- Each recipient's authenticated access to the Secure Message is logged by LiquidFiles with timestamp, IP, and email — **primary non-repudiation record**
- A reply link in the message body directs recipients to submit a typed confirmation
- ProofWorks records acceptance date, version, and LiquidFiles message ID per recipient
- Outstanding acceptances trigger automated reminder Secure Messages at configurable intervals (default: 3, 7, 14 days)
- Overdue acceptances trigger escalation to line managers and the policy owner
- When 100% of required recipients have acknowledged → status advances to `ACTIVE`

### Stage 6 — Active

The policy is live. Register status is `ACTIVE`. The register records version, approval date, and next review date.

**During the active period:**
- Changes in referenced legislation may trigger an unscheduled review
- New staff are automatically sent acceptance messages for all `ACTIVE` policies applicable to their role

### Stage 7 — Scheduled review

At the review trigger date:
- ProofWorks sends a review notification Secure Message to the policy owner
- Status set to `UNDER REVIEW`
- Existing approved document copied to `/drafts/` as starting point
- Lifecycle restarts from Stage 2

If no changes are required after review: major version is not incremented, a "reviewed — no change" record is written to the register, and the next review date is extended.

---

## 5. Policy register

### 5.1 Register fields

| Field | Type | Description |
|---|---|---|
| `policy_id` | string | `POL-YYYY-NNN` permanent identifier |
| `title` | string | Full policy title |
| `category` | string | Policy category (HR, IT, Health & Safety, etc.) |
| `owner` | string | Email of responsible owner |
| `current_version` | string | e.g. `v2.0` |
| `status` | enum | `DRAFT` &#124; `UNDER REVIEW` &#124; `PENDING ACCEPTANCE` &#124; `ACTIVE` &#124; `RETIRED` |
| `authorised_date` | date | Date of most recent approval |
| `authorised_by` | string[] | Email list of approvers |
| `review_frequency_months` | integer | Review cycle length in months |
| `next_review_date` | date | Calculated date for next review trigger |
| `applicable_roles` | string[] | Roles required to acknowledge this policy |
| `liquidfiles_folder_id` | string | LiquidFiles share ID for the policy folder |
| `acknowledgement_count` | integer | Count of required recipients who have accepted |
| `acknowledgement_total` | integer | Total recipients required to accept |
| `last_updated` | datetime | ISO 8601 timestamp of last register change |

### 5.2 register.json example

```json
{
  "policy_id": "POL-2025-001",
  "title": "Acceptable Use Policy",
  "category": "IT",
  "owner": "jane.doe@company.com",
  "current_version": "v1.0",
  "status": "ACTIVE",
  "authorised_date": "2025-03-14",
  "authorised_by": ["cto@company.com", "legal@company.com"],
  "review_frequency_months": 12,
  "next_review_date": "2026-03-14",
  "applicable_roles": ["all-staff"],
  "liquidfiles_folder_id": "aBcDeFgHiJkLmN",
  "acknowledgement_count": 47,
  "acknowledgement_total": 47,
  "last_updated": "2025-03-15T09:22:41Z"
}
```

### 5.3 Status state machine

Valid status transitions:

```
DRAFT → UNDER REVIEW              (owner submits for approval)
UNDER REVIEW → DRAFT              (approver returns with feedback)
UNDER REVIEW → PENDING ACCEPTANCE (all approvers approve)
PENDING ACCEPTANCE → ACTIVE       (all required acceptances received)
ACTIVE → UNDER REVIEW             (review date reached or ad-hoc trigger)
ACTIVE → RETIRED                  (policy withdrawn)
```

---

## 6. LiquidFiles API integration

### 6.1 Authentication

A dedicated ProofWorks service account holds a static API key. All API calls:

```http
Authorization: Bearer {api_key}
Accept: application/json
Content-Type: application/json
```

### 6.2 Key API operations

| Operation | Endpoint | When used |
|---|---|---|
| Create folder | `POST /shares/folder` | Policy initiation |
| Upload file | `POST /message/attachments/upload` | Draft save, distribution |
| Send secure message | `POST /message` | All notification events |
| List sent messages | `GET /messages/sent` | Audit and tracking |
| Message read receipt | Webhook / `GET /messages/{id}` | Acceptance confirmation |
| Move file | `POST /shares/folder/move` | Promote draft to current |
| Retrieve API key | `GET /users/{id}/api_key` | Service account setup |

### 6.3 Secure message parameters for non-repudiation

For all approval and acceptance messages:

```json
{
  "message": {
    "recipients": ["recipient@company.com"],
    "subject": "Action required: Policy approval — POL-2025-001",
    "message": "Please review and approve the attached policy.",
    "send_email": true,
    "authorization": 3,
    "private": true,
    "expires_at": "2025-04-14",
    "attachments": ["attachment_id"]
  }
}
```

- `authorization: 3` — require recipient authentication before access
- `private: true` — message body not transmitted in plain email; body stays server-side
- `expires_at` — set to the review or acceptance deadline

With authentication required, LiquidFiles records the authenticated identity, timestamp, IP address, and download count per recipient. This log is the evidentiary record.

### 6.4 Receipt collection — polling, with an optional webhook

LiquidFiles v4.3 has no webhooks, so ProofWorks polls `GET /message/{id}/downloads`
for every outstanding acceptance — on the scheduler and on demand
(`POST /api/policies/:id/receipts/poll`). Appliances that do support receipt
callbacks can also POST to:

```
POST https://<your-api-host>/api/webhooks/liquidfiles
```

Either path records the acknowledgement and advances the policy to ACTIVE when
every required recipient has confirmed.

---

## 7. Notification event catalogue

| Event | Recipients | LiquidFiles feature | Non-repudiation |
|---|---|---|---|
| Policy initiated | Owner | Secure Message | No |
| Draft ready for approval | All approvers | Secure Message, auth required, recipient-only | Yes |
| Approver returns draft | Owner | Secure Message reply | Yes |
| Policy approved | Owner, contributors | Secure Message | No |
| Policy published for acceptance | All applicable staff | Secure Message, auth required, 1 download limit | Yes |
| Acceptance reminder | Outstanding recipients | Secure Message | Yes |
| Acceptance overdue escalation | Line managers + owner | Secure Message | No |
| Policy fully accepted (ACTIVE) | Owner | Secure Message | No |
| Review due (30-day notice) | Owner | Secure Message | No |
| Review overdue | Owner + governance lead | Secure Message | No |
| New staff onboarding | New employee | Secure Message, auth required | Yes |

---

## 8. Roles and permissions

| Role | Can draft | Can approve | Receives policy | Admin |
|---|---|---|---|---|
| Policy owner | Yes | No | Yes | No |
| Contributor | Yes | No | Yes | No |
| Approver | No | Yes | Yes | No |
| Staff (required to acknowledge) | No | No | Yes | No |
| ProofWorks administrator | Yes | Yes | Yes | Yes |
| Governance lead | No | No | Yes (all) | Read-only |

---

## 9. Periodic review configuration

Each policy record carries a `review_frequency_months` value. The scheduler runs daily:

| Condition | Action |
|---|---|
| `next_review_date` ≤ today + 30 days | Send 30-day advance notice to owner |
| `next_review_date` ≤ today | Initiate review cycle; set status to `UNDER REVIEW` |
| Status = `UNDER REVIEW` and `review_due` + grace period exceeded | Send overdue escalation to owner + governance lead |

The review grace period defaults to 30 days and is configurable per policy category.

---

## 10. Audit and compliance

Audit evidence available per policy version:

- Authenticated read receipts for each approver (who, when, from where)
- Authenticated read receipts for each accepting staff member
- LiquidFiles message IDs linking every notification to the server log
- Version history with all draft documents retained in `/drafts/` and `/archive/`
- Register changelog showing every status transition with timestamp
- Exported acknowledgement PDF per policy version in `/acknowledgements/`

All LiquidFiles access logs reside on the operator's own infrastructure. Retain logs for the minimum period required by the applicable regulatory framework (commonly 5–7 years).

---

## 11. Implementation notes

- The application wraps the LiquidFiles REST API. A simple database (PostgreSQL or SQLite) holds the master register and acknowledgement records.
- LiquidFiles LDAP/AD integration synchronises staff accounts and group membership, ensuring role-based message targeting is always current.
- SAML2 SSO enables staff to authenticate via their existing identity provider when accessing Secure Messages.
- The `/current/` shared folder can be configured with authenticated read access so staff can retrieve the latest version of any policy on demand.
- PDF renditions of approved policies are generated at publication to ensure immutability of the distributed version.
- If your LiquidFiles appliance supports receipt callbacks, point them at `/api/webhooks/liquidfiles`; polling remains the baseline.

---

*Policy Hub — a howldr ProofWorks module — Specification v1.0*
*© 2025 howldr Services Group, LLC · [howldr.com](https://howldr.com) · hello@howldr.com*
