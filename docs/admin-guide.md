# ProofWorks — Admin & Support Guide

*Setting up the workspace, managing people and governance gates, and resolving the
common support questions.*

This guide is for **admins** (full access) and **governance leads** (read-only
oversight plus audiences). For the day-to-day lifecycle from a user's point of view,
see the **[User Guide](user-guide.md)** — this document assumes that context and
focuses on configuration and support.

---

## 1. Your responsibilities as an admin

Admins are the only people who can:

- **Create policies** and assign their owner, approval route, and executive.
- **Manage people** — invite users and set their roles on the **Staff** page.
- **Change workspace settings** — reminder cadence, the governance gates, audiences.
- **Retire policies** from the active register.

Governance leads have read-only access to settings and the register, manage
distribution audiences, and receive overdue-review escalations, but cannot create
policies, manage users, or edit cadence.

`howldr support` is a cross-tenant support role provisioned by howldr; it is
display-only in the UI and can't be assigned from within your workspace.

---

## 2. Managing people (Staff)

Open **Staff** in the sidebar.

### Inviting someone

1. In **Invite a person**, enter their **email** and choose a **role**.
2. Click **Invite**. ProofWorks creates the account and returns a one-time
   **action link**.
3. **Forward that action link** to the person (or let the email invitation reach
   them). They use it to set up sign-in.

Invite people with the address they'll actually sign in with (their Microsoft or
Google work account).

### Assignable roles

| Role | Grants |
|------|--------|
| **Admin** | Full access — policies, users, settings, retire. |
| **Owner** | Drafts and submits the policies they own; accepts and distributes them. |
| **Approver** | Approves or returns policies assigned to them. |
| **Governance lead** | Read-only oversight, manages audiences, gets overdue escalations. |
| **Acceptor** | A named signer: risk acceptance, executive policy sign-off, access-review attestation. Sees the Risk Register, Access Reviews, and only the policies that name them — no register-wide management, no Evidence Locker or Vendor Assessments. |
| **Staff** | The workforce — sees the **active** policy register (and its published documents) only. No drafts, workflow, receipts, audiences, or governance modules. |
| **Viewer** | Read-only **observer** across the whole workspace, including the audit trail — for auditors, external assessors, or integration accounts (e.g. a SIEM). |

> **Staff vs Viewer**: these are deliberately separate categories. Staff are the
> people policies are distributed *to* — they normally accept via the secure
> message and need no account at all. Never give an employee the Viewer role
> just to let them read policies: Viewer is auditor-grade, tenant-wide read.

> There is no "executive" role. An executive is named **per policy** by email
> (see §4). Anyone who can sign in and whose address matches the policy's executive
> can give that sign-off. If the person holds no other role, give them **Acceptor** —
> that's what it's for. The same applies to risk acceptors and access-review
> reviewers: the assignment is by email; Acceptor is the account role for people
> whose only duty is signing.

### Changing a role or removing someone

Use the role selector next to a person, or remove them. Guardrails protect the
workspace:

- You **can't change your own role** (ask another admin).
- You **can't remove yourself**.
- You **can't demote or remove the last remaining admin** — promote someone else first.

---

## 3. Creating a policy

**Policies → New policy** (admins only). Fields:

- **Title** and **Category** — the category matters: it can trigger the executive
  gate (see §5).
- **Review frequency** — how often the policy comes up for review (default 12 months).
- **Policy owner** — the person who drafts, submits, accepts, and distributes it.
  They must be a user who can sign in; invite them first if needed.
- **Approval route** — who signs off, in what order (see below).
- **Executive approver** *(optional)* — the named executive for the final gate.
  Required at submit time if the category needs an executive.
- **Applies to** — roles/groups used later at distribution.
- **Policy document** *(optional)* — upload the first draft now, or attach it later.

The policy is created as **DRAFT** at **v0.1**.

### Building the approval route

The route is an ordered list of **stages**. Stages run **sequentially** (the next
only opens once the current clears); members **within** a stage are asked in parallel.

