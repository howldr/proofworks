# Policy Lifecycle — Workflow Stages

**Policy Hub — a howldr ProofWorks module**

---

## State machine

```
                    ┌─────────────┐
         initiate   │             │
        ──────────► │    DRAFT    │ ◄──────────────────────────┐
                    │             │                             │
                    └──────┬──────┘                             │
                           │ submit for approval           │ approver
                           ▼                                    │ returns
                    ┌─────────────┐                             │
                    │   UNDER     │ ────────────────────────────┘
                    │   REVIEW    │
                    └──────┬──────┘
                           │ all approvers approve
                           ▼
                    ┌──────────────────┐
                    │    PENDING       │
                    │   ACCEPTANCE     │
                    └──────┬───────────┘
                           │ all acceptances received
                           ▼
                    ┌─────────────┐
          ┌──────── │   ACTIVE    │ ────────┐
          │         └─────────────┘         │
          │ review                          │ withdraw
          │ triggered                       ▼
          │                         ┌─────────────┐
          └────────────────────────►│   RETIRED   │
                                    └─────────────┘
```

---

## Stage 1 — Initiation

**Entry condition:** Manual trigger by policy owner, or automated alert from scheduler (review due).

**System actions:**
1. Allocate next `POL-YYYY-NNN` identifier from the register sequence
2. `POST /shares/folder` — create LiquidFiles folder hierarchy:
   - `/policies/POL-YYYY-NNN/`
   - `/policies/POL-YYYY-NNN/current/`
   - `/policies/POL-YYYY-NNN/current/training/`
   - `/policies/POL-YYYY-NNN/drafts/`
   - `/policies/POL-YYYY-NNN/archive/`
   - `/policies/POL-YYYY-NNN/acknowledgements/`
3. Write `register.json` with `status: DRAFT`, `current_version: v0.1`
4. Send Secure Message to owner (notification only; `authorization: 0`)

**Exit condition:** Owner begins drafting.

---

## Stage 2 — Drafting

**Entry condition:** Status is `DRAFT`.

**Access control:**
- `/drafts/` folder — policy owner and contributors only
- `/current/` folder — read access for all authenticated staff

**System actions on each draft save:**
1. Upload `.docx` to `/drafts/` with filename `POL-YYYY-NNN-vX.Y.docx`
2. Increment minor version in register (`v0.1 → v0.2`, etc.)
3. Update `last_updated` in `register.json`

**Collaboration:**
- Review comments exchanged via LiquidFiles Secure Message with `private: true`
- Contributors reply within the message thread; replies logged on LiquidFiles server

**Exit condition:** Owner declares draft ready and submits for approval → status transitions to `UNDER REVIEW`.

---

## Stage 3 — Approval

**Entry condition:** Owner submits draft; status transitions `DRAFT → UNDER REVIEW`.

**System actions:**
1. Generate PDF rendition of the candidate draft
2. Upload PDF to LiquidFiles via `POST /message/attachments/upload`
3. For each required approver, send Secure Message:
   - `authorization: 3` (authentication required)
   - `private: true`
   - Access permission: "Only this recipient"
   - `expires_at`: set to approval deadline
4. Record LiquidFiles message ID per approver in the register
5. Update register status to `UNDER REVIEW`

**Approver actions:**
- Accesses message via authenticated link
- LiquidFiles logs: authenticated identity, timestamp, IP, download count
- Replies to approve **or** return with feedback

**On rejection (any approver returns):**
1. Status transitions `UNDER REVIEW → DRAFT`
2. Owner notified via Secure Message with approver's feedback attached
3. Minor version incremented

**On full approval (all approvers approve):**
1. Version promoted to next major (`v1.3 → v2.0`)
2. Status transitions `UNDER REVIEW → PENDING ACCEPTANCE`
3. Proceed to Stage 4

---

## Stage 4 — Distribution and training

**Entry condition:** All approvers have approved; status is `PENDING ACCEPTANCE`.

**System actions:**
1. Move approved PDF to `/current/` via `POST /shares/folder/move`
2. Move previous version to `/archive/vX.0/`
3. Place training materials in `/current/training/`
4. For each required recipient (by applicable role), send Secure Message:
   - `authorization: 3`
   - `private: true`
   - `expires_after: 1` (one download per authenticated recipient)
   - Attach policy PDF and link to training materials
5. Record LiquidFiles message ID per recipient in acknowledgements store
6. Update register: `status: PENDING_ACCEPTANCE`, `acknowledgement_total: N`

---

## Stage 5 — Acceptance

**Entry condition:** Distribution messages sent; status is `PENDING ACCEPTANCE`.

**Recipient actions:**
- Receives email notification from LiquidFiles
- Authenticates to access Secure Message (Temporary User account if external)
- Downloads and reads policy document
- Replies to message thread with typed confirmation

**System actions on receipt confirmation:**
1. ProofWorks records: `recipient_email`, `accepted_at`, `version`, `liquidfiles_message_id`
2. Increments `acknowledgement_count` in register
3. When `acknowledgement_count == acknowledgement_total`: status transitions to `ACTIVE`

**Automated reminders:**
- At day 3, 7, and 14 past distribution: send reminder Secure Message to outstanding recipients
- If all reminders exhausted: escalation Secure Message to line managers and policy owner

---

## Stage 6 — Active

**Entry condition:** All required acceptances received; status transitions to `ACTIVE`.

**System actions:**
1. Update register: `status: ACTIVE`, `authorised_date`, `next_review_date`
2. Send "policy now active" notification to owner (informational)

**Ongoing:**
- New staff automatically receive acceptance messages for all `ACTIVE` policies applicable to their role (triggered by LDAP/AD sync detecting new accounts)
- Ad-hoc review can be triggered at any time by a ProofWorks administrator

---

## Stage 7 — Scheduled review

**Scheduler logic (runs daily):**

| Condition | Action |
|---|---|
| `next_review_date` ≤ today + 30 days | Send 30-day advance notice to owner |
| `next_review_date` ≤ today | Trigger review cycle |
| Status `UNDER REVIEW` + `review_due` + grace period exceeded | Send overdue escalation |

**On review trigger:**
1. Status transitions `ACTIVE → UNDER REVIEW`
2. Copy current approved PDF to `/drafts/` as starting point
3. Notify owner via Secure Message
4. Lifecycle restarts from Stage 2

**No-change review:**
If the owner determines no changes are required:
1. Write "reviewed — no change" record to register with timestamp
2. Do **not** increment major version
3. Recalculate and update `next_review_date`
4. Status returns to `ACTIVE`

---

*Policy Hub — a howldr ProofWorks module · [howldr.com](https://howldr.com)*
