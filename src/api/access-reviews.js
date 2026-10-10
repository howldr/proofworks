/**
 * howldr ProofWorks
 * Access Reviews (module: access_reviews)
 *
 * CSV-first access attestation campaigns. A review names a SYSTEM and a
 * REVIEWER and carries LINES (subject × resource × access, pasted from an
 * export). The reviewer decides each line — keep / flag / remove — then
 * ATTESTS the whole review. The attestation is the append-only receipt:
 * who certified the list, when, and the decision counts it covered. Line
 * decisions are working state (re-decide while OPEN is fine); the receipt
 * and the spine events are the evidence.
 *
 * Routes (mounted behind requireTenant + requireUser + requireSameTenant +
 * requireModule('access_reviews')):
 *   GET  /api/access-reviews                any tenant member
 *   POST /api/access-reviews                admin / governance_lead / owner
 *   GET  /api/access-reviews/:id            any tenant member
 *   POST /api/access-reviews/:id/lines      writers (owner-role: own reviews)
 *   POST /api/access-reviews/:id/lines/:lineId/decide
 *                                           the review's reviewer (or managers)
 *   POST /api/access-reviews/:id/attest     the review's reviewer (or managers);
 *                                           requires every line decided
 *   POST /api/access-reviews/:id/reopen     managers
 *
 * Write model matches the other modules: admin / howldr_support /
 * governance_lead manage everything; 'owner'-role users manage the reviews
 * they created. The REVIEWER may hold any role — like a risk's acceptor,
 * the assignment is by email, and deciding + attesting are the actions it
 * grants. Spine events (object_type 'access_review') are written directly
 * via db.appendAuditEvent.
 */

const express = require('express');
const router  = express.Router();

const db = require('../db/db');
const { requireRole } = require('../middleware/auth');

const EMAIL   = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const WRITE_ROLES  = new Set(['admin', 'howldr_support', 'governance_lead', 'owner']);
const MANAGE_ROLES = new Set(['admin', 'howldr_support', 'governance_lead']);

const DECISIONS = ['keep', 'flag', 'remove'];
const MAX_LINES = 2000;

function bad(res, message) {
  res.status(400).json({ error: message });
  return null;
}

function canMutate(user, review) {
  if (MANAGE_ROLES.has(user.role)) return true;
  return user.role === 'owner' && review.created_by === user.email;
}

/** Deciding and attesting belong to the named reviewer — or a manager. */
function canReview(user, review) {
  return MANAGE_ROLES.has(user.role) || user.email === review.reviewer_email;
}

function withProgress(row) {
  const total   = row.lines_total ?? 0;
  const decided = row.lines_decided ?? 0;
  return {
    ...row,
    progress_state:
      row.status === 'ATTESTED' ? 'attested'
      : total > 0 && decided >= total ? 'ready_to_attest'
      : 'in_review',
  };
}

/** Validate a lines array → clean rows, or null after a 400. */
function parseLines(res, raw, { required }) {
  if (raw === undefined) {
    if (required) return bad(res, 'lines is required — paste at least one subject,resource row');
    return [];
  }
  if (!Array.isArray(raw) || (required && raw.length === 0)) {
    return bad(res, 'lines must be a non-empty array');
  }
  if (raw.length > MAX_LINES) return bad(res, `lines is capped at ${MAX_LINES} per review`);
  const clean = [];
  for (const [i, line] of raw.entries()) {
    const subject  = typeof line?.subject  === 'string' ? line.subject.trim()  : '';
    const resource = typeof line?.resource === 'string' ? line.resource.trim() : '';
    if (!subject || !resource) {
      return bad(res, `lines[${i}] needs both a subject and a resource`);
    }
    clean.push({
      subject, resource,
      access_detail: line.access_detail == null ? null : String(line.access_detail).trim() || null,
    });
  }
  return clean;
}

/** Load the review, 404 when missing, cache on req. */
async function loadReview(req, res) {
  const review = await db.getAccessReviewById(req.tenant.id, req.params.id);
  if (!review) {
    res.status(404).json({ error: `No access review ${req.params.id}` });
    return null;
  }
  return review;
}

// ─── GET /api/access-reviews — list with progress ─────────────────────────────

router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    const rows = await db.listAccessReviews({ tenantId: req.tenant.id, status });
    res.json(rows.map(withProgress));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── POST /api/access-reviews — open a review campaign ────────────────────────

