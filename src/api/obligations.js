/**
 * howldr ProofWorks
 * Obligations Register (module: obligations)
 *
 * The UNDERSTANDING layer of the spine (Understanding → Method → Proof).
 * An OBLIGATION is a commitment the organisation must honour, named by its
 * SOURCE: a law, regulation, contract, insurance policy, standard, or an
 * internal commitment. It links to the policies (method), risks (threat),
 * and evidence (proof) that answer it — so every receipt in the audit pack
 * traces back to a reason, and an obligation nothing answers is visibly
 * UNANSWERED.
 *
 * There is no signing ceremony here: the receipts live in the linked
 * objects. The one lifecycle verb beyond editing is REVIEW — sources renew
 * (contracts, insurance policies) — which records an attributed event and
 * moves the next review date. Obligations are RETIRED, never deleted.
 *
 * Routes (mounted behind requireTenant + requireUser + requireSameTenant +
 * requireRole(governance roles) + requireModule('obligations')):
 *   GET    /api/obligations              governance roles
 *   POST   /api/obligations              admin / governance_lead / owner
 *   GET    /api/obligations/:id          governance roles
 *   PUT    /api/obligations/:id          writers (owner-role: own obligations only)
 *   POST   /api/obligations/:id/review          "        "
 *   POST   /api/obligations/:id/retire          "        "
 *   POST   /api/obligations/:id/reactivate      "        "
 *
 * Write model matches the Risk Register: admin / howldr_support /
 * governance_lead manage everything; users with the 'owner' role manage the
 * obligations they own.
 */

const express = require('express');
const router  = express.Router();

const db = require('../db/db');
const { requireRole } = require('../middleware/auth');

const EMAIL   = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const WRITE_ROLES  = new Set(['admin', 'howldr_support', 'governance_lead', 'owner']);
const MANAGE_ROLES = new Set(['admin', 'howldr_support', 'governance_lead']);

const SOURCE_TYPES = ['law', 'regulation', 'contract', 'insurance', 'standard', 'internal'];

/** Derive the coverage state — an ACTIVE obligation nothing links to is the
 *  register's loudest signal. Nothing here is stored. */
function withDerived(row) {
  const answered =
    (row.policy_ids?.length ?? 0) > 0 ||
    (row.risk_ids?.length ?? 0) > 0 ||
    (row.evidence_ids?.length ?? 0) > 0;
  return {
    ...row,
    coverage_state: row.status !== 'ACTIVE' ? 'retired' : answered ? 'answered' : 'unanswered',
  };
}

function canMutate(user, obligation) {
  if (MANAGE_ROLES.has(user.role)) return true;
  return user.role === 'owner' && obligation.owner_email === user.email;
}

async function loadObligation(req, res) {
  const obligation = await db.getObligationById(req.tenant.id, req.params.id);
  if (!obligation) {
    res.status(404).json({ error: 'Obligation not found' });
    return null;
  }
  req.obligation = obligation;
  return obligation;
}

function bad(res, msg) {
  res.status(400).json({ error: msg });
  return null;
}

function cleanIdArray(res, value, where) {
  if (!Array.isArray(value)) return bad(res, `${where} must be an array of ids`);
  return Array.from(new Set(value.map(v => String(v).trim()).filter(Boolean)));
}

/** Validate + normalise editable metadata. Returns db-column updates or null
 *  after writing a 400. */
