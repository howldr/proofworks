# ProofWorks — User Guide

*How to manage a policy from first draft to active, and how staff acknowledge it.*

howldr ProofWorks is where your organisation drafts, approves, distributes,
and reviews its policies. Its job is not just to store documents — it is to build
an **evidence trail**: every decision (who approved, which version, when, against
which exact file) is recorded as a permanent, tamper-evident receipt you can later
prove to an auditor.

This guide is for people who use ProofWorks day to day — **owners, approvers,
executives, and read-only viewers**. Staff who only need to acknowledge a policy
should jump to [For staff recipients](#9-for-staff-recipients); they don't need an
account (and if they're given one with the **Staff** role, they see the active
policy register only).

Administrators should also read the companion **[Admin & Support Guide](admin-guide.md)**.

---

## 1. The big idea in one minute

A policy moves along a fixed path. At each step the right person acts, and their
action is captured as a receipt:

```
DRAFT → UNDER REVIEW → [OWNER ACCEPTANCE] → [EXEC REVIEW] → PENDING ACCEPTANCE → ACTIVE → RETIRED
```

- **DRAFT** — being written; the document lives in the drafts area.
- **UNDER REVIEW** — submitted; approvers are approving it in order.
- **OWNER ACCEPTANCE** *(optional)* — the owner formally accepts the approved version.
- **EXEC REVIEW** *(optional)* — an executive gives final sign-off.
- **PENDING ACCEPTANCE** — approved and ready to distribute to staff.
- **ACTIVE** — distributed and in force; staff are acknowledging it.
- **RETIRED** — withdrawn from the active register.

The two bracketed gates only appear when your workspace turns them on (owner
acceptance) or when the policy's category requires it (executive sign-off). See
the Admin guide to configure them.

**Version numbers tell the story.** A policy starts at `v0.1`. Every time it is
returned for revision the minor number ticks up (`v1.3 → v1.4`). When it is fully
approved it is promoted to the next major version (`v1.3 → v2.0`). Because every
approval is pinned to a version, sending a policy back for changes automatically
clears the old approvals — the new version needs fresh sign-off.

---

## 2. Signing in

Open the ProofWorks web address for your organisation and choose **Sign in with
your work account**:

- **Continue with Microsoft** or **Continue with Google** — use whichever your
  organisation uses.
- Or request an **email sign-in link**.

If someone invited you, use the same email address the invitation was sent to.
After signing in you land on the **Dashboard**.

> Staff who only receive policies to read do **not** sign in — see
> [For staff recipients](#9-for-staff-recipients).

---

## 3. Getting around

The left sidebar traces the **governance–risk–compliance lifecycle** top to
bottom: understand what you must do (Governance), weigh what could go wrong
(Risk), then prove you have it handled (Compliance). Which entries you see
depends on the **modules** enabled for your workspace — an item whose module
is not enabled is hidden. See
[Beyond policies](#8-beyond-policies--evidence-risk-and-access) below.

**Overview**
- **Dashboard** — a cross-module snapshot of everything that needs attention.
- **My tasks** — your personal to-do list; the fastest way to find your work.

**Governance**
- **Obligations** — what you must honour and why: laws, contract clauses, insurance conditions, standards — linked to whatever answers them.
- **Policies** — expands to the policy lifecycle:
  - **Register** — every policy, filterable by title, ID, category, or owner.
  - **Approvals** — policies awaiting sign-off, approved-but-not-distributed, and in drafting.
  - **Acknowledgements** — per-recipient acceptance status once a policy is distributed.
  - **Reviews** — upcoming, in-progress, and overdue policy reviews.

**Risk** *(shown when enabled)*
- **Risk Register** — risks, their assessments, and formal acceptances.
- **Vendor Assessments** — third parties assessed as risks, approved or declined on the record.

**Compliance** *(shown when enabled)*
- **Access Reviews** — periodic attestations that access is still appropriate.
- **Evidence Locker** — the register of proof behind your controls.

**Administration**
- **Staff** — the people in your workspace (admins and governance leads).
- **Settings** — workspace configuration (admins and governance leads).

Your name and sign-out are at the bottom of the sidebar.

---

## 4. What you can do depends on your role

| Role | What it's for |
|------|----------------|
| **Admin** | Full access — create policies, manage people, change settings, retire policies. |
| **Owner** | Drafts, submits, accepts, and distributes the policies they own; triggers reviews. |
| **Approver** | Approves or returns policies they are assigned to. |
| **Executive** | Final sign-off on policies whose category requires it (assigned per policy). |
| **Governance lead** | Read-only oversight, manages distribution audiences, receives overdue escalations. |
| **Acceptor** | A named signer. Accepts risks where they're the acceptor, gives executive sign-off on policies that name them, decides and attests access reviews assigned to them — without any register-wide management access. |
| **Staff** | The workforce — people policies are distributed *to*. They accept via the secure message and don't need an account; if given one, they see the **active** policy register only. |
| **Viewer** | Read-only **observer** across the whole workspace — auditors, external assessors, or integration accounts such as a SIEM. Deliberately a separate category from Staff. |

You can hold different roles on different policies — you might *own* one policy and
be an *approver* on another. ProofWorks only ever shows you the actions you're
allowed to take at that moment.

---

## 5. Reading a policy

Open any policy from the register or your tasks to see its detail page. Key panels:

- **Header** — the policy ID, title, current version, and a coloured **status badge**.
- **Actions** — only the steps *you* can take right now (see the workflows below).
- **Approvers** — the approval route as a set of ordered **stages**, each
  showing who has approved (green), returned (amber), or is still pending, plus a
  per-stage progress line (e.g. *"any 2 of 3 — 1/2"*). If the workspace requires
  it, an **Owner acceptance** row and an **Executive sign-off** row appear here too.
- **Review activity** — comments and questions raised during review, and who has read the draft.
- **Draft document / Document versions** — upload the working file and see every stored version.
- **Changelog** — the full, immutable audit trail of every lifecycle event.

---

## 6. Workflows

### If you're an owner

**a) Add the draft document.** On the policy detail page, use **Draft document →
choose a Word or PDF file → upload**. It is stored as a versioned file and logged.
You can re-upload a newer draft at any time while in DRAFT.

**b) Submit for approval.** When the draft is ready, in **Actions** set an
**Approval deadline** and click **Submit for approval**. ProofWorks sends
approval requests to the first stage of approvers with the draft attached.

> You can't submit until the policy has at least one approver, and — if its
> category requires an executive — an executive is assigned. An admin sets these up
> when the policy is created or via **Edit**.

**c) Accept the approved version** *(only if your workspace uses the owner gate)*.
Once all approvers approve, the policy waits at **OWNER ACCEPTANCE**. In
**Actions**, review it and click **Accept approved version** to advance it, or
**Return for revision** with a note to send it back to draft.