For each stage:

- Enter the **members** (comma-separated emails).
- Set the **threshold**: **All must approve**, or a quorum — **Any N of M**, where M
  is the number of members you entered.

Use **Add a stage** for a multi-step route (e.g. *Stage 1: any 1 of the two team
leads → Stage 2: legal + DPO, both required*). A single stage with "All must
approve" is the simplest, most common setup.

You can change the route later via **Edit policy** — but changing approvers while a
policy is under review resets approvals for that version.

---

## 4. The three governance gates

After the approvers, a policy can pass through up to two more gates before it's
distributable. This is how you tune rigour to risk.

```
approvers approve → [OWNER ACCEPTANCE] → [EXEC REVIEW] → PENDING ACCEPTANCE
```

1. **Approval route** — always on; configured per policy (§3).
2. **Owner acceptance** — optional, **workspace-wide toggle** (§5). The owner formally
   accepts the approved version before it advances.
3. **Executive sign-off** — optional, **triggered by category** (§5), with a
   **per-policy** named executive.

Each gate produces its own permanent, version-pinned receipt. A **return** at any
gate sends the policy back to DRAFT with feedback and bumps the version, so the
revised version needs fresh sign-off throughout.

---

## 5. Configuring the gates (Settings)

Open **Settings** (admins can edit; governance leads see read-only).

### Executive sign-off categories

In the **Executive sign-off** card, select the **policy categories** that require an
executive to approve before distribution (e.g. *Security*, *Compliance*). Any
policy in a selected category must have an **Executive approver** assigned or it
can't be submitted.

### Owner acceptance

In the **Owner acceptance** card, toggle whether the **owner must explicitly accept**
the approved version. Off by default (the owner's decision to distribute is the
implicit acceptance); turn it on when you want an explicit, separate acceptance
receipt from the owner on every policy.

### Reminder & review cadence

The **Reminder & review cadence** card controls timing:

- **Acceptance reminders** — days after distribution to re-prompt staff who haven't
  acknowledged (e.g. `3, 7, 14`).
- **Review advance notice** — days before a review is due to warn the owner.
- **Overdue grace period** — days after the due date before escalation.
- **Governance lead email** — who receives overdue-review escalations.

Changes apply to the next cycle, not to policies already mid-review.

### Appearance

The **Appearance** card gives the workspace its own look (admins only — everyone
else sees the current choice read-only):

- **Workspace logo** — upload your organisation's mark (PNG, JPEG, WebP, or SVG,
  under 64KB). It replaces the howldr mark in the app header, next to your
  workspace name, with a discrete **"ProofWorks · by howldr"** byline — everyone
  who signs in sees at a glance that this is *your* workspace.
- **Theme** — a curated set applied across the app for everyone. Like an Office
  theme, each preset is an **accent colour, matching surface tints, and a font**
  (howldr Gold · Geist is the default; Slate · IBM Plex Sans, Forest · Source
  Sans 3, Ocean · Nunito Sans, Burgundy · Libre Franklin). The change applies
  immediately, no reload needed.
- **Generated theme** — after a logo upload, ProofWorks reads the logo's dominant
  colour and offers a **Custom** theme built from it, so the whole app can carry
  your brand colour in one click.

Themes are **presets or a single generated accent, not free-form styling** — every
option is a colour set designed to work in both light and dark mode, so a workspace
can look like its own without anyone maintaining custom CSS.

### Distribution audiences

Audiences are reusable recipient groups so owners distribute to a named group
instead of pasting emails. Governance leads can manage these too, since they run
distributions. Create and edit them in Settings; owners then pick them as chips on
the **Distribute** action. An audience is built from three parts:

- **Roles** — tick roles (Staff, Approver, Owner, …) and everyone in the staff
  directory holding one of them is included **at send time**. Membership follows
  the directory automatically — no list to maintain. Note this covers people with
  app accounts; recipients without accounts go under Recipients.
- **Recipients** — explicit emails, one per line, with an optional escalation
  manager after a comma.