router.post('/', requireRole([...WRITE_ROLES]), async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const body = req.body || {};

    if (typeof body.title !== 'string' || !body.title.trim())   return bad(res, 'title is required');
    if (typeof body.system !== 'string' || !body.system.trim()) return bad(res, 'system is required');

    let reviewer = req.user.email;
    if (body.reviewer != null && body.reviewer !== '') {
      if (typeof body.reviewer !== 'string' || !EMAIL.test(body.reviewer.trim())) {
        return bad(res, 'reviewer must be a valid email');
      }
      reviewer = body.reviewer.trim().toLowerCase();
    }
    for (const key of ['dueDate', 'nextReviewDate']) {
      if (body[key] != null && body[key] !== '' && !ISO_DAY.test(String(body[key]))) {
        return bad(res, `${key} must be a YYYY-MM-DD date`);
      }
    }
    const lines = parseLines(res, body.lines, { required: true });
    if (!lines) return;

    const reviewId = await db.allocateAccessReviewId(tenantId);
    const review = await db.createAccessReview({
      tenant_id:        tenantId,
      review_id:        reviewId,
      title:            body.title.trim(),
      system:           body.system.trim(),
      description:      body.description == null ? null : String(body.description),
      reviewer_email:   reviewer,
      due_date:         body.dueDate || null,
      next_review_date: body.nextReviewDate || null,
      created_by:       req.user.email,
    }, lines);
    await db.appendAuditEvent({
      tenantId, actorEmail: req.user.email,
      action: 'Access review opened', objectType: 'access_review', objectId: reviewId,
      metadata: { system: review.system, reviewer: reviewer, lines: lines.length },
    });
    res.status(201).json(withProgress({ ...review, lines_total: lines.length, lines_decided: 0 }));
  } catch (err) {
    console.error('POST /access-reviews failed:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── GET /api/access-reviews/:id — detail + lines + receipts ──────────────────

router.get('/:id', async (req, res) => {
  try {
    const review = await loadReview(req, res);
    if (!review) return;
    const [lines, attestations] = await Promise.all([
      db.listAccessReviewLines(req.tenant.id, review.review_id),
      db.getAccessReviewAttestations(req.tenant.id, review.review_id),
    ]);
    const decided = lines.filter(l => l.decision != null).length;
    res.json({
      ...withProgress({ ...review, lines_total: lines.length, lines_decided: decided }),
      lines,
      attestations,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── POST /api/access-reviews/:id/lines — add lines while OPEN ────────────────

router.post('/:id/lines', requireRole([...WRITE_ROLES]), async (req, res) => {
  try {
    const review = await loadReview(req, res);
    if (!review) return;
    if (!canMutate(req.user, review)) {
      return res.status(403).json({ error: 'You can only edit reviews you created' });
    }
    if (review.status !== 'OPEN') return bad(res, 'This review has been attested — reopen it to change lines');
    const lines = parseLines(res, req.body?.lines, { required: true });
    if (!lines) return;
    const added = await db.addAccessReviewLines(req.tenant.id, review.review_id, lines);
    await db.appendAuditEvent({
      tenantId: req.tenant.id, actorEmail: req.user.email,
      action: 'Access review lines added', objectType: 'access_review', objectId: review.review_id,
      metadata: { lines: added.length },
    });
    res.status(201).json(added);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── POST /api/access-reviews/:id/lines/:lineId/decide ────────────────────────

router.post('/:id/lines/:lineId/decide', async (req, res) => {
  try {
    const review = await loadReview(req, res);
    if (!review) return;
    if (!canReview(req.user, review)) {
      return res.status(403).json({ error: 'Only the named reviewer (or an admin/governance lead) can decide lines' });
    }
    if (review.status !== 'OPEN') return bad(res, 'This review has been attested — reopen it to change decisions');
    const { decision, note } = req.body || {};
    if (!DECISIONS.includes(decision)) {
      return bad(res, `decision must be one of: ${DECISIONS.join(', ')}`);
    }
    const line = await db.getAccessReviewLine(req.tenant.id, review.review_id, req.params.lineId);
    if (!line) return res.status(404).json({ error: 'No such line on this review' });
    const updated = await db.decideAccessReviewLine(req.tenant.id, review.review_id, line.id, {
      decision, note: note == null ? null : String(note), decidedBy: req.user.email,
    });
    res.json(updated);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── POST /api/access-reviews/:id/attest — the receipt ────────────────────────

router.post('/:id/attest', async (req, res) => {
  try {
    const review = await loadReview(req, res);
    if (!review) return;
    if (!canReview(req.user, review)) {
      return res.status(403).json({ error: 'Only the named reviewer (or an admin/governance lead) can attest' });
    }
    if (review.status !== 'OPEN') return bad(res, 'This review is already attested');

    const lines = await db.listAccessReviewLines(req.tenant.id, review.review_id);
    if (lines.length === 0) return bad(res, 'Nothing to attest — the review has no lines');
    const undecided = lines.filter(l => l.decision == null).length;
    if (undecided > 0) {
      return bad(res, `Every line needs a decision before attesting — ${undecided} still undecided`);
    }

    const counts = {
      lines_total:  lines.length,
      lines_keep:   lines.filter(l => l.decision === 'keep').length,
      lines_flag:   lines.filter(l => l.decision === 'flag').length,
      lines_remove: lines.filter(l => l.decision === 'remove').length,
    };
    const attestation = await db.addAccessReviewAttestation(req.tenant.id, {
      review_id:      review.review_id,
      reviewer_email: req.user.email,
      notes:          req.body?.notes == null ? null : String(req.body.notes),
      ...counts,
    });
    const updated = await db.updateAccessReview(req.tenant.id, review.review_id, { status: 'ATTESTED' });
    await db.appendAuditEvent({
      tenantId: req.tenant.id, actorEmail: req.user.email,
      action: 'Access review attested', objectType: 'access_review', objectId: review.review_id,
      metadata: { system: review.system, ...counts },
    });
    res.status(201).json({ review: withProgress({ ...updated, lines_total: counts.lines_total, lines_decided: counts.lines_total }), attestation });
  } catch (err) {
    console.error('POST /access-reviews/:id/attest failed:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── POST /api/access-reviews/:id/reopen — managers only ─────────────────────

router.post('/:id/reopen', requireRole(['admin', 'governance_lead', 'howldr_support']), async (req, res) => {
  try {
    const review = await loadReview(req, res);
    if (!review) return;
    if (review.status !== 'ATTESTED') return bad(res, 'Only an attested review can be reopened');
    const updated = await db.updateAccessReview(req.tenant.id, review.review_id, { status: 'OPEN' });
    await db.appendAuditEvent({
      tenantId: req.tenant.id, actorEmail: req.user.email,
      action: 'Access review reopened', objectType: 'access_review', objectId: review.review_id,
      metadata: null,
    });
    res.json(withProgress(updated));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
