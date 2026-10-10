/**
 * howldr ProofWorks
 * Vendor Assessments (module: vendor_assessments)
 *
 * A vendor IS a risk until understood. Vendors are assessed on the same fixed
 * 5×5 likelihood × impact matrix as the Risk Register — inherent (before
 * safeguards) and residual (after) — in append-only rounds. The DECISION is
 * the receipt, and unlike a risk acceptance it is bidirectional: APPROVE
 * (engage, accepting the residual risk) or DECLINE (walk away — declining
 * after due diligence is itself audit-valuable evidence). A decision pins to
 * the round it judged, so a re-assessment visibly reopens the decision.
 *
 * Tier escalation (the category-triggered exec gate, in miniature): HIGH and
 * CRITICAL tier vendors can only be decided by an admin / governance lead;
 * below that the named approver (falling back to the relationship owner)
 * suffices. Vendors are OFFBOARDED, never deleted.
 *
 * Routes (mounted behind requireTenant + requireUser + requireSameTenant +
 * requireModule('vendor_assessments')):
 *   GET    /api/vendors            any tenant member
 *   POST   /api/vendors            admin / governance_lead / owner
 *   GET    /api/vendors/:id        any tenant member
 *   PUT    /api/vendors/:id        writers (owner-role: own vendors only)
 *   POST   /api/vendors/:id/assess          "        "
 *   POST   /api/vendors/:id/decide  the vendor's approver (or admin/gov lead;
 *                                   high/critical tier: admin/gov lead ONLY)
 *   POST   /api/vendors/:id/offboard  writers   POST /api/vendors/:id/reactivate  writers
 *
 * Write model matches the Risk Register: admin / howldr_support /
 * governance_lead manage everything; users with the 'owner' role manage the
 * vendors they own. The APPROVER may hold any role — the assignment is by
 * email, and (below the tier gate) deciding is the one action it grants.
 */

const express = require('express');
const router  = express.Router();

const db = require('../db/db');
const { requireRole } = require('../middleware/auth');

const EMAIL   = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const WRITE_ROLES  = new Set(['admin', 'howldr_support', 'governance_lead', 'owner']);
const MANAGE_ROLES = new Set(['admin', 'howldr_support', 'governance_lead']);

const TREATMENTS = ['accept', 'mitigate', 'transfer', 'avoid'];
const TIERS      = ['low', 'medium', 'high', 'critical'];
const DECISIONS  = ['approve', 'decline'];

/** Tiers whose decision escalates past the named approver to a manager. */
const ESCALATED_TIERS = new Set(['high', 'critical']);

function band(score) {
  if (score >= 16) return 'Critical';
  if (score >= 10) return 'High';
  if (score >= 5)  return 'Medium';
  return 'Low';
}

/** Derive scores/bands and the decision state from a listVendors row (which
 *  carries the latest round's fields) — nothing here is stored. */
function withDerived(row) {
  const assessed = row.round != null;
  const inherent = assessed ? row.inherent_likelihood * row.inherent_impact : null;
  const residual = assessed ? row.residual_likelihood * row.residual_impact : null;
  return {
    ...row,
    inherent_score: inherent,
    inherent_band:  inherent == null ? null : band(inherent),
    residual_score: residual,
    residual_band:  residual == null ? null : band(residual),
    decision_state: !assessed
      ? 'not_assessed'
      : row.decision === 'approve' ? 'approved'
      : row.decision === 'decline' ? 'declined'
      : 'awaiting_decision',
  };
}

function canMutate(user, vendor) {
  if (MANAGE_ROLES.has(user.role)) return true;
  return user.role === 'owner' && vendor.owner_email === user.email;
}

/** Who may decide: managers always; the named approver (falls back to the
 *  owner) only below the tier gate. */
function canDecide(user, vendor) {
  if (MANAGE_ROLES.has(user.role)) return true;
  if (ESCALATED_TIERS.has(vendor.tier)) return false;
  return user.email === effectiveApprover(vendor);
}

function effectiveApprover(vendor) {
  return vendor.approver_email || vendor.owner_email;
}