**d) Distribute.** When the policy reaches **PENDING ACCEPTANCE**, the **Distribute**
action appears. Pick one or more **audiences** (saved recipient groups) and/or paste
staff emails, set an **Acknowledgement deadline**, and click **Distribute**. Each
recipient gets a secure message with the document attached.

**e) Keep it current.** An **ACTIVE** policy can be sent around again with **Trigger
review cycle**, which reopens it for revision and copies the current document into
drafts to start from.

### If you're an approver

When a policy is submitted you'll get a secure message and it appears in **My tasks**
and **Approvals**. Open it and, in **Actions**:

- **Approve** — records your sign-off, pinned to the exact version and document you saw.
- **Return for revision** — reveals a feedback box; **Return with feedback** sends the
  policy back to the owner as a new draft version.

**Stages run in order.** If you're in a later stage, you'll see the earlier stage is
still open and it isn't your turn yet. Within a stage, approvals happen in parallel,
and a stage clears when it meets its threshold (everyone, or a quorum like "any 2 of
3"). When the final stage clears, the policy advances automatically.

### If you're an executive

For policies whose category requires executive sign-off, once the approvers (and
the owner, if that gate is on) are done, the policy waits at **EXEC REVIEW** and you
receive a request. Open it and in **Actions**:

- **Approve for distribution** — records your sign-off and releases the policy to distribution.
- **Return for revision** — sends it back to draft with your feedback.

### If you're an acceptor

You're a named signer. **My tasks** shows exactly what waits on you: risks whose
latest assessment round needs your acceptance, and policies at **EXEC REVIEW**
that name you as the executive. You see the Risk Register, Access Reviews, and
only the policies assigned to you — accepting, signing off, or attesting records
a permanent receipt in your name, and that's the whole job. (Executives and risk
acceptors who already hold another role don't need this one — the assignment is
by email, whatever the role.)

### If you're a viewer or governance lead

You have read access to the register, policy detail, receipts, and the changelog —
useful for oversight and audits. Governance leads also manage distribution audiences
in **Settings** and receive overdue-review escalations.

### If you're staff with an account

