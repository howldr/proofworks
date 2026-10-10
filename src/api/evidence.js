/**
 * howldr ProofWorks
 * Evidence Locker (module: evidence_locker)
 *
 * A register of evidence items — attributed, timestamped, hash-pinned,
 * append-only — plus the evidence-pack export (a self-verifying zip an
 * auditor can check offline).
 *
 * Proof strength is DERIVED from what an item carries (never stored):
 *   held          — file on the tenant's share (lf_file_id + checksum)
 *   fingerprinted — SHA-256 captured at registration, bytes NOT stored
 *   declared      — locator/attestation only
 *
 * Routes (mounted behind requireTenant + requireUser + requireSameTenant +
 * requireModule('evidence_locker')):
 *   GET    /api/evidence            any tenant member
 *   POST   /api/evidence            admin / governance_lead / owner
 *   GET    /api/evidence/pack       admin / governance_lead / viewer
 *   GET    /api/evidence/:id        any tenant member
 *   PUT    /api/evidence/:id        writers (owner-role: own items only)
 *   POST   /api/evidence/:id/file          "        "
 *   POST   /api/evidence/:id/fingerprint   "        "
 *   POST   /api/evidence/:id/verify        "        "
 *   POST   /api/evidence/:id/retire        "        "
 *
 * Write model: admin / howldr_support / governance_lead manage everything;
 * users with the 'owner' role can create items and mutate the ones they own
 * (owner_email matches). Authorisers and viewers are read-only.
 */

const crypto  = require('crypto');
const express = require('express');
const router  = express.Router();

const db = require('../db/db');
const { createFolder, getRootFolderId, uploadFileToFolder, downloadFile } = require('../liquidfiles/folders');
const { requireRole } = require('../middleware/auth');
const { verifyChain } = require('../audit/spine');
const { toCsv: policiesToCsv, csvField } = require('./register-export');
const { buildZip } = require('../util/zip');

const EMAIL  = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const SHA256 = /^[a-f0-9]{64}$/i;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const WRITE_ROLES  = new Set(['admin', 'howldr_support', 'governance_lead', 'owner']);
const MANAGE_ROLES = new Set(['admin', 'howldr_support', 'governance_lead']);

// Broader than policy documents — evidence includes spreadsheets, screenshots,
// logs, and mail exports.
const EVIDENCE_TYPES = {
  '.pdf':  'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc':  'application/msword',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv':  'text/csv',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.txt':  'text/plain',
  '.md':   'text/markdown',
  '.eml':  'message/rfc822',
  '.msg':  'application/vnd.ms-outlook',
  '.zip':  'application/zip',
};

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** held | fingerprinted | declared — derived, so it can never drift. */
function strengthOf(item) {
  if (item.lf_file_id) return 'held';
  if (item.checksum)   return 'fingerprinted';
  return 'declared';
}

function withStrength(item) {
  return { ...item, strength: strengthOf(item) };
}

/** Writers only; users with the 'owner' role may only mutate their own items. */
function canMutate(user, item) {
  if (MANAGE_ROLES.has(user.role)) return true;
  return user.role === 'owner' && item.owner_email === user.email;
}

/** Load the item, 404 when missing, and cache it on req. */
async function loadItem(req, res) {
  const item = await db.getEvidenceById(req.tenant.id, req.params.id);
  if (!item) {
    res.status(404).json({ error: 'Evidence item not found' });
    return null;
  }
  req.evidence = item;
  return item;
}

function bad(res, msg) {
  res.status(400).json({ error: msg });
  return null;
}

/** Validate + normalise the editable metadata fields from a request body.
 *  Returns a db-column update object, or null after writing a 400. */