function parseMetadata(res, body, { partial }) {
  const out = {};
  const has = (k) => body[k] !== undefined;

  if (has('title') || !partial) {
    if (typeof body.title !== 'string' || !body.title.trim()) return bad(res, 'title is required');
    out.title = body.title.trim();
  }
  if (has('description')) out.description = body.description == null ? null : String(body.description);
  if (has('sourceType') || !partial) {
    if (!SOURCE_TYPES.includes(body.sourceType)) {
      return bad(res, `sourceType must be one of: ${SOURCE_TYPES.join(', ')}`);
    }
    out.source_type = body.sourceType;
  }
  if (has('sourceName') || !partial) {
    if (typeof body.sourceName !== 'string' || !body.sourceName.trim()) {
      return bad(res, 'sourceName is required — the law, contract, policy, or standard this comes from');
    }
    out.source_name = body.sourceName.trim();
  }
  if (has('sourceRef')) out.source_ref = body.sourceRef == null ? null : String(body.sourceRef).trim() || null;
  if (has('owner')) {
    if (typeof body.owner !== 'string' || !EMAIL.test(body.owner.trim())) {
      return bad(res, 'owner must be a valid email');
    }
    out.owner_email = body.owner.trim().toLowerCase();
  }
  if (has('nextReviewDate')) {
    if (body.nextReviewDate !== null && body.nextReviewDate !== '' && !ISO_DAY.test(String(body.nextReviewDate))) {
      return bad(res, 'nextReviewDate must be a YYYY-MM-DD date');
    }
    out.next_review_date = body.nextReviewDate ? String(body.nextReviewDate) : null;
  }
  for (const [key, col] of [
    ['policyIds', 'policy_ids'], ['riskIds', 'risk_ids'], ['evidenceIds', 'evidence_ids'],
  ]) {
    if (has(key)) {
      const ids = cleanIdArray(res, body[key], key);
      if (!ids) return null;
      out[col] = ids;
    }
  }
  return out;
}

/** Links are references, not free text: any provided id must exist in this
 *  tenant. Sends the 400 and returns false when validation fails. */
async function validateLinks(res, tenantId, meta) {
  for (const [col, filter, label] of [
    ['policy_ids',   db.filterExistingPolicyIds,   'policy'],
    ['risk_ids',     db.filterExistingRiskIds,     'risk'],
    ['evidence_ids', db.filterExistingEvidenceIds, 'evidence'],
  ]) {
    const ids = meta[col];
    if (!ids?.length) continue;
    const existing = new Set(await filter(tenantId, ids));
    const unknown  = ids.filter(id => !existing.has(id));
    if (unknown.length) {
      bad(res, `Unknown ${label} id(s): ${unknown.join(', ')}`);
      return false;
    }
  }
  return true;
}

// ─── GET /api/obligations — list with derived coverage ────────────────────────