async function loadVendor(req, res) {
  const vendor = await db.getVendorById(req.tenant.id, req.params.id);
  if (!vendor) {
    res.status(404).json({ error: 'Vendor not found' });
    return null;
  }
  req.vendor = vendor;
  return vendor;
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

  if (has('name') || !partial) {
    if (typeof body.name !== 'string' || !body.name.trim()) return bad(res, 'name is required');
    out.name = body.name.trim();
  }
  if (has('description')) out.description = body.description == null ? null : String(body.description);
  if (has('category'))    out.category    = body.category == null ? null : String(body.category).trim() || null;
  if (has('dataScope'))   out.data_scope  = body.dataScope == null ? null : String(body.dataScope).trim() || null;
  if (has('tags')) {
    const tags = cleanIdArray(res, body.tags, 'tags');
    if (!tags) return null;
    out.tags = tags;
  }
  if (has('tier')) {
    if (!TIERS.includes(body.tier)) return bad(res, `tier must be one of: ${TIERS.join(', ')}`);
    out.tier = body.tier;
  }
  for (const [key, col] of [['owner', 'owner_email'], ['approver', 'approver_email']]) {
    if (has(key)) {
      if (body[key] === null || body[key] === '') {
        if (key === 'owner') return bad(res, 'owner cannot be empty');
        out[col] = null; // approver cleared → falls back to the owner
      } else {
        if (typeof body[key] !== 'string' || !EMAIL.test(body[key].trim())) {
          return bad(res, `${key} must be a valid email`);
        }
        out[col] = body[key].trim().toLowerCase();
      }
    }
  }
  if (has('nextReviewDate')) {
    if (body.nextReviewDate !== null && body.nextReviewDate !== '' && !ISO_DAY.test(String(body.nextReviewDate))) {
      return bad(res, 'nextReviewDate must be a YYYY-MM-DD date');
    }
    out.next_review_date = body.nextReviewDate ? String(body.nextReviewDate) : null;
  }
  for (const [key, col] of [
    ['policyIds', 'policy_ids'], ['evidenceIds', 'evidence_ids'], ['riskIds', 'risk_ids'],
  ]) {
    if (has(key)) {
      const ids = cleanIdArray(res, body[key], key);
      if (!ids) return null;
      out[col] = ids;
    }
  }
  return out;
}

/** Validate an assessment body → db args, or null after a 400. */
function parseAssessment(res, body) {
  const nums = {};
  for (const [key, label] of [
    ['inherentLikelihood', 'inherent likelihood'], ['inherentImpact', 'inherent impact'],
    ['residualLikelihood', 'residual likelihood'], ['residualImpact', 'residual impact'],
  ]) {
    const n = Number(body[key]);
    if (!Number.isInteger(n) || n < 1 || n > 5) {
      return bad(res, `${label} must be an integer 1–5`);
    }
    nums[key] = n;
  }
  if (!TREATMENTS.includes(body.treatment)) {
    return bad(res, `treatment must be one of: ${TREATMENTS.join(', ')}`);
  }
  return {
    inherentLikelihood: nums.inherentLikelihood,
    inherentImpact:     nums.inherentImpact,
    residualLikelihood: nums.residualLikelihood,
    residualImpact:     nums.residualImpact,
    treatment:          body.treatment,
    treatmentNotes:     body.treatmentNotes == null ? null : String(body.treatmentNotes),
  };
}

/**
 * Links are references, not free text: any provided policy/evidence/risk id
 * must exist in this tenant. Sends the 400 (naming the unknown ids) and
 * returns false when validation fails.
 */