function parseMetadata(res, body, { partial }) {
  const out = {};
  const has = (k) => body[k] !== undefined;

  if (has('title') || !partial) {
    if (typeof body.title !== 'string' || !body.title.trim()) return bad(res, 'title is required');
    out.title = body.title.trim();
  }
  if (has('description'))  out.description  = body.description == null ? null : String(body.description);
  if (has('category'))     out.category     = body.category == null ? null : String(body.category).trim() || null;
  if (has('controlLabel')) out.control_label = body.controlLabel == null ? null : String(body.controlLabel).trim() || null;
  if (has('locator'))      out.locator      = body.locator == null ? null : String(body.locator).trim() || null;
  if (has('tags')) {
    if (!Array.isArray(body.tags)) return bad(res, 'tags must be an array of strings');
    out.tags = Array.from(new Set(body.tags.map(t => String(t).trim()).filter(Boolean)));
  }
  if (has('owner')) {
    if (typeof body.owner !== 'string' || !EMAIL.test(body.owner.trim())) return bad(res, 'owner must be a valid email');
    out.owner_email = body.owner.trim().toLowerCase();
  }
  for (const [key, col] of [['collectedAt', 'collected_at'], ['expiresAt', 'expires_at']]) {
    if (has(key)) {
      if (body[key] !== null && body[key] !== '' && !ISO_DAY.test(String(body[key]))) {
        return bad(res, `${key} must be a YYYY-MM-DD date`);
      }
      out[col] = body[key] ? String(body[key]) : null;
    }
  }
  return out;
}

// ─── GET /api/evidence — list ─────────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const { status, category } = req.query;
    const items = await db.listEvidence({ tenantId: req.tenant.id, status, category });
    res.json(items.map(withStrength));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── GET /api/evidence/pack — the audit-pack export ──────────────────────────
//
// One auditor deliverable: manifest.json + evidence.csv (every item, its
// metadata, its checksum) + the held files, the policy register and every
// decision receipt, the risk register with assessment rounds and acceptance
// receipts, access reviews with line decisions and attestations, the vendor
// register with assessment rounds and approve/decline receipts (each when the
// workspace has that module enabled), and the full audit spine — with the chain
// verified during export and the result recorded in the manifest. Checksums make it self-verifying. A file that can't be
// fetched is marked in the manifest rather than failing the pack.