router.get('/', async (req, res) => {
  try {
    const { status, sourceType } = req.query;
    const rows = await db.listObligations({ tenantId: req.tenant.id, status, sourceType });
    res.json(rows.map(withDerived));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── POST /api/obligations — record an obligation ─────────────────────────────

router.post('/', requireRole([...WRITE_ROLES]), async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const meta = parseMetadata(res, req.body || {}, { partial: false });
    if (!meta) return;
    if (!await validateLinks(res, tenantId, meta)) return;

    const obligationId = await db.allocateObligationId(tenantId);
    const obligation = await db.createObligation({
      tenant_id:     tenantId,
      obligation_id: obligationId,
      ...meta,
      owner_email: meta.owner_email || req.user.email,
      created_by:  req.user.email,
    });
    await db.logObligationEvent({
      tenantId, obligationId,
      event:      `Obligation recorded (${obligation.source_type}: ${obligation.source_name})`,
      actorEmail: req.user.email,
      metadata:   { source_type: obligation.source_type, source_name: obligation.source_name },
    });
    res.status(201).json(withDerived(obligation));
  } catch (err) {
    console.error('POST /obligations failed:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── GET /api/obligations/:id — detail + events ───────────────────────────────

router.get('/:id', async (req, res) => {
  try {
    const obligation = await loadObligation(req, res);
    if (!obligation) return;
    const events = await db.getObligationEvents(req.tenant.id, obligation.obligation_id);
    res.json({ ...withDerived(obligation), events });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── PUT /api/obligations/:id — edit metadata ─────────────────────────────────

router.put('/:id', requireRole([...WRITE_ROLES]), async (req, res) => {
  try {
    const obligation = await loadObligation(req, res);
    if (!obligation) return;
    if (!canMutate(req.user, obligation)) {
      return res.status(403).json({ error: 'You can only edit obligations you own' });
    }
    const meta = parseMetadata(res, req.body || {}, { partial: true });
    if (!meta) return;
    if (!Object.keys(meta).length) return bad(res, 'No editable fields provided');
    if (!await validateLinks(res, req.tenant.id, meta)) return;

    const updated = await db.updateObligation(req.tenant.id, obligation.obligation_id, meta);
    await db.logObligationEvent({
      tenantId: req.tenant.id, obligationId: obligation.obligation_id,
      event:      `Details updated: ${Object.keys(meta).join(', ')}`,
      actorEmail: req.user.email,
    });
    res.json(withDerived(updated));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── POST /api/obligations/:id/review — the source was re-checked ─────────────
//
// Contracts and insurance policies renew; laws get amended. A review records
// WHO confirmed the obligation is still current (an attributed event on the
// spine) and optionally moves the next review date.

router.post('/:id/review', requireRole([...WRITE_ROLES]), async (req, res) => {
  try {
    const obligation = await loadObligation(req, res);
    if (!obligation) return;
    if (!canMutate(req.user, obligation)) {
      return res.status(403).json({ error: 'You can only review obligations you own' });
    }
    if (obligation.status !== 'ACTIVE') return bad(res, 'Reactivate the obligation before reviewing it');

    const { nextReviewDate, notes } = req.body || {};
    if (nextReviewDate !== undefined && nextReviewDate !== null && nextReviewDate !== '' &&
        !ISO_DAY.test(String(nextReviewDate))) {
      return bad(res, 'nextReviewDate must be a YYYY-MM-DD date');
    }

    let updated = obligation;
    if (nextReviewDate !== undefined) {
      updated = await db.updateObligation(req.tenant.id, obligation.obligation_id, {
        next_review_date: nextReviewDate ? String(nextReviewDate) : null,
      });
    }
    await db.logObligationEvent({
      tenantId: req.tenant.id, obligationId: obligation.obligation_id,
      event:      `Obligation reviewed — still current${nextReviewDate ? `, next review ${nextReviewDate}` : ''}`,
      actorEmail: req.user.email,
      metadata:   {
        ...(notes ? { notes: String(notes) } : {}),
        ...(nextReviewDate ? { next_review_date: String(nextReviewDate) } : {}),
      },
    });
    res.json(withDerived(updated));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── POST /api/obligations/:id/retire · /reactivate ───────────────────────────

router.post('/:id/retire', requireRole([...WRITE_ROLES]), async (req, res) => {
  try {
    const obligation = await loadObligation(req, res);
    if (!obligation) return;
    if (!canMutate(req.user, obligation)) {
      return res.status(403).json({ error: 'You can only retire obligations you own' });
    }
    if (obligation.status === 'RETIRED') return bad(res, 'Obligation is already retired');
    const updated = await db.updateObligation(req.tenant.id, obligation.obligation_id, { status: 'RETIRED' });
    await db.logObligationEvent({
      tenantId: req.tenant.id, obligationId: obligation.obligation_id,
      event: 'Obligation retired', actorEmail: req.user.email,
      metadata: req.body?.reason ? { reason: String(req.body.reason) } : undefined,
    });
    res.json(withDerived(updated));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/:id/reactivate', requireRole([...WRITE_ROLES]), async (req, res) => {
  try {
    const obligation = await loadObligation(req, res);
    if (!obligation) return;
    if (!canMutate(req.user, obligation)) {
      return res.status(403).json({ error: 'You can only reactivate obligations you own' });
    }
    if (obligation.status === 'ACTIVE') return bad(res, 'Obligation is already active');
    const updated = await db.updateObligation(req.tenant.id, obligation.obligation_id, { status: 'ACTIVE' });
    await db.logObligationEvent({
      tenantId: req.tenant.id, obligationId: obligation.obligation_id,
      event: 'Obligation reactivated', actorEmail: req.user.email,
    });
    res.json(withDerived(updated));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