async function validateLinks(res, tenantId, meta) {
  for (const [col, filter, label] of [
    ['policy_ids',   db.filterExistingPolicyIds,   'policy'],
    ['evidence_ids', db.filterExistingEvidenceIds, 'evidence'],
    ['risk_ids',     db.filterExistingRiskIds,     'risk'],
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

// ─── GET /api/vendors — list with derived state ───────────────────────────────

router.get('/', async (req, res) => {
  try {
    const { status, category, tier } = req.query;
    const rows = await db.listVendors({ tenantId: req.tenant.id, status, category, tier });
    res.json(rows.map(withDerived));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── POST /api/vendors — register a vendor ────────────────────────────────────

router.post('/', requireRole([...WRITE_ROLES]), async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const meta = parseMetadata(res, req.body || {}, { partial: false });
    if (!meta) return;
    if (!await validateLinks(res, tenantId, meta)) return;

    const vendorId = await db.allocateVendorId(tenantId);
    const vendor = await db.createVendor({
      tenant_id:  tenantId,
      vendor_id:  vendorId,
      ...meta,
      owner_email: meta.owner_email || req.user.email,
      created_by:  req.user.email,
    });
    await db.logVendorEvent({
      tenantId, vendorId,
      event:      'Vendor registered',
      actorEmail: req.user.email,
      metadata:   { tier: vendor.tier },
    });
    res.status(201).json(withDerived(vendor));
  } catch (err) {
    console.error('POST /vendors failed:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── GET /api/vendors/:id — detail ────────────────────────────────────────────

router.get('/:id', async (req, res) => {
  try {
    const vendor = await loadVendor(req, res);
    if (!vendor) return;
    const tenantId = req.tenant.id;
    const [assessments, decisions, events] = await Promise.all([
      db.getVendorAssessments(tenantId, vendor.vendor_id),
      db.getVendorDecisions(tenantId, vendor.vendor_id),
      db.getVendorEvents(tenantId, vendor.vendor_id),
    ]);
    const latest = assessments[assessments.length - 1] || null;
    const latestDecision = latest
      ? decisions.filter(d => d.round === latest.round).pop() ?? null
      : null;
    const merged = withDerived({
      ...vendor,
      round: latest?.round ?? null,
      inherent_likelihood: latest?.inherent_likelihood,
      inherent_impact:     latest?.inherent_impact,
      residual_likelihood: latest?.residual_likelihood,
      residual_impact:     latest?.residual_impact,
      treatment:           latest?.treatment ?? null,
      decision:            latestDecision?.decision ?? null,
    });
    res.json({
      ...merged,
      effective_approver: effectiveApprover(vendor),
      tier_escalated:     ESCALATED_TIERS.has(vendor.tier),
      assessments: assessments.map(a => ({
        ...a,
        inherent_score: a.inherent_likelihood * a.inherent_impact,
        inherent_band:  band(a.inherent_likelihood * a.inherent_impact),
        residual_score: a.residual_likelihood * a.residual_impact,
        residual_band:  band(a.residual_likelihood * a.residual_impact),
      })),
      decisions,
      events,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── PUT /api/vendors/:id — edit metadata ─────────────────────────────────────

router.put('/:id', requireRole([...WRITE_ROLES]), async (req, res) => {
  try {
    const vendor = await loadVendor(req, res);
    if (!vendor) return;
    if (!canMutate(req.user, vendor)) {
      return res.status(403).json({ error: 'You can only edit vendors you own' });
    }
    const meta = parseMetadata(res, req.body || {}, { partial: true });
    if (!meta) return;
    if (!Object.keys(meta).length) return bad(res, 'No editable fields provided');
    if (!await validateLinks(res, req.tenant.id, meta)) return;

    const updated = await db.updateVendor(req.tenant.id, vendor.vendor_id, meta);
    await db.logVendorEvent({
      tenantId: req.tenant.id, vendorId: vendor.vendor_id,
      event:      `Details updated: ${Object.keys(meta).join(', ')}`,
      actorEmail: req.user.email,
    });
    res.json(withDerived(updated));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── POST /api/vendors/:id/assess — append the next assessment round ──────────

router.post('/:id/assess', requireRole([...WRITE_ROLES]), async (req, res) => {
  try {
    const vendor = await loadVendor(req, res);
    if (!vendor) return;
    if (!canMutate(req.user, vendor)) {
      return res.status(403).json({ error: 'You can only assess vendors you own' });
    }
    if (vendor.status !== 'OPEN') return bad(res, 'Reactivate the vendor before re-assessing it');
    const a = parseAssessment(res, req.body || {});
    if (!a) return;

    const assessment = await db.addVendorAssessment(req.tenant.id, {
      vendorId: vendor.vendor_id, ...a, assessedBy: req.user.email,
    });
    await db.logVendorEvent({
      tenantId: req.tenant.id, vendorId: vendor.vendor_id,
      event:      `Assessed (round ${assessment.round}): inherent ${a.inherentLikelihood}×${a.inherentImpact}=${a.inherentLikelihood * a.inherentImpact} → residual ${a.residualLikelihood}×${a.residualImpact}=${a.residualLikelihood * a.residualImpact} (${a.treatment})`,
      actorEmail: req.user.email,
      metadata:   { round: assessment.round, treatment: a.treatment },
    });
    res.status(201).json({
      ...assessment,
      inherent_score: a.inherentLikelihood * a.inherentImpact,
      inherent_band:  band(a.inherentLikelihood * a.inherentImpact),
      residual_score: a.residualLikelihood * a.residualImpact,
      residual_band:  band(a.residualLikelihood * a.residualImpact),
      decision_state: 'awaiting_decision',
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── POST /api/vendors/:id/decide — the receipt (approve or decline) ──────────
//
// Only the vendor's effective approver (approver_email, falling back to the
// owner) or a manager may decide — and for HIGH / CRITICAL tier vendors, a
// manager ONLY (the tier escalation gate). A decision always judges the
// LATEST round, and a round takes exactly one decision: re-assess to put a
// fresh round on the table.

router.post('/:id/decide', async (req, res) => {
  try {
    const vendor = await loadVendor(req, res);
    if (!vendor) return;
    const tenantId = req.tenant.id;

    if (!canDecide(req.user, vendor)) {
      return res.status(403).json({
        error: ESCALATED_TIERS.has(vendor.tier)
          ? `A ${vendor.tier}-tier vendor can only be decided by an admin or governance lead`
          : 'Only the assigned approver can decide this vendor',
      });
    }
    if (vendor.status !== 'OPEN') return bad(res, 'This vendor is offboarded');

    const { decision } = req.body || {};
    if (!DECISIONS.includes(decision)) {
      return bad(res, `decision must be one of: ${DECISIONS.join(', ')}`);
    }

    const assessments = await db.getVendorAssessments(tenantId, vendor.vendor_id);
    const latest = assessments[assessments.length - 1];
    if (!latest) return bad(res, 'Assess the vendor before deciding');

    const decisions = await db.getVendorDecisions(tenantId, vendor.vendor_id);
    if (decisions.some(d => d.round === latest.round)) {
      return bad(res, `Round ${latest.round} is already decided — re-assess to open a new round`);
    }

    const residual = latest.residual_likelihood * latest.residual_impact;
    const receipt = await db.addVendorDecision(tenantId, {
      vendorId:     vendor.vendor_id,
      round:        latest.round,
      decision,
      deciderEmail: req.user.email,
      notes:        req.body?.notes == null ? null : String(req.body.notes),
    });
    await db.logVendorEvent({
      tenantId, vendorId: vendor.vendor_id,
      event: decision === 'approve'
        ? `Vendor approved (round ${latest.round}, residual ${band(residual)} ${residual}) by ${req.user.email}`
        : `Vendor declined (round ${latest.round}, residual ${band(residual)} ${residual}) by ${req.user.email}`,
      actorEmail: req.user.email,
      metadata:   { round: latest.round, decision, residual_score: residual, residual_band: band(residual), tier: vendor.tier },
    });
    res.status(201).json({ ...receipt, residual_score: residual, residual_band: band(residual) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── POST /api/vendors/:id/offboard · /reactivate ─────────────────────────────

router.post('/:id/offboard', requireRole([...WRITE_ROLES]), async (req, res) => {
  try {
    const vendor = await loadVendor(req, res);
    if (!vendor) return;
    if (!canMutate(req.user, vendor)) {
      return res.status(403).json({ error: 'You can only offboard vendors you own' });
    }
    if (vendor.status === 'OFFBOARDED') return bad(res, 'Vendor is already offboarded');
    const updated = await db.updateVendor(req.tenant.id, vendor.vendor_id, { status: 'OFFBOARDED' });
    await db.logVendorEvent({
      tenantId: req.tenant.id, vendorId: vendor.vendor_id,
      event: 'Vendor offboarded', actorEmail: req.user.email,
      metadata: req.body?.reason ? { reason: String(req.body.reason) } : undefined,
    });
    res.json(withDerived(updated));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/:id/reactivate', requireRole([...WRITE_ROLES]), async (req, res) => {
  try {
    const vendor = await loadVendor(req, res);
    if (!vendor) return;
    if (!canMutate(req.user, vendor)) {
      return res.status(403).json({ error: 'You can only reactivate vendors you own' });
    }
    if (vendor.status === 'OPEN') return bad(res, 'Vendor is already active');
    const updated = await db.updateVendor(req.tenant.id, vendor.vendor_id, { status: 'OPEN' });
    await db.logVendorEvent({
      tenantId: req.tenant.id, vendorId: vendor.vendor_id,
      event: 'Vendor reactivated', actorEmail: req.user.email,
    });
    res.json(withDerived(updated));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