Most staff never sign in — acceptance happens through the secure message (see
[For staff recipients](#9-for-staff-recipients)). If you have been given an
account, you see the **active policy register only**: the current, published
version of each policy and its document. Drafts, approval workflow, receipts,
and the governance modules are not part of your view.

---

## 7. Finding your work

- **My tasks** is your queue: policies awaiting your approval, drafts you own to
  submit or revise, and approved policies waiting for you to distribute — ordered
  by urgency.
- **Dashboard** opens with **your evidence spine** — Understanding → Method →
  Proof, drawn as a flow: the obligations you carry, the controls that answer
  them, and the proof behind them, each with a live count. Amber marks where the
  chain breaks: obligations with no method (*unanswered*), methods with nothing
  proving them (*unproven*), or a stage's own trouble (policies pending
  acceptance, evidence expired). Click any stage to open that register. Below it
  sit register totals and a **Needs attention** list.
- **Approvals**, **Reviews**, and **Acknowledgements** are focused views of each
  stage of the lifecycle.

---

## 8. Beyond policies — evidence, risk, and access

Policy Hub proves your *policies* are approved and acknowledged. The other
modules extend the same idea — permanent, version-pinned receipts — to the things
an auditor asks about next: the **obligations** you carry and why, the **evidence**
behind your controls, the **risks** you have accepted, the **access reviews** you
have completed, and the **vendors** you have vetted (or walked away from). They share the sidebar, the dashboard, and the
audit pack, so everything reads as one evidence trail.

You'll only see a module if it's enabled for your workspace (an admin can confirm
in Settings). Each module is independent — having one does not require another.

### Obligations

The Obligations register answers the question every other module leaves open:
**why does any of this exist?** An obligation is a commitment your organisation
must honour, named by its **source**:

- **Law / Regulation** — e.g. *"Notify the ICO of a personal data breach within
  72 hours" (UK GDPR, Art. 33)*.
- **Contract** — a clause a client holds you to, e.g. *"Retain engagement records
  for 7 years" (MSA §12.3)*.
- **Insurance** — a condition of cover, e.g. *"MFA on all administrator accounts"
  (cyber policy, condition 4b)*.
- **Standard** — a framework requirement (ISO 27001, Cyber Essentials).
- **Internal** — a commitment the organisation made to itself.

Each obligation **links to what answers it**: the policies (the method), the risks
(what threatens it), and the evidence (the proof). The links show on both sides —
a policy's page lists the obligations it answers; a risk's page lists the
obligations it threatens. An obligation nothing links to is flagged
**unanswered** — the register's loudest signal, and the first thing the dashboard
raises. An obligation that *has* a method but no evidence behind it is
**unproven**: you can say what you do about it, but not show it. The dashboard's
evidence spine calls out both, on the hop where the chain breaks.

Sources renew: contracts get re-signed, insurance policies roll over, laws get
amended. **Record a review** to note, in your name, that the obligation is still
current, and set the next review date. Obligations are **retired**, never deleted.

When an auditor or insurer asks *"show me you meet clause X"*, the obligation's
page — its source, its links, and its history — is the answer, and the audit pack
carries the whole register.

### Evidence Locker

The Evidence Locker is a register of the proof that stands behind your controls —
a completed access review, a penetration-test report, a signed DPA, a screenshot of
a configured setting. Its guiding rule is **proof, not payload**: it can hold the
proof *about* a file without you having to hand the sensitive file itself to howldr.

Every item carries a **proof strength** badge, derived automatically so it can never
drift out of date:

- **Held** — the file lives on your secure share and its checksum is recorded.
- **Fingerprinted** — you uploaded a file only so its checksum could be taken; the
  bytes were **hashed and discarded**, never stored. You keep the original.
- **Declared** — a pointer and an attestation only (e.g. "held in system X"), no file.

What you can do:

- **Add an item** — give it a title, category, tags, and a plain-text control label
  ("declare, don't compute" — you name the control, the system doesn't infer it).
- **Attach or fingerprint a file** to move it from *declared* up to *held* or
  *fingerprinted*.
- **Verify** an item on demand — a held file is re-hashed, or you paste a digest to
  check. The result (match or **mismatch**) is written as a receipt either way. A
  mismatch usually just means there's a newer artifact — register that as a new item.
- **Retire** an item (optionally noting what supersedes it). Nothing is ever deleted.

A hash is a **point-in-time seal, not a live monitor** — items are re-checked at the
moments that matter (on review and whenever you export an audit pack), not by noisy
background scanning.

### Risk Register

The Risk Register records the risks you're carrying and — the part auditors care
about — **who formally accepted the residual risk, and against which assessment.**

Each risk is scored on a fixed **5×5 likelihood × impact** grid, **twice per round**:

- **Inherent** — before any treatment.
- **Residual** — after your chosen treatment (**accept**, **mitigate**, **transfer**,
  or **avoid**).

Scores roll up to a colour band, derived (never hand-set): **Low / Medium / High /
Critical**. Assessments are **append-only rounds** — re-assessing a risk adds a new
round rather than overwriting the last one.

**Acceptance is the receipt.** A named acceptor formally accepts the *residual* risk,
and that acceptance is pinned to the exact assessment round. Re-assess a risk and it
returns to **awaiting acceptance**, because the earlier receipt doesn't cover the new
numbers. Risks are **closed and reopened**, never deleted, and the acceptance state
(*not assessed → awaiting acceptance → accepted*) is always visible on the list.

You can soft-link a risk to related policies and evidence items; the link shows on
both sides.

### Access Reviews

An Access Review is a periodic attestation that the people with access to a system
still *should* have it — the recurring "who can get into what, and is that still
right?" check.

The flow is deliberately CSV-first, so it works with an export from any system:

1. **Create a review** — name the system and the **reviewer** responsible.
2. **Add the lines** — paste the access list (typically a CSV export: user, role,
   last-seen, etc.).
3. **Decide each line** — mark it **keep**, **flag**, or **remove**.
4. **Attest** — the reviewer signs off. The attestation is an **append-only receipt**
   with the keep/flag/remove **counts pinned** to that moment.

An admin or governance lead can **reopen** a completed review if something needs to
change; doing so is itself recorded. The flagged and removed lines become the
evidence that the review actually happened and had teeth.

### Vendor Assessments

**A vendor is a risk until understood.** Vendor Assessments runs every third party
you rely on through the same cycle as the Risk Register — and then keeps a receipt
for the decision, whichever way it went.

1. **Register the vendor** — name, what they provide, a **criticality tier**
   (low / medium / high / critical), and a plain-English **data scope** describing
   what data of yours they touch. Link the governing policies, their evidence
   (a SOC 2 fingerprint, a signed DPA), and any risks they're a source of.
2. **Assess it** — the same 5×5 inherent → residual scoring, in **append-only
   rounds**. The safeguards you record (DPA, SSO, access reviews) are what turn
   inherent into residual.
3. **Decide** — the named approver **approves** (engage, formally accepting the
   residual risk) or **declines** (walk away). Both are permanent receipts pinned
   to the round they judged. **A decline is evidence too** — it proves you did due
   diligence and chose not to proceed.
4. **Keep it current** — re-assessing opens a new round and visibly reopens the
   decision, exactly like risk acceptance. Vendors are **offboarded**, never
   deleted.

**The tier gate.** For **high** and **critical** tier vendors, only an admin or
governance lead can make the decision — the named approver alone isn't enough.
This is the executive-gate idea from Policy Hub, tuned to vendor criticality: the
more your business or data depends on them, the more senior the sign-off.

Because a vendor's evidence is usually *their* confidential material, vendor-linked
evidence items typically use the **fingerprinted** or **declared** tiers — you prove
you reviewed their SOC 2 on a given date without holding their report.

---

## 9. For staff recipients

If you've been sent a policy to acknowledge, **you don't need a ProofWorks account.**

1. You'll receive a **secure message** with the policy document.
2. **Open and download the document.** Your authenticated download is automatically
   recorded as your acknowledgement — proof that you received exactly that file.
3. The message also links to a short page that shows the policy title and version
   with a single button: **I have read and accept.** Clicking it records your
   explicit attestation on top of the download receipt.
4. You'll see a confirmation once it's done. That's it.

If you miss the deadline you may get reminder messages, and your manager may be
notified. If you can't open the document, reply to the sender or contact your
policy administrator.

---

## 10. Tips & FAQ

- **"Why can't I see any buttons?"** ProofWorks only shows actions for your role at
  the current status. If it's not your turn, there's nothing to do yet.
- **"I approved but nothing happened."** Your approval is recorded — the policy only
  advances when the whole stage (or the whole route) is satisfied. Check the
  Approvers panel for who's still pending.
- **"It went back to draft after a return."** That's expected. A return bumps the
  version and clears prior approvals so the revised version gets fresh sign-off.
- **"A notification didn't send."** Lifecycle actions never fail because of a
  notification problem — the action still completes, and the failure is reported so
  the owner can follow up manually.
- **"The version jumped from v1.3 to v2.0."** That's the promotion to a major version
  when a policy is fully approved.

For configuration, user management, and troubleshooting, see the
**[Admin & Support Guide](admin-guide.md)**.