router.get('/pack',
  requireRole(['admin', 'governance_lead', 'viewer', 'howldr_support']),
  async (req, res) => {
    try {
      const tenantId = req.tenant.id;
      const status   = req.query.status || 'ACTIVE';
      const category = req.query.category || undefined;

      const items = (await db.listEvidence({
        tenantId, category, status: status === 'all' ? undefined : status,
      })).map(withStrength);

      const entries = [];
      const fileNotes = {};

      for (const item of items) {
        if (!item.lf_file_id) continue;
        try {
          const { buffer } = await downloadFile(req.tenant.lf_share_name, item.lf_folder_id, item.lf_file_id);
          const actual = sha256(buffer);
          fileNotes[item.evidence_id] = actual === item.checksum ? 'verified' : 'CHECKSUM MISMATCH';
          entries.push({ name: `files/${item.evidence_id}-${item.file_name}`, data: buffer });
        } catch (err) {
          console.warn(`[evidence] pack: fetch ${item.evidence_id} failed: ${err.message}`);
          fileNotes[item.evidence_id] = `file unavailable (${err.message})`;
        }
      }

      const manifestItems = items.map(i => ({
        evidence_id: i.evidence_id,
        title: i.title,
        description: i.description,
        category: i.category,
        tags: i.tags,
        control_label: i.control_label,
        owner_email: i.owner_email,
        collected_at: i.collected_at,
        expires_at: i.expires_at,
        status: i.status,
        superseded_by: i.superseded_by,
        strength: i.strength,
        locator: i.locator,
        file_name: i.file_name,
        sha256: i.checksum,
        pack_file: i.lf_file_id && fileNotes[i.evidence_id] === 'verified'
          ? `files/${i.evidence_id}-${i.file_name}` : null,
        pack_note: fileNotes[i.evidence_id] ?? null,
        created_by: i.created_by,
        created_at: i.created_at,
      }));

      const evidenceCsvCols = [
        'evidence_id', 'title', 'category', 'tags', 'control_label', 'owner_email',
        'collected_at', 'expires_at', 'status', 'strength', 'locator', 'file_name',
        'sha256', 'pack_file', 'pack_note', 'created_by', 'created_at',
      ];
      const evidenceCsv = [
        evidenceCsvCols.join(','),
        ...manifestItems.map(r => evidenceCsvCols.map(c => csvField(r[c])).join(',')),
      ].join('\r\n') + '\r\n';

      // The policy spine: register + every decision receipt.
      const policies = await db.listPolicies({ tenantId, limit: 10000 });
      const receipts = await db.listApprovalReceipts(tenantId);
      const receiptCols = [
        'policy_id', 'title', 'tier', 'stage_position', 'authoriser_email',
        'decision', 'version', 'content_hash', 'created_at',
      ];
      const receiptsCsv = [
        receiptCols.join(','),
        ...receipts.map(r => receiptCols.map(c => csvField(r[c])).join(',')),
      ].join('\r\n') + '\r\n';

      // The Risk Register (when the workspace has it enabled): the register with
      // latest-round scoring, every assessment round, and every acceptance
      // receipt — risk acceptance is an evidence event, so it belongs in the
      // same auditor deliverable.
      const riskEntitled = req.user.role === 'howldr_support' ||
        (req.tenant.entitlements || []).includes('risk_register');
      const riskEntries = [];
      let risks = [], riskAssessments = [], riskAcceptances = [];
      if (riskEntitled) {
        [risks, riskAssessments, riskAcceptances] = await Promise.all([
          db.listRisks({ tenantId }),
          db.listRiskAssessments(tenantId),
          db.listRiskAcceptances(tenantId),
        ]);
        const band = (s) => (s >= 16 ? 'Critical' : s >= 10 ? 'High' : s >= 5 ? 'Medium' : 'Low');
        const riskRows = risks.map(r => {
          const assessed = r.round != null;
          const inherent = assessed ? r.inherent_likelihood * r.inherent_impact : null;
          const residual = assessed ? r.residual_likelihood * r.residual_impact : null;
          return {
            ...r,
            inherent_score: inherent, inherent_band: inherent == null ? null : band(inherent),
            residual_score: residual, residual_band: residual == null ? null : band(residual),
            acceptance_state: !assessed ? 'not_assessed' : r.accepted ? 'accepted' : 'awaiting_acceptance',
          };
        });
        const riskCols = [
          'risk_id', 'title', 'category', 'owner_email', 'acceptor_email', 'status',
          'round', 'inherent_score', 'inherent_band', 'residual_score', 'residual_band',
          'treatment', 'acceptance_state', 'next_review_date', 'policy_ids', 'evidence_ids',
          'created_by', 'created_at',
        ];
        const assessCols = [
          'risk_id', 'title', 'round', 'inherent_likelihood', 'inherent_impact',
          'residual_likelihood', 'residual_impact', 'treatment', 'treatment_notes',
          'assessed_by', 'created_at',
        ];
        const acceptCols = ['risk_id', 'title', 'round', 'acceptor_email', 'notes', 'created_at'];
        const toCsv = (cols, rows) =>
          [cols.join(','), ...rows.map(r => cols.map(c => csvField(r[c])).join(','))].join('\r\n') + '\r\n';
        riskEntries.push(
          { name: 'risk-register.csv',    data: toCsv(riskCols, riskRows) },
          { name: 'risk-assessments.csv', data: toCsv(assessCols, riskAssessments) },
          { name: 'risk-acceptances.csv', data: toCsv(acceptCols, riskAcceptances) },
        );
      }

      // Access Reviews (when enabled): the review register, every line
      // decision, and every attestation receipt.
      const arEntitled = req.user.role === 'howldr_support' ||
        (req.tenant.entitlements || []).includes('access_reviews');
      const arEntries = [];
      let accessReviews = [], accessLines = [], accessAttestations = [];
      if (arEntitled) {
        [accessReviews, accessLines, accessAttestations] = await Promise.all([
          db.listAccessReviews({ tenantId }),
          db.listAllAccessReviewLines(tenantId),
          db.listAccessReviewAttestations(tenantId),
        ]);
        const toCsv = (cols, rows) =>
          [cols.join(','), ...rows.map(r => cols.map(c => csvField(r[c])).join(','))].join('\r\n') + '\r\n';
        arEntries.push(
          { name: 'access-reviews.csv', data: toCsv([
            'review_id', 'title', 'system', 'reviewer_email', 'status', 'due_date',
            'next_review_date', 'lines_total', 'lines_decided', 'lines_flag', 'lines_remove',
            'created_by', 'created_at',
          ], accessReviews) },
          { name: 'access-review-lines.csv', data: toCsv([
            'review_id', 'title', 'system', 'subject', 'resource', 'access_detail',
            'decision', 'decision_note', 'decided_by', 'decided_at',
          ], accessLines) },
          { name: 'access-review-attestations.csv', data: toCsv([
            'review_id', 'title', 'system', 'reviewer_email', 'notes',
            'lines_total', 'lines_keep', 'lines_flag', 'lines_remove', 'created_at',
          ], accessAttestations) },
        );
      }

      // Vendor Assessments (when enabled): the vendor register with latest-
      // round scoring and decision state, every assessment round, and every
      // decision receipt — approvals AND declines both evidence due diligence.
      const vendorEntitled = req.user.role === 'howldr_support' ||
        (req.tenant.entitlements || []).includes('vendor_assessments');
      const vendorEntries = [];
      let vendors = [], vendorAssessments = [], vendorDecisions = [];
      if (vendorEntitled) {
        [vendors, vendorAssessments, vendorDecisions] = await Promise.all([
          db.listVendors({ tenantId }),
          db.listVendorAssessments(tenantId),
          db.listVendorDecisions(tenantId),
        ]);
        const band = (s) => (s >= 16 ? 'Critical' : s >= 10 ? 'High' : s >= 5 ? 'Medium' : 'Low');
        const vendorRows = vendors.map(v => {
          const assessed = v.round != null;
          const inherent = assessed ? v.inherent_likelihood * v.inherent_impact : null;
          const residual = assessed ? v.residual_likelihood * v.residual_impact : null;
          return {
            ...v,
            inherent_score: inherent, inherent_band: inherent == null ? null : band(inherent),
            residual_score: residual, residual_band: residual == null ? null : band(residual),
            decision_state: !assessed ? 'not_assessed'
              : v.decision === 'approve' ? 'approved'
              : v.decision === 'decline' ? 'declined'
              : 'awaiting_decision',
          };
        });
        const vendorCols = [
          'vendor_id', 'name', 'category', 'tier', 'data_scope', 'owner_email',
          'approver_email', 'status', 'round', 'inherent_score', 'inherent_band',
          'residual_score', 'residual_band', 'treatment', 'decision_state',
          'next_review_date', 'policy_ids', 'evidence_ids', 'risk_ids',
          'created_by', 'created_at',
        ];
        const vAssessCols = [
          'vendor_id', 'name', 'round', 'inherent_likelihood', 'inherent_impact',
          'residual_likelihood', 'residual_impact', 'treatment', 'treatment_notes',
          'assessed_by', 'created_at',
        ];
        const vDecideCols = ['vendor_id', 'name', 'round', 'decision', 'decider_email', 'notes', 'created_at'];
        const toCsv = (cols, rows) =>
          [cols.join(','), ...rows.map(r => cols.map(c => csvField(r[c])).join(','))].join('\r\n') + '\r\n';
        vendorEntries.push(
          { name: 'vendor-register.csv',    data: toCsv(vendorCols, vendorRows) },
          { name: 'vendor-assessments.csv', data: toCsv(vAssessCols, vendorAssessments) },
          { name: 'vendor-decisions.csv',   data: toCsv(vDecideCols, vendorDecisions) },
        );
      }

      // Obligations Register (when enabled): the Understanding layer — every
      // commitment with its source and what answers it, so the pack shows not
      // just the receipts but the reasons they exist.
      const oblEntitled = req.user.role === 'howldr_support' ||
        (req.tenant.entitlements || []).includes('obligations');
      const oblEntries = [];
      let obligations = [];
      if (oblEntitled) {
        obligations = await db.listObligations({ tenantId });
        const oblRows = obligations.map(o => ({
          ...o,
          coverage_state: o.status !== 'ACTIVE' ? 'retired'
            : (o.policy_ids?.length || o.risk_ids?.length || o.evidence_ids?.length)
              ? 'answered' : 'unanswered',
        }));
        const oblCols = [
          'obligation_id', 'title', 'source_type', 'source_name', 'source_ref',
          'owner_email', 'status', 'coverage_state', 'next_review_date',
          'policy_ids', 'risk_ids', 'evidence_ids', 'created_by', 'created_at',
        ];
        const toCsv = (cols, rows) =>
          [cols.join(','), ...rows.map(r => cols.map(c => csvField(r[c])).join(','))].join('\r\n') + '\r\n';
        oblEntries.push({ name: 'obligations.csv', data: toCsv(oblCols, oblRows) });
      }

      // The audit spine: the full hash-chained ledger, verified as part of the
      // export — the pack certifies its own integrity in the manifest.
      const chain       = await db.getAuditChain(tenantId);
      const chainResult = verifyChain(chain);
      const auditCols = [
        'id', 'occurred_at', 'actor_email', 'action', 'object_type', 'object_id',
        'metadata', 'prev_hash', 'event_hash',
      ];
      const auditCsv = [
        auditCols.join(','),
        ...chain.map(e => auditCols.map(c =>
          csvField(c === 'metadata' && e.metadata != null ? JSON.stringify(e.metadata) : e[c])
        ).join(',')),
      ].join('\r\n') + '\r\n';

      const manifest = {
        tenant:       req.tenant.slug,
        exported_at:  new Date().toISOString(),
        exported_by:  req.user.email,
        scope:        { status, category: category ?? 'all' },
        counts: {
          evidence_items:   items.length,
          files_included:   entries.length,
          policies:         policies.length,
          policy_receipts:  receipts.length,
          risks:                      risks.length,
          risk_assessments:           riskAssessments.length,
          risk_acceptances:           riskAcceptances.length,
          access_reviews:             accessReviews.length,
          access_review_lines:        accessLines.length,
          access_review_attestations: accessAttestations.length,
          vendors:                    vendors.length,
          vendor_assessments:         vendorAssessments.length,
          vendor_decisions:           vendorDecisions.length,
          obligations:                obligations.length,
          audit_events:               chain.length,
        },
        audit_chain: {
          intact:         chainResult.intact,
          events_checked: chainResult.checked,
          break_at:       chainResult.breakAt,
        },
        evidence: manifestItems,
      };

      const today = new Date().toISOString().split('T')[0];
      const zip = buildZip([
        { name: 'manifest.json',        data: JSON.stringify(manifest, null, 2) },
        { name: 'evidence.csv',         data: evidenceCsv },
        { name: 'policy-register.csv',  data: policiesToCsv(policies) },
        { name: 'policy-receipts.csv',  data: receiptsCsv },
        ...riskEntries,
        ...arEntries,
        ...vendorEntries,
        ...oblEntries,
        { name: 'audit-events.csv',     data: auditCsv },
        ...entries,
      ]);

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="audit-pack-${req.tenant.slug}-${today}.zip"`,
      );
      res.send(zip);
    } catch (err) {
      console.error('GET /evidence/pack failed:', err);
      res.status(err.status || 500).json({ error: err.message });
    }
  }
);

// ─── POST /api/evidence — register an item ────────────────────────────────────

router.post('/', requireRole([...WRITE_ROLES]), async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const body = req.body || {};
    const meta = parseMetadata(res, body, { partial: false });
    if (!meta) return;

    // Optional externally computed fingerprint (they hashed it themselves).
    if (body.checksum !== undefined && body.checksum !== null && body.checksum !== '') {
      if (!SHA256.test(String(body.checksum))) return bad(res, 'checksum must be a SHA-256 hex digest');
      meta.checksum = String(body.checksum).toLowerCase();
    }

    const evidenceId = await db.allocateEvidenceId(tenantId);
    const item = await db.createEvidenceItem({
      tenant_id:   tenantId,
      evidence_id: evidenceId,
      ...meta,
      owner_email: meta.owner_email || req.user.email,
      created_by:  req.user.email,
    });
    await db.logEvidenceEvent({
      tenantId, evidenceId,
      event:      'Evidence registered',
      actorEmail: req.user.email,
      metadata:   { strength: strengthOf(item) },
    });
    res.status(201).json(withStrength(item));
  } catch (err) {
    console.error('POST /evidence failed:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── GET /api/evidence/:id — detail + events ──────────────────────────────────

router.get('/:id', async (req, res) => {
  try {
    const item = await loadItem(req, res);
    if (!item) return;
    const [events, linkedRisks, linkedObligations] = await Promise.all([
      db.getEvidenceEvents(req.tenant.id, item.evidence_id),
      db.getRisksLinkedToEvidence(req.tenant.id, item.evidence_id),
      db.getObligationsLinkedTo(req.tenant.id, 'evidence', item.evidence_id),
    ]);
    res.json({ ...withStrength(item), events, linked_risks: linkedRisks, linked_obligations: linkedObligations });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── PUT /api/evidence/:id — edit metadata ────────────────────────────────────

router.put('/:id', requireRole([...WRITE_ROLES]), async (req, res) => {
  try {
    const item = await loadItem(req, res);
    if (!item) return;
    if (!canMutate(req.user, item)) {
      return res.status(403).json({ error: 'You can only edit evidence items you own' });
    }
    const meta = parseMetadata(res, req.body || {}, { partial: true });
    if (!meta) return;
    if (!Object.keys(meta).length) return bad(res, 'No editable fields provided');

    const updated = await db.updateEvidenceItem(req.tenant.id, item.evidence_id, meta);
    await db.logEvidenceEvent({
      tenantId: req.tenant.id, evidenceId: item.evidence_id,
      event:      `Details updated: ${Object.keys(meta).join(', ')}`,
      actorEmail: req.user.email,
    });
    res.json(withStrength(updated));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── POST /api/evidence/:id/file — attach the artifact (held) ─────────────────
//
// Raw binary body, ?filename= carries the original name. Stored on the
// tenant's share under evidence/EVD-YYYY-NNN/; the SHA-256 is computed
// server-side from the exact bytes received.

router.post('/:id/file',
  requireRole([...WRITE_ROLES]),
  express.raw({ type: () => true, limit: '30mb' }),
  async (req, res) => {
    try {
      const item = await loadItem(req, res);
      if (!item) return;
      if (!canMutate(req.user, item)) {
        return res.status(403).json({ error: 'You can only edit evidence items you own' });
      }
      const original = String(req.query.filename || '');
      const ext = (original.match(/\.[a-z0-9]+$/i)?.[0] || '').toLowerCase();
      if (!EVIDENCE_TYPES[ext]) {
        return bad(res, `filename query param must end in one of: ${Object.keys(EVIDENCE_TYPES).join(', ')}`);
      }
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return bad(res, 'Request body must contain the file bytes');
      }

      // evidence/<EVD-id>/ on the tenant share — created idempotently.
      const shareId = req.tenant.lf_share_name;
      let folderId = item.lf_folder_id;
      if (!folderId) {
        const shareRoot = await getRootFolderId(shareId);
        const evidenceRoot = await createFolder(shareId, 'evidence', shareRoot);
        const itemFolder = await createFolder(shareId, item.evidence_id, evidenceRoot.id);
        folderId = itemFolder.id;
      }

      const checksum = sha256(req.body);
      const file = await uploadFileToFolder(shareId, folderId, original, req.body, EVIDENCE_TYPES[ext]);

      const updated = await db.updateEvidenceItem(req.tenant.id, item.evidence_id, {
        lf_file_id:   file.id,
        lf_folder_id: folderId,
        file_name:    original,
        file_size:    req.body.length,
        checksum,
      });
      await db.logEvidenceEvent({
        tenantId: req.tenant.id, evidenceId: item.evidence_id,
        event:      `File attached: ${original}`,
        actorEmail: req.user.email,
        metadata:   { sha256: checksum, size: req.body.length, lf_file_id: file.id, replaced: item.lf_file_id || undefined },
      });
      res.status(201).json(withStrength(updated));
    } catch (err) {
      console.error('POST /evidence/:id/file failed:', err);
      res.status(err.status || 500).json({ error: err.message });
    }
  }
);

// ─── POST /api/evidence/:id/fingerprint — hash-and-discard ────────────────────
//
// "Proof not payload": the bytes are hashed and immediately discarded — nothing
// is stored on the share. Registers a verifiable fingerprint for an artifact
// that lives elsewhere. Rejected for held items (the file already pins them).

router.post('/:id/fingerprint',
  requireRole([...WRITE_ROLES]),
  express.raw({ type: () => true, limit: '100mb' }),
  async (req, res) => {
    try {
      const item = await loadItem(req, res);
      if (!item) return;
      if (!canMutate(req.user, item)) {
        return res.status(403).json({ error: 'You can only edit evidence items you own' });
      }
      if (item.lf_file_id) {
        return bad(res, 'This item already holds its file — the stored checksum pins it.');
      }
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return bad(res, 'Request body must contain the file bytes');
      }

      const checksum = sha256(req.body);
      const size     = req.body.length;
      req.body = null; // discard — the bytes are never stored

      const updated = await db.updateEvidenceItem(req.tenant.id, item.evidence_id, {
        checksum,
        file_name: String(req.query.filename || '') || item.file_name,
        file_size: size,
      });
      await db.logEvidenceEvent({
        tenantId: req.tenant.id, evidenceId: item.evidence_id,
        event:      'Fingerprint captured (bytes not stored)',
        actorEmail: req.user.email,
        metadata:   { sha256: checksum, size, previous: item.checksum || undefined },
      });
      res.json(withStrength(updated));
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  }
);

// ─── POST /api/evidence/:id/verify — re-verify a produced copy ────────────────
//
// Two forms, one receipt either way:
//   raw bytes                → we hash them server-side and compare
//   JSON { digest: "<hex>" } → compare an externally computed SHA-256 (e.g.
//                              HASHBYTES('SHA2_256', ...) run inside a
//                              database — the artifact never leaves its home)
// A mismatch usually means the source now holds a NEWER artifact — register
// it as a new item.

router.post('/:id/verify',
  requireRole([...WRITE_ROLES]),
  express.raw({ type: () => true, limit: '100mb' }),
  async (req, res) => {
    try {
      const item = await loadItem(req, res);
      if (!item) return;
      if (!item.checksum) {
        return bad(res, 'This item has no recorded checksum to verify against — attach a file or capture a fingerprint first.');
      }

      let actual, method;
      if (String(req.headers['content-type'] || '').includes('application/json')) {
        // The app-level express.json() has usually parsed this already; fall
        // back to parsing the raw buffer when it hasn't.
        let digest;
        try {
          const body = Buffer.isBuffer(req.body)
            ? JSON.parse(req.body.toString('utf8'))
            : req.body;
          digest = body?.digest;
        } catch {
          return bad(res, 'JSON body must be { "digest": "<sha-256 hex>" }');
        }
        if (!SHA256.test(String(digest || ''))) {
          return bad(res, 'digest must be a SHA-256 hex digest (64 hex characters)');
        }
        actual = String(digest).toLowerCase();
        method = 'digest';
      } else {
        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
          return bad(res, 'Request body must contain the file bytes');
        }
        actual = sha256(req.body);
        method = 'bytes';
      }
      req.body = null;
      const match = actual === item.checksum;

      await db.logEvidenceEvent({
        tenantId: req.tenant.id, evidenceId: item.evidence_id,
        event:      match ? 'Verified — matches recorded fingerprint' : 'Verification FAILED — digest differs from recorded fingerprint',
        actorEmail: req.user.email,
        metadata:   { expected: item.checksum, actual, method },
      });
      res.json({ match, expected: item.checksum, actual });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  }
);

// ─── POST /api/evidence/:id/retire ────────────────────────────────────────────

router.post('/:id/retire', requireRole([...WRITE_ROLES]), async (req, res) => {
  try {
    const item = await loadItem(req, res);
    if (!item) return;
    if (!canMutate(req.user, item)) {
      return res.status(403).json({ error: 'You can only retire evidence items you own' });
    }
    if (item.status === 'RETIRED') return bad(res, 'Item is already retired');

    const { supersededBy } = req.body || {};
    if (supersededBy) {
      const successor = await db.getEvidenceById(req.tenant.id, String(supersededBy));
      if (!successor) return bad(res, `supersededBy item '${supersededBy}' not found`);
    }

    const updated = await db.updateEvidenceItem(req.tenant.id, item.evidence_id, {
      status: 'RETIRED',
      superseded_by: supersededBy ? String(supersededBy) : null,
    });
    await db.logEvidenceEvent({
      tenantId: req.tenant.id, evidenceId: item.evidence_id,
      event:      supersededBy ? `Retired — superseded by ${supersededBy}` : 'Retired',
      actorEmail: req.user.email,
    });
    res.json(withStrength(updated));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