- **Exclude** — addresses removed from this audience's roles and recipients at
  send time (e.g. someone on long-term leave). Exclusions apply to the audience
  only — an address pasted directly on the Distribute action is always sent.

The acknowledgement records still snapshot exactly who the audience contained at
the moment of sending, so role membership changing later never muddies the
evidence trail.

---

## 6. The evidence model (for audits)

Everything in ProofWorks is designed to be provable after the fact:

- **Every decision is a receipt.** Approver approvals, owner acceptance, executive
  sign-off, and staff acknowledgements are all stored **append-only** — never
  overwritten.
- **Pinned to a version.** Each receipt records the exact policy version it was made
  against, so a later revision never retroactively "counts" an old approval.
- **Pinned to the document.** Where the file is available, receipts also capture a
  checksum of the exact bytes, so a receipt proves *which document* was approved or
  downloaded — not just a version label.
- **Two tiers of staff receipt.** A recipient's authenticated **download** is their
  acknowledgement; the **"I have read and accept"** click is an explicit attestation
  on top of it.
- **Full changelog.** Each policy's changelog is the immutable event history — status
  changes, version bumps, who acted, and when.

For an audit, the register, per-policy changelog, and the Approvers/
Acknowledgements panels together show the complete chain of custody.

**The audit pack spans the whole suite.** Exporting an audit pack produces a single
zip covering not just policies and their receipts but — where those modules are
enabled — the Evidence Locker, the Risk Register (risks, assessments, and
acceptances), Access Reviews (reviews, line decisions, and attestations), Vendor
Assessments (the vendor register, assessment rounds, and approve/decline receipts),
Obligations (the full register with coverage state — what each obligation is,
where it comes from, and what answers it), and the append-only event ledger. Held evidence files are re-hashed at
export and the ledger's hash chain is **verified at export time**, with the result
recorded in the pack's manifest. One download is the auditor's complete deliverable.

---

## 7. Modules in your workspace

ProofWorks is a suite. A small **core** is always on and is not a module: the
evidence spine (the append-only, version- and hash-pinned receipts), tenancy, sign-in,
**Staff**, and **Settings**. Everything else is an **optional module**:

