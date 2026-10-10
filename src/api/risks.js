/**
 * howldr ProofWorks
 * Risk Register (module: risk_register)
 *
 * Risks assessed on a fixed 5×5 likelihood × impact matrix — inherent (before
 * treatment) and residual (after) per round. Assessment rounds are append-only;
 * ACCEPTANCE is an attributed receipt pinned to the round it covered, so a
 * re-assessment visibly needs re-acceptance. Nothing is ever overwritten.
 *
 * Score bands (likelihood × impact, 1–25):
 *   Low 1–4 · Medium 5–9 · High 10–15 · Critical 16–25
 *
 * Routes (mounted behind requireTenant + requireUser + requireSameTenant +
 * requireModule('risk_register')):
 *   GET    /api/risks            any tenant member
 *   POST   /api/risks            admin / governance_lead / owner
 *   GET    /api/risks/:id        any tenant member
 *   PUT    /api/risks/:id        writers (owner-role: own risks only)
 *   POST   /api/risks/:id/assess         "        "
 *   POST   /api/risks/:id/accept the risk's acceptor (or admin/gov lead)
 *   POST   /api/risks/:id/close  writers   POST /api/risks/:id/reopen  writers
 *
 * Write model matches the Evidence Locker: admin / howldr_support /
 * governance_lead manage everything; users with the 'owner' role manage the
 * risks they own. The ACCEPTOR may hold any role — like a policy's exec, the
 * assignment is by email, and acceptance is the one action it grants. People
 * whose only duty is signing get the dedicated 'acceptor' role, which reaches
 * this module (see the mount in src/api/index.js) without any write access.
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

function band(score) {
  if (score >= 16) return 'Critical';
  if (score >= 10) return 'High';
  if (score >= 5)  return 'Medium';
  return 'Low';
}

/** Derive scores/bands and the acceptance state from a listRisks row (which
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
    acceptance_state: !assessed
      ? 'not_assessed'
      : row.accepted ? 'accepted' : 'awaiting_acceptance',
  };
}

function canMutate(user, risk) {
  if (MANAGE_ROLES.has(user.role)) return true;
  return user.role === 'owner' && risk.owner_email === user.email;
}

/** Who may accept: the named acceptor (falls back to the owner) or a manager. */
function effectiveAcceptor(risk) {
  return risk.acceptor_email || risk.owner_email;
}