| Module | What it governs |
|--------|------------------|
| **Policy Hub** | The policy lifecycle (this guide's §1–§6). Always included. |
| **Obligations** | What the organisation must honour and why — laws, contract clauses, insurance conditions, standards — linked to the policies, risks, and evidence that answer them. |
| **Evidence Locker** | The register of proof behind your controls. |
| **Risk Register** | Risks, 5×5 assessments, and formal residual-risk acceptance. |
| **Access Reviews** | Periodic attestations that access is still appropriate. |
| **Vendor Assessments** | Third parties assessed as risks; approved or declined on the record, with tier-escalated sign-off. |

**How entitlement works.** Modules are enabled **per workspace**. A module that isn't
enabled is hidden from the sidebar *and* refused by the API — there is no half-on
state. Turning a module on or off is an operator action, not a self-serve toggle in
Settings:

- **howldr-hosted:** howldr enables modules as part of your service — contact howldr
  to change them.
- **Self-hosted:** whoever runs the deployment enables them with
  `scripts/set-entitlements.js` (see the comment at the top of that script).

If a module is switched off, its data stays — nothing is ever deleted.

**Who can do what** (the write model is consistent across the Governance modules):

- **Obligations** — admins and governance leads manage all obligations; an **owner**
  manages the ones they own. There is no signing ceremony — the receipts live in the
  linked objects; the register's own verbs are **review** (the source was re-checked,
  recorded in the reviewer's name) and **retire/reactivate**, never delete.
- **Evidence Locker** — admins and governance leads manage all items; an **owner**
  manages the items they own; viewers and approvers have read access. Items are
  **retired**, never deleted.
- **Risk Register** — same write model for creating and assessing risks. **Acceptance**
  of a residual risk is made by a **named acceptor** (who may hold any role, like a
  policy's executive). Risks are **closed and reopened**, never deleted.
- **Access Reviews** — the named **reviewer** works through the access lines and
  attests; **admins and governance leads** can reopen a completed review, and the
  reopen is itself recorded.
- **Vendor Assessments** — same write model for registering and assessing vendors.
  The approve/decline **decision** is made by a **named approver** (falls back to the
  relationship owner) — except for **high** and **critical** tier vendors, where only
  an admin or governance lead can decide (the tier escalation gate). Vendors are
  **offboarded and reactivated**, never deleted.

Because every module writes to the same evidence spine, cross-module activity shows up
together on the **Dashboard** and in the **audit pack** (§6).

---

## 8. Integrations

The **Settings → Integrations** panel shows connection status (no secrets):

- **Secure file delivery (LiquidFiles)** — stores policy documents and delivers
  authenticated secure messages. Recipient downloads are polled to record
  acknowledgements (the appliance has no webhooks), so a stored document is required
  before distribution.
- **Invites** — the identity provider used to create and invite users.
- **App** — the public app host used in links inside messages.

---

## 9. Troubleshooting & common support questions

**"An owner can't submit a policy."**
Check two things: the policy has **at least one approver**, and — if its category
requires an executive — an **executive is assigned**. Fix via **Edit policy**.

**"A policy is stuck at EXEC REVIEW / OWNER ACCEPTANCE."**
Only the **named executive** can act at EXEC REVIEW; only the **owner** can act at
OWNER ACCEPTANCE (admins can act on either). Confirm the right person is assigned and
can sign in with the matching email. If the wrong executive was assigned, an admin
can edit the policy — but note the policy must move forward or be returned to change
course.

**"Sign-off requests / notifications didn't arrive."**
Lifecycle actions **never** fail because of a messaging problem — the status still
changes, and the failure is surfaced in the response and logs. Re-check the
recipient's address, then have the owner re-trigger the relevant step or contact the
recipient directly. Confirm the secure-file integration shows **Connected** in
Settings.

**"A new policy shows storage as pending."**
The document store was unreachable when the policy was created. It self-heals: the
next document upload recreates the storage folders. If uploads keep failing, check
the secure-file integration status.

**"Staff acknowledgements aren't showing up."**
Acknowledgements are recorded from recipients' authenticated downloads, which are
polled periodically rather than pushed. Allow time after a download, or use the
policy's receipt-refresh action. Confirm the policy was actually distributed
(status **ACTIVE** / **PENDING ACCEPTANCE**) and the recipient opened the secure
message.

**"A review is overdue."**
Owners get advance notice before the due date and a grace period after; overdue
policies escalate to the governance lead. Tune these in the cadence settings. An
owner can also reopen an active policy anytime with **Trigger review cycle**.

**"Someone left the organisation."**
Reassign any policies they own or approve (via **Edit policy**) before removing
them, then remove them on the **Staff** page. Remember you can't remove the last
admin.

**"A module (Obligations / Evidence Locker / Risk Register / Access Reviews) isn't in the sidebar."**
The sidebar only shows modules **enabled** for your workspace, and the API refuses
modules that aren't enabled regardless of the UI. If a module you expect is missing,
it hasn't been enabled yet — ask howldr (hosted) or whoever runs your deployment
(self-hosted) to enable it (see §7). After it's
enabled you may need to reload the page for the sidebar to pick it up.

**"Can I delete a policy or an approval?"**
No — the evidence trail is append-only by design. Policies are **retired** (removed
from the active register but preserved), and decisions are never erased. This is what
makes the audit trail trustworthy.

---

## 10. Where things live

- **User-facing walkthrough:** [User Guide](user-guide.md) — including the Governance
  modules in its [Beyond policies](user-guide.md#8-beyond-policies--evidence-risk-and-access) section
- **Roles & permissions:** §2 above and the User Guide's role table
- **Gate configuration:** §4–§5 above
- **Modules:** §7 above
- **Audit/evidence questions:** §6 above