async function loadRisk(req, res) {
  const risk = await db.getRiskById(req.tenant.id, req.params.id);
  if (!risk) {
    res.status(404).json({ error: 'Risk not found' });
    return null;
  }
  req.risk = risk;
  return risk;
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
  if (has('category'))    out.category    = body.category == null ? null : String(body.category).trim() || null;
  if (has('tags')) {
    const tags = cleanIdArray(res, body.tags, 'tags');
    if (!tags) return null;
    out.tags = tags;
  }
  for (const [key, col] of [['owner', 'owner_email'], ['acceptor', 'acceptor_email']]) {
    if (has(key)) {
      if (body[key] === null || body[key] === '') {
        if (key === 'owner') return bad(res, 'owner cannot be empty');
        out[col] = null; // acceptor cleared → falls back to the owner
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
  for (const [key, col] of [['policyIds', 'policy_ids'], ['evidenceIds', 'evidence_ids']]) {
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
 * Links are references, not free text: any provided policy/evidence id must
 * exist in this tenant. Sends the 400 (naming the unknown ids) and returns
 * false when validation fails.
 */
async function validateLinks(res, tenantId, meta) {
  for (const [col, filter, label] of [
    ['policy_ids',   db.filterExistingPolicyIds,   'policy'],
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

// ─── GET /api/risks — list with derived state ─────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const { status, category } = req.query;
    const rows = await db.listRisks({ tenantId: req.tenant.id, status, category });
    res.json(rows.map(withDerived));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── POST /api/risks — register a risk ────────────────────────────────────────

router.post('/', requireRole([...WRITE_ROLES]), async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const meta = parseMetadata(res, req.body || {}, { partial: false });
    if (!meta) return;
    if (!await validateLinks(res, tenantId, meta)) return;

    const riskId = await db.allocateRiskId(tenantId);
    const risk = await db.createRisk({
      tenant_id:  tenantId,
      risk_id:    riskId,
      ...meta,
      owner_email: meta.owner_email || req.user.email,
      created_by:  req.user.email,
    });
    await db.logRiskEvent({
      tenantId, riskId,
      event:      'Risk registered',
      actorEmail: req.user.email,
    });
    res.status(201).json(withDerived(risk));
  } catch (err) {
    console.error('POST /risks failed:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── GET /api/risks/:id — detail ──────────────────────────────────────────────

router.get('/:id', async (req, res) => {
  try {
    const risk = await loadRisk(req, res);
    if (!risk) return;
    const tenantId = req.tenant.id;
    const [assessments, acceptances, events, linkedObligations] = await Promise.all([
      db.getRiskAssessments(tenantId, risk.risk_id),
      db.getRiskAcceptances(tenantId, risk.risk_id),
      db.getRiskEvents(tenantId, risk.risk_id),
      db.getObligationsLinkedTo(tenantId, 'risk', risk.risk_id),
    ]);
    const latest = assessments[assessments.length - 1] || null;
    const merged = withDerived({
      ...risk,
      round: latest?.round ?? null,
      inherent_likelihood: latest?.inherent_likelihood,
      inherent_impact:     latest?.inherent_impact,
      residual_likelihood: latest?.residual_likelihood,
      residual_impact:     latest?.residual_impact,
      treatment:           latest?.treatment ?? null,
      accepted: latest != null && acceptances.some(a => a.round === latest.round),
    });
    res.json({
      ...merged,
      effective_acceptor: effectiveAcceptor(risk),
      assessments: assessments.map(a => ({
        ...a,
        inherent_score: a.inherent_likelihood * a.inherent_impact,
        inherent_band:  band(a.inherent_likelihood * a.inherent_impact),
        residual_score: a.residual_likelihood * a.residual_impact,
        residual_band:  band(a.residual_likelihood * a.residual_impact),
      })),
      acceptances,
      events,
      linked_obligations: linkedObligations,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── PUT /api/risks/:id — edit metadata ───────────────────────────────────────

router.put('/:id', requireRole([...WRITE_ROLES]), async (req, res) => {
  try {
    const risk = await loadRisk(req, res);
    if (!risk) return;
    if (!canMutate(req.user, risk)) {
      return res.status(403).json({ error: 'You can only edit risks you own' });
    }
    const meta = parseMetadata(res, req.body || {}, { partial: true });
    if (!meta) return;
    if (!Object.keys(meta).length) return bad(res, 'No editable fields provided');
    if (!await validateLinks(res, req.tenant.id, meta)) return;

    const updated = await db.updateRisk(req.tenant.id, risk.risk_id, meta);
    await db.logRiskEvent({
      tenantId: req.tenant.id, riskId: risk.risk_id,
      event:      `Details updated: ${Object.keys(meta).join(', ')}`,
      actorEmail: req.user.email,
    });
    res.json(withDerived(updated));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── POST /api/risks/:id/assess — append the next assessment round ────────────

router.post('/:id/assess', requireRole([...WRITE_ROLES]), async (req, res) => {
  try {
    const risk = await loadRisk(req, res);
    if (!risk) return;
    if (!canMutate(req.user, risk)) {
      return res.status(403).json({ error: 'You can only assess risks you own' });
    }
    if (risk.status !== 'OPEN') return bad(res, 'Reopen the risk before re-assessing it');
    const a = parseAssessment(res, req.body || {});
    if (!a) return;

    const assessment = await db.addRiskAssessment(req.tenant.id, {
      riskId: risk.risk_id, ...a, assessedBy: req.user.email,
    });
    await db.logRiskEvent({
      tenantId: req.tenant.id, riskId: risk.risk_id,
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
      acceptance_state: 'awaiting_acceptance',
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── POST /api/risks/:id/accept — the receipt ─────────────────────────────────
//
// Only the risk's effective acceptor (acceptor_email, falling back to the
// owner) or a manager may accept, and only the LATEST round — an acceptance
// always pins to what is currently on the table.

router.post('/:id/accept', async (req, res) => {
  try {
    const risk = await loadRisk(req, res);
    if (!risk) return;
    const tenantId = req.tenant.id;

    const allowed =
      MANAGE_ROLES.has(req.user.role) || req.user.email === effectiveAcceptor(risk);
    if (!allowed) {
      return res.status(403).json({ error: 'Only the assigned acceptor can accept this risk' });
    }
    if (risk.status !== 'OPEN') return bad(res, 'This risk is closed');

    const assessments = await db.getRiskAssessments(tenantId, risk.risk_id);
    const latest = assessments[assessments.length - 1];
    if (!latest) return bad(res, 'Assess the risk before accepting it');

    const acceptances = await db.getRiskAcceptances(tenantId, risk.risk_id);
    if (acceptances.some(a => a.round === latest.round)) {
      return bad(res, `Round ${latest.round} is already accepted`);
    }

    const residual = latest.residual_likelihood * latest.residual_impact;
    const acceptance = await db.addRiskAcceptance(tenantId, {
      riskId:        risk.risk_id,
      round:         latest.round,
      acceptorEmail: req.user.email,
      notes:         req.body?.notes == null ? null : String(req.body.notes),
    });
    await db.logRiskEvent({
      tenantId, riskId: risk.risk_id,
      event:      `Residual risk accepted (round ${latest.round}, ${band(residual)} ${residual}) by ${req.user.email}`,
      actorEmail: req.user.email,
      metadata:   { round: latest.round, residual_score: residual, residual_band: band(residual) },
    });
    res.status(201).json({ ...acceptance, residual_score: residual, residual_band: band(residual) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── POST /api/risks/:id/close · /reopen ──────────────────────────────────────

router.post('/:id/close', requireRole([...WRITE_ROLES]), async (req, res) => {
  try {
    const risk = await loadRisk(req, res);
    if (!risk) return;
    if (!canMutate(req.user, risk)) {
      return res.status(403).json({ error: 'You can only close risks you own' });
    }
    if (risk.status === 'CLOSED') return bad(res, 'Risk is already closed');
    const updated = await db.updateRisk(req.tenant.id, risk.risk_id, { status: 'CLOSED' });
    await db.logRiskEvent({
      tenantId: req.tenant.id, riskId: risk.risk_id,
      event: 'Risk closed', actorEmail: req.user.email,
      metadata: req.body?.reason ? { reason: String(req.body.reason) } : undefined,
    });
    res.json(withDerived(updated));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/:id/reopen', requireRole([...WRITE_ROLES]), async (req, res) => {
  try {
    const risk = await loadRisk(req, res);
    if (!risk) return;
    if (!canMutate(req.user, risk)) {
      return res.status(403).json({ error: 'You can only reopen risks you own' });
    }
    if (risk.status === 'OPEN') return bad(res, 'Risk is already open');
    const updated = await db.updateRisk(req.tenant.id, risk.risk_id, { status: 'OPEN' });
    await db.logRiskEvent({
      tenantId: req.tenant.id, riskId: risk.risk_id,
      event: 'Risk reopened', actorEmail: req.user.email,
    });
    res.json(withDerived(updated));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
