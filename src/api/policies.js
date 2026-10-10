/**
 * howldr ProofWorks
 * Policy API routes
 * v4 — per-route role gates + per-policy access checks
 *
 * Every route sits behind requireTenant + requireUser + requireSameTenant
 * (mounted in src/api/index.js). The per-route middlewares below enforce
 * who within that tenant can do what.
 *
 *   POST   /api/policies                       admin only
 *   GET    /api/policies                       role-filtered list (staff see
 *                                              ACTIVE only)
 *   GET    /api/policies/:id                   read access (tenant-wide roles
 *                                              or per-policy owner/authoriser;
 *                                              staff when ACTIVE, trimmed of
 *                                              workflow internals)
 *   PUT    /api/policies/:id                   edit metadata (policy owner or admin)
 *   GET    /api/policies/:id/changelog         read access
 *   GET    /api/policies/:id/comments          read access
 *   POST   /api/policies/:id/comments          read access (any participant)
 *   GET    /api/policies/:id/reads             read access
 *   POST   /api/policies/:id/read              read access (records a view)
 *   GET    /api/policies/:id/documents         read access (version inventory;
 *                                              staff: current area only)
 *   GET    /api/policies/:id/documents/download read access (staff: current only)
 *   POST   /api/policies/:id/submit            policy owner (or admin)
 *   POST   /api/policies/:id/approve           policy authoriser (or admin)
 *   POST   /api/policies/:id/return            policy authoriser (or admin)
 *   POST   /api/policies/:id/distribute        policy owner (or admin)
 *   POST   /api/policies/:id/receipts/poll     policy owner (or admin)
 *   POST   /api/policies/:id/retire            admin only
 *   POST   /api/policies/:id/review            policy owner (or admin)
 *   GET    /api/policies/:id/acknowledgements  read access
 *
 * Actor identity (changelog actorEmail, approve/return authoriser) is
 * taken from req.user.email — never from request body — so an
 * authenticated user can't claim to be someone else.
 */

const crypto  = require('crypto');
const express = require('express');
const router  = express.Router();

const {
  STATUS,
  incrementMinor,
  promoteToMajor,
  calculateNextReviewDate,
} = require('../register/register');

const db = require('../db/db');
const {
  createPolicyFolders, uploadFileToFolder, listFiles, downloadFile,
  deleteFile, copyNewestFile,
} = require('../liquidfiles/folders');
const messages = require('../liquidfiles/messages');
const { pollPolicyReceipts } = require('../notifications/receipts');
const { requireRole } = require('../middleware/auth');
const {
  requirePolicyOwner,
  requirePolicyAuthoriser,
  requirePolicyExec,
  requirePolicyReadAccess,
} = require('../middleware/policy-access');

/** Whether a policy needs executive sign-off — its category is in the tenant's
 *  configured exec_required_categories list. */
function execRequired(policy, tenant) {
  const cats = tenant?.exec_required_categories || [];
  return Boolean(policy.category && cats.includes(policy.category));
}

/** Whether the tenant requires an explicit owner acceptance after authorisation
 *  (a per-tenant toggle; default off keeps the accept-by-distribute behaviour). */
function ownerAcceptanceRequired(tenant) {
  return Boolean(tenant?.owner_acceptance_required);
}

function requireFields(body, fields) {
  const missing = fields.filter(f => !body[f]);
  if (missing.length) {
    const err = new Error(`Missing required fields: ${missing.join(', ')}`);
    err.status = 400; // client error, not a server fault
    throw err;
  }
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Run a notification send without letting a failure break the lifecycle
 *  action that triggered it. Returns the result or null. */
async function tryNotify(label, fn) {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[notify] ${label} failed: ${err.message}`);
    return null;
  }
}

/** Newest non-deleted file in the policy's /drafts/ folder, with its bytes —
 *  attached to authorisation requests. Null when storage isn't wired or the
 *  folder is empty. */
async function latestDraftDocument(shareId, policy) {
  const draftsId = policy.lf_folder_ids?.drafts;
  if (!draftsId) return null;
  const files = (await listFiles(shareId, draftsId)).filter(f => !f.deleted);
  if (!files.length) return null;
  files.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const newest = files[0];
  const { buffer, contentType } = await downloadFile(shareId, draftsId, newest.id);
  return { buffer, name: newest.name, contentType: newest.content_type || contentType };
}

/**
 * Normalise + validate an authorisation route from a request body. Accepts
 * either the structured `authorisationRoute` (ordered array of
 * `{ threshold, members }`) or the legacy flat `authorisers` (a list of emails,
 * treated as one all-must-approve stage). Returns a normalised
 * `[{ threshold, members }]` (threshold null = all, integer = quorum), or
 * undefined when neither field is present. Throws a 400 on malformed input.
 */
function parseAuthorisationRoute(body) {
  const bad = (msg) => { const e = new Error(msg); e.status = 400; throw e; };
  const cleanEmails = (arr, where) => {
    if (!Array.isArray(arr)) bad(`${where} must be an array of emails`);
    const emails = Array.from(new Set(arr.map(a => String(a).trim().toLowerCase()).filter(Boolean)));
    if (!emails.length) bad(`${where} must contain at least one email`);
    if (!emails.every(e => EMAIL.test(e))) bad(`${where} must all be valid emails`);
    return emails;
  };

  if (Array.isArray(body.authorisationRoute)) {
    if (!body.authorisationRoute.length) bad('authorisationRoute must contain at least one stage');
    return body.authorisationRoute.map((stage, i) => {
      const where = `stage ${i + 1}`;
      const members = cleanEmails(stage && stage.members, `${where} members`);
      let threshold = stage.threshold;
      if (threshold === undefined || threshold === null || threshold === 'all') {
        threshold = null;
      } else {
        threshold = Number(threshold);
        if (!Number.isInteger(threshold) || threshold < 1) bad(`${where} threshold must be "all" or a positive integer`);
        if (threshold > members.length) bad(`${where} threshold cannot exceed its ${members.length} member(s)`);
      }
      return { threshold, members };
    });
  }

  if (body.authorisers !== undefined) {
    return [{ threshold: null, members: cleanEmails(body.authorisers, 'authorisers') }];
  }

  return undefined;
}

/** SHA-256 hex of a buffer, or null. Pins an approval to the exact draft bytes. */
function sha256(buffer) {
  return buffer ? crypto.createHash('sha256').update(buffer).digest('hex') : null;
}

/**
 * Send authorisation requests to a stage's members with the newest draft
 * attached. Failures are reported, never thrown — the lifecycle transition that
 * triggered them has already committed. Returns { notified, failed }.
 */
async function requestStageAuthorisation({ shareId, policy, members, expiresAt }) {
  const doc = await tryNotify(`fetch draft for ${policy.policy_id}`, () =>
    latestDraftDocument(shareId, policy));
  const sends = await Promise.allSettled(members.map(email =>
    messages.sendAuthorisationRequest({
      authoriserEmail: email,
      policyId:        policy.policy_id,
      title:           policy.title,
      version:         policy.current_version,
      expiresAt,
      documentBuffer:  doc?.buffer,
      documentName:    doc?.name,
      documentType:    doc?.contentType,
    })
  ));
  const notified = [], failed = [];
  sends.forEach((s, i) => {
    if (s.status === 'fulfilled') notified.push(members[i]);
    else {
      failed.push(members[i]);
      console.warn(`[notify] authorisation request to ${members[i]} failed: ${s.reason?.message}`);
    }
  });
  return { notified, failed };
}

/** Finalise authorisation: promote the draft to a major version, mark it
 *  distributable (PENDING_ACCEPTANCE), record the transition, and notify the
 *  owner. Shared by the no-exec path (last authoriser) and the exec sign-off. */
async function finaliseAuthorisation({ tenantId, policy, actorEmail, fromStatus }) {
  const newVersion = promoteToMajor(policy.current_version);
  const reviewDate = calculateNextReviewDate(new Date(), policy.review_frequency_months);
  const updated = await db.updatePolicy(tenantId, policy.policy_id, {
    status:           STATUS.PENDING_ACCEPTANCE,
    current_version:  newVersion,
    authorised_date:  new Date().toISOString().split('T')[0],
    next_review_date: reviewDate,
  });
  await db.logChange({
    tenantId, policyId: policy.policy_id,
    event:       'Policy approved — advancing to distribution',
    fromStatus,
    toStatus:    STATUS.PENDING_ACCEPTANCE,
    fromVersion: policy.current_version,
    toVersion:   newVersion,
    actorEmail,
  });
  await tryNotify(`authorisation confirmation for ${policy.policy_id}`, () =>
    messages.sendAuthorisationConfirmation({
      ownerEmail: policy.owner_email,
      policyId:   policy.policy_id,
      title:      policy.title,
      version:    newVersion,
    }));
  return updated;
}

/**
 * Advance a policy past authorisation into the exec gate or straight to
 * distribution. Reached once the owner-acceptance gate (if any) is cleared —
 * either directly from the last authoriser approval (owner-acceptance off) or
 * from the owner's accept action. `doc` is the draft under review, attached to
 * the exec request; fetched here best-effort when a caller doesn't pass it.
 * Returns { policy, message }.
 */
async function advancePastAuthorisation({ req, policy, actorEmail, fromStatus, doc }) {
  const tenantId = req.tenant.id;
  if (execRequired(policy, req.tenant)) {
    const updated = await db.updatePolicy(tenantId, policy.policy_id, { status: STATUS.EXEC_REVIEW });
    await db.logChange({
      tenantId, policyId: policy.policy_id,
      event:      `Awaiting executive sign-off from ${policy.exec_email}`,
      fromStatus,
      toStatus:   STATUS.EXEC_REVIEW,
      actorEmail,
    });
    const attachment = doc ?? await tryNotify(`fetch draft for ${policy.policy_id}`, () =>
      latestDraftDocument(req.tenant.lf_share_name, policy));
    await tryNotify(`exec authorisation request for ${policy.policy_id}`, () =>
      messages.sendExecAuthorisationRequest({
        execEmail:      policy.exec_email,
        policyId:       policy.policy_id,
        title:          policy.title,
        version:        policy.current_version,
        documentBuffer: attachment?.buffer,
        documentName:   attachment?.name,
        documentType:   attachment?.contentType,
      }));
    return { policy: updated, message: 'Awaiting executive sign-off.' };
  }
  const updated = await finaliseAuthorisation({ tenantId, policy, actorEmail, fromStatus });
  return { policy: updated, message: 'Policy advancing to distribution.' };
}

// ─── POST /api/policies (admin only) ─────────────────────────────────────────

router.post('/', requireRole(['admin', 'howldr_support']), async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const { title, category, owner, applicableRoles, reviewFrequencyMonths, exec } = req.body;
    requireFields(req.body, ['title', 'category', 'owner']);
    const route = parseAuthorisationRoute(req.body);
    if (exec !== undefined && exec !== null && exec !== '' && !EMAIL.test(String(exec).trim())) {
      return res.status(400).json({ error: 'exec must be a valid email' });
    }

    const policyId = await db.allocatePolicyId(tenantId);

    // Stage 1 (Initiation): create the policy's LiquidFiles folder tree in
    // the tenant's share. Resilient — if the appliance is unreachable the
    // register entry still saves and storage is reported as 'pending'
    // (the document upload route self-heals the folders later).
    let lfFolderIds = { root: null, current: null, training: null, drafts: null, archive: null, acks: null };
    let storage = 'pending';
    try {
      lfFolderIds = await createPolicyFolders(req.tenant.lf_share_name, policyId);
      storage = 'ready';
    } catch (lfErr) {
      console.warn(`[policies] LiquidFiles folders failed for ${policyId}: ${lfErr.message}`);
    }

    const policy = await db.createPolicy({
      tenant_id:               tenantId,
      policy_id:               policyId,
      title,
      category,
      owner_email:             owner,
      current_version:         'v0.1',
      status:                  STATUS.DRAFT,
      review_frequency_months: reviewFrequencyMonths || 12,
      applicable_roles:        applicableRoles || [],
      exec_email:              exec ? String(exec).trim().toLowerCase() : null,
      lf_folder_ids:           lfFolderIds,
      acknowledgement_total:   0,
    });

    if (route) {
      await db.setAuthorisationRoute(tenantId, policyId, route);
    }

    await db.logChange({
      tenantId, policyId,
      event:      'Policy initiated',
      toStatus:   STATUS.DRAFT,
      toVersion:  'v0.1',
      actorEmail: req.user.email,
    });

    res.status(201).json({ ...policy, storage });
  } catch (err) {
    console.error('POST /policies failed:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── POST /api/policies/:id/document (owner or admin) ────────────────────────
//
// Upload a draft document (raw binary body, ?filename= carries the original
// name). Stored in the policy's /drafts/ folder as POL-YYYY-NNN-vX.Y.{ext} —
// versions are explicit immutable files; the share's revision feature is just
// a safety net underneath (see docs/workflow-stages.md).

const DOCUMENT_TYPES = {
  '.pdf':  'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc':  'application/msword',
};

router.post('/:id/document',
  requirePolicyOwner(),
  express.raw({ type: () => true, limit: '30mb' }),
  async (req, res) => {
    try {
      const tenantId = req.tenant.id;
      const policy   = req.policy;

      const original = String(req.query.filename || '');
      const ext = (original.match(/\.[a-z0-9]+$/i)?.[0] || '').toLowerCase();
      if (!DOCUMENT_TYPES[ext]) {
        return res.status(400).json({
          error: `filename query param must end in one of: ${Object.keys(DOCUMENT_TYPES).join(', ')}`,
        });
      }
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: 'Request body must contain the document bytes' });
      }

      // Self-heal storage if folder creation failed at initiation.
      let folders = policy.lf_folder_ids;
      if (!folders?.drafts) {
        try {
          folders = await createPolicyFolders(req.tenant.lf_share_name, policy.policy_id);
          await db.updatePolicy(tenantId, policy.policy_id, { lf_folder_ids: folders });
        } catch (lfErr) {
          console.warn(`[policies] storage self-heal failed for ${policy.policy_id}: ${lfErr.message}`);
          return res.status(503).json({
            error: 'Document storage is unavailable right now — the policy is registered; try the upload again later.',
          });
        }
      }

      const storedName = `${policy.policy_id}-${policy.current_version}${ext}`;
      const file = await uploadFileToFolder(
        req.tenant.lf_share_name, folders.drafts, storedName, req.body, DOCUMENT_TYPES[ext],
      );

      await db.logChange({
        tenantId, policyId: policy.policy_id,
        event:      `Draft document uploaded: ${storedName} (from ${original})`,
        actorEmail: req.user.email,
        metadata:   { lf_file_id: file.id, size: file.size, checksum: file.checksum },
      });

      res.status(201).json({
        message: 'Document stored.',
        file: { id: file.id, name: file.name, size: file.size, checksum: file.checksum },
      });
    } catch (err) {
      console.error('POST /policies/:id/document failed:', err);
      res.status(err.status || 500).json({ error: err.message });
    }
  });

// ─── GET /api/policies (role-filtered list) ──────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const { status, category, limit, offset } = req.query;
    const tenantId = req.tenant.id;
    const role     = req.user.role;
    const email    = req.user.email;

    const filter = { tenantId, status, category, limit, offset };
    if (role === 'owner')           filter.owner           = email;
    else if (role === 'authoriser') filter.authoriserEmail = email;
    else if (role === 'acceptor')   filter.execEmail       = email;    // policies awaiting their sign-off
    else if (role === 'staff')      filter.status          = 'ACTIVE'; // published register only, whatever ?status says
    // admin / governance_lead / viewer / howldr_support see everything in tenant.

    const policies = await db.listPolicies(filter);
    res.json(policies);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── GET /api/policies/:id (read access) ─────────────────────────────────────

router.get('/:id', requirePolicyReadAccess({ staff: true }), async (req, res) => {
  try {
    // Staff read the published policy, not the governance around it — no
    // authoriser list, route state, exec/owner decisions, or linked risks.
    if (req.user.role === 'staff') return res.json({ ...req.policy });

    const [authorisers, route, execDecision, ownerDecision, linkedRisks, linkedObligations] = await Promise.all([
      db.getAuthorisers(req.tenant.id, req.params.id),
      db.getRouteState(req.tenant.id, req.params.id, req.policy.current_version),
      db.getExecDecision(req.tenant.id, req.params.id, req.policy.current_version),
      db.getOwnerDecision(req.tenant.id, req.params.id, req.policy.current_version),
      db.getRisksLinkedToPolicy(req.tenant.id, req.params.id),
      db.getObligationsLinkedTo(req.tenant.id, 'policy', req.params.id),
    ]);
    const exec = {
      email:     req.policy.exec_email || null,
      required:  execRequired(req.policy, req.tenant),
      decision:  execDecision?.decision ?? null,
      decidedAt: execDecision?.created_at ?? null,
      feedback:  execDecision?.decision === 'returned' ? execDecision.feedback : null,
    };
    const ownerAcceptance = {
      required:  ownerAcceptanceRequired(req.tenant),
      decision:  ownerDecision?.decision ?? null,
      decidedAt: ownerDecision?.created_at ?? null,
      feedback:  ownerDecision?.decision === 'returned' ? ownerDecision.feedback : null,
    };
    res.json({ ...req.policy, authorisers, authorisationRoute: route.stages, exec, ownerAcceptance, linkedRisks, linkedObligations });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── PUT /api/policies/:id (owner or admin) — edit metadata ──────────────────
//
// Edits register metadata only — never lifecycle state, version, or stored
// documents (those move through the lifecycle routes / document upload). Every
// provided field is validated; the change is recorded in the changelog.

router.put('/:id', requirePolicyOwner(), async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const body = req.body || {};
    const { title, category, owner, reviewFrequencyMonths, applicableRoles, exec } = body;

    const updates = {};
    const changed = [];

    if (title !== undefined) {
      if (typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({ error: 'title cannot be empty' });
      }
      updates.title = title.trim();
      changed.push('title');
    }
    if (category !== undefined) {
      updates.category = category == null ? null : String(category);
      changed.push('category');
    }
    if (owner !== undefined) {
      if (typeof owner !== 'string' || !EMAIL.test(owner.trim())) {
        return res.status(400).json({ error: 'owner must be a valid email' });
      }
      updates.owner_email = owner.trim();
      changed.push('owner');
    }
    if (reviewFrequencyMonths !== undefined) {
      if (!Number.isInteger(reviewFrequencyMonths) || reviewFrequencyMonths < 1 || reviewFrequencyMonths > 120) {
        return res.status(400).json({ error: 'reviewFrequencyMonths must be an integer 1–120' });
      }
      updates.review_frequency_months = reviewFrequencyMonths;
      changed.push('review frequency');
    }
    if (applicableRoles !== undefined) {
      if (!Array.isArray(applicableRoles)) {
        return res.status(400).json({ error: 'applicableRoles must be an array' });
      }
      updates.applicable_roles = applicableRoles.map(r => String(r).trim()).filter(Boolean);
      changed.push('applicable roles');
    }
    if (exec !== undefined) {
      // '' / null clears the assignment.
      if (exec !== null && exec !== '' && !EMAIL.test(String(exec).trim())) {
        return res.status(400).json({ error: 'exec must be a valid email' });
      }
      updates.exec_email = exec ? String(exec).trim().toLowerCase() : null;
      changed.push('executive approver');
    }

    // Accepts either the structured `authorisationRoute` or the legacy flat
    // `authorisers` list; both normalise to an ordered route.
    let route;
    if (body.authorisationRoute !== undefined || body.authorisers !== undefined) {
      route = parseAuthorisationRoute(body);
      changed.push('approvers');
    }

    if (!changed.length) {
      return res.status(400).json({ error: 'No editable fields provided' });
    }

    let updated = req.policy;
    if (Object.keys(updates).length) {
      updated = await db.updatePolicy(tenantId, req.params.id, updates);
    }
    if (route !== undefined) {
      await db.setAuthorisationRoute(tenantId, req.params.id, route);
    }

    await db.logChange({
      tenantId, policyId: req.params.id,
      event:      `Policy details updated: ${changed.join(', ')}`,
      actorEmail: req.user.email,
    });

    const current = await db.getAuthorisers(tenantId, req.params.id);
    res.json({ ...updated, authorisers: current });
  } catch (err) {
    console.error('PUT /policies/:id failed:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── GET /api/policies/:id/changelog (read access) ───────────────────────────

router.get('/:id/changelog', requirePolicyReadAccess(), async (req, res) => {
  try {
    const changelog = await db.getChangelog(req.tenant.id, req.params.id);
    res.json(changelog);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── Review activity: comments + reads (read access) ─────────────────────────

router.get('/:id/comments', requirePolicyReadAccess(), async (req, res) => {
  try {
    const comments = await db.getComments(req.tenant.id, req.params.id);
    res.json(comments);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/:id/comments', requirePolicyReadAccess(), async (req, res) => {
  try {
    const { kind, body } = req.body || {};
    requireFields(req.body, ['body']);
    if (typeof body !== 'string' || !body.trim()) {
      return res.status(400).json({ error: 'body cannot be empty' });
    }
    if (kind !== undefined && !['comment', 'question'].includes(kind)) {
      return res.status(400).json({ error: "kind must be 'comment' or 'question'" });
    }
    const comment = await db.addComment(req.tenant.id, req.params.id, {
      version:     req.policy.current_version,
      authorEmail: req.user.email,
      kind:        kind || 'comment',
      body:        body.trim(),
    });
    res.status(201).json(comment);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/:id/reads', requirePolicyReadAccess(), async (req, res) => {
  try {
    const reads = await db.getReads(req.tenant.id, req.params.id, req.query.version);
    res.json(reads);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/:id/read', requirePolicyReadAccess(), async (req, res) => {
  try {
    const read = await db.recordRead(req.tenant.id, req.params.id, {
      version:     req.policy.current_version,
      readerEmail: req.user.email,
    });
    res.json({ version: read.version, readCount: read.read_count });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── GET /api/policies/:id/documents (read access) ───────────────────────────
//
// The stored document versions across the policy's folders, with checksums —
// the evidence inventory. Best-effort per folder: a folder that fails to list
// is skipped rather than failing the whole request.

const DOC_AREAS = ['current', 'drafts', 'archive', 'training'];

router.get('/:id/documents', requirePolicyReadAccess({ staff: true }), async (req, res) => {
  try {
    const share   = req.tenant.lf_share_name;
    const folders = req.policy.lf_folder_ids || {};
    const documents = [];
    // Staff get the published document only — never drafts or the archive.
    const areas = req.user.role === 'staff' ? ['current'] : ['current', 'drafts', 'archive'];
    for (const area of areas) {
      const folderId = folders[area];
      if (!folderId) continue;
      let files;
      try {
        files = await listFiles(share, folderId);
      } catch (lfErr) {
        console.warn(`[policies] list ${area} for ${req.params.id} failed: ${lfErr.message}`);
        continue;
      }
      for (const f of files.filter(x => !x.deleted)) {
        documents.push({
          area,
          id:           f.id,
          name:         f.name,
          size:         f.size,
          checksum:     f.checksum,
          content_type: f.content_type,
          created_at:   f.created_at,
        });
      }
    }
    documents.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json(documents);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── GET /api/policies/:id/documents/download (read access) ──────────────────

router.get('/:id/documents/download', requirePolicyReadAccess({ staff: true }), async (req, res) => {
  try {
    const { area, file, name } = req.query;
    if (!DOC_AREAS.includes(area)) {
      return res.status(400).json({ error: `area must be one of: ${DOC_AREAS.join(', ')}` });
    }
    if (req.user.role === 'staff' && area !== 'current') {
      return res.status(403).json({ error: 'Staff may download the published document only' });
    }
    const folderId = (req.policy.lf_folder_ids || {})[area];
    if (!folderId || !file) {
      return res.status(400).json({ error: 'area (with a configured folder) and file are required' });
    }
    const { buffer, contentType } = await downloadFile(req.tenant.lf_share_name, folderId, String(file));
    const safeName = String(name || file).replace(/[^\w.\- ]/g, '_');
    res.setHeader('Content-Type', contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.send(buffer);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── POST /api/policies/:id/submit (owner only) ──────────────────────────────

router.post('/:id/submit', requirePolicyOwner(), async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const policy   = req.policy;
    requireFields(req.body, ['expiresAt']);
    const { expiresAt } = req.body;

    // Only the first stage of the route is notified now; later stages are
    // requested as each stage clears (sequential between, parallel within).
    const state = await db.getRouteState(tenantId, req.params.id, policy.current_version);
    const firstStage = state.activeStage || state.stages[0];
    if (!firstStage || firstStage.memberCount === 0) {
      return res.status(400).json({ error: 'Assign at least one approver before submitting' });
    }

    // A category that requires executive sign-off must have a named exec, or the
    // policy would stall at the exec gate with no one able to act.
    if (execRequired(policy, req.tenant) && !policy.exec_email) {
      return res.status(400).json({
        error: `Policies in the "${policy.category}" category require an executive authoriser — assign one before submitting.`,
      });
    }

    // Persist the deadline so later stages can be notified with the same one.
    const updated = await db.updatePolicy(tenantId, req.params.id, {
      status: STATUS.UNDER_REVIEW, review_expires_at: expiresAt,
    });
    await db.logChange({
      tenantId, policyId: req.params.id,
      event:      'Submitted for approval',
      fromStatus: policy.status,
      toStatus:   STATUS.UNDER_REVIEW,
      actorEmail: req.user.email,
    });

    // Authorisation requests go out as authenticated secure messages with the
    // latest draft attached. Failures never roll back the submission — they're
    // reported so the owner can chase manually.
    const { notified, failed } = await requestStageAuthorisation({
      shareId: req.tenant.lf_share_name,
      policy,
      members: firstStage.members.map(m => m.email),
      expiresAt,
    });

    if (notified.length) {
      await db.logChange({
        tenantId, policyId: req.params.id,
        event:      `Approval requests sent to ${notified.join(', ')}`,
        actorEmail: req.user.email,
      });
    }

    res.json({
      message: 'Policy submitted for approval.',
      policy: updated,
      notifications: { notified, failed },
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── POST /api/policies/:id/approve (authoriser only) ────────────────────────

router.post('/:id/approve', requirePolicyAuthoriser(), async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const policy   = req.policy;
    const authoriserEmail = req.user.email;

    if (policy.status !== STATUS.UNDER_REVIEW) {
      return res.status(400).json({ error: `Policy is not under review (status: ${policy.status})` });
    }

    // Sequential between stages: an approval only counts for the stage that is
    // currently open. Members of a later stage must wait their turn.
    const before = await db.getRouteState(tenantId, req.params.id, policy.current_version);
    const active = before.activeStage;
    if (!active) {
      return res.status(400).json({ error: 'Nothing to approve — every stage is already satisfied.' });
    }
    if (!active.members.some(m => m.email === authoriserEmail)) {
      return res.status(400).json({ error: 'An earlier approval stage is still open — it is not yet your turn.' });
    }

    // Pin the approval to the exact draft bytes under review (best-effort — a
    // storage hiccup records the version-pinned approval without a hash).
    const doc = await tryNotify(`fetch draft for ${req.params.id}`, () =>
      latestDraftDocument(req.tenant.lf_share_name, policy));
    await db.recordApproval(tenantId, {
      policyId:    req.params.id,
      email:       authoriserEmail,
      version:     policy.current_version,
      contentHash: sha256(doc?.buffer),
    });
    await db.logChange({
      tenantId, policyId: req.params.id,
      event:      `Approved (stage ${active.position}): ${authoriserEmail}`,
      actorEmail: authoriserEmail,
    });

    const after = await db.getRouteState(tenantId, req.params.id, policy.current_version);

    if (after.fullyApproved) {
      if (ownerAcceptanceRequired(req.tenant)) {
        // Optional owner gate: hold for the owner to accept the authorised
        // version before it advances to the exec gate or distribution.
        const updated = await db.updatePolicy(tenantId, req.params.id, { status: STATUS.OWNER_ACCEPTANCE });
        await db.logChange({
          tenantId, policyId: req.params.id,
          event:      'All approvers approved — awaiting owner acceptance',
          fromStatus: STATUS.UNDER_REVIEW,
          toStatus:   STATUS.OWNER_ACCEPTANCE,
          actorEmail: authoriserEmail,
        });
        await tryNotify(`owner acceptance request for ${req.params.id}`, () =>
          messages.sendOwnerAcceptanceRequest({
            ownerEmail: policy.owner_email,
            policyId:   req.params.id,
            title:      policy.title,
            version:    policy.current_version,
          }));
        res.json({ message: 'All approvers approved. Awaiting owner acceptance.', policy: updated });
      } else {
        const { policy: updated, message } = await advancePastAuthorisation({
          req, policy, actorEmail: authoriserEmail, fromStatus: STATUS.UNDER_REVIEW, doc,
        });
        res.json({ message: `All stages approved. ${message}`, policy: updated });
      }
    } else if (after.activeStage && after.activeStage.position > active.position) {
      // This approval cleared the stage — request the next one.
      const { notified } = await requestStageAuthorisation({
        shareId:   req.tenant.lf_share_name,
        policy,
        members:   after.activeStage.members.map(m => m.email),
        expiresAt: policy.review_expires_at,
      });
      await db.logChange({
        tenantId, policyId: req.params.id,
        event:      `Stage ${active.position} approved — requesting stage ${after.activeStage.position}${notified.length ? ` from ${notified.join(', ')}` : ''}`,
        actorEmail: authoriserEmail,
      });
      res.json({ message: `Stage ${active.position} approved. Requesting approval from stage ${after.activeStage.position}.` });
    } else {
      res.json({ message: 'Approval recorded. Waiting for remaining approvers in this stage.' });
    }
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── POST /api/policies/:id/return (authoriser only) ─────────────────────────

router.post('/:id/return', requirePolicyAuthoriser(), async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const policy   = req.policy;
    const authoriserEmail = req.user.email;
    const { feedback } = req.body;
    requireFields(req.body, ['feedback']);

    await db.recordReturn(tenantId, {
      policyId: req.params.id,
      email:    authoriserEmail,
      version:  policy.current_version,
      feedback,
    });
    const newVersion = incrementMinor(policy.current_version);
    const updated = await db.updatePolicy(tenantId, req.params.id, { status: STATUS.DRAFT, current_version: newVersion });
    await db.logChange({
      tenantId, policyId: req.params.id,
      event:       `Policy returned for revision by ${authoriserEmail}`,
      fromStatus:  STATUS.UNDER_REVIEW,
      toStatus:    STATUS.DRAFT,
      fromVersion: policy.current_version,
      toVersion:   newVersion,
      actorEmail:  authoriserEmail,
      metadata:    { feedback },
    });

    await tryNotify(`return notice for ${req.params.id}`, () =>
      messages.sendReturnNotice({
        ownerEmail: policy.owner_email,
        policyId:   req.params.id,
        title:      policy.title,
        authoriserEmail,
        feedback,
      }));

    res.json({ message: 'Policy returned for revision.', policy: updated });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── POST /api/policies/:id/accept (owner only) ──────────────────────────────
// The optional (per-tenant) owner-acceptance gate: the owner explicitly accepts
// the authorised version, recording a version-pinned, append-only receipt, and
// the policy advances to the exec gate or straight to distribution.

router.post('/:id/accept', requirePolicyOwner(), async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const policy   = req.policy;
    const actor    = req.user.email;

    if (policy.status !== STATUS.OWNER_ACCEPTANCE) {
      return res.status(400).json({ error: `Policy is not awaiting owner acceptance (status: ${policy.status})` });
    }

    const doc = await tryNotify(`fetch draft for ${req.params.id}`, () =>
      latestDraftDocument(req.tenant.lf_share_name, policy));
    await db.recordOwnerDecision(tenantId, {
      policyId:    req.params.id,
      email:       actor,
      version:     policy.current_version,
      decision:    'approved',
      contentHash: sha256(doc?.buffer),
    });
    await db.logChange({
      tenantId, policyId: req.params.id,
      event:      `Owner accepted the approved version: ${actor}`,
      actorEmail: actor,
    });

    const { policy: updated, message } = await advancePastAuthorisation({
      req, policy, actorEmail: actor, fromStatus: STATUS.OWNER_ACCEPTANCE, doc,
    });
    res.json({ message: `Acceptance recorded. ${message}`, policy: updated });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── POST /api/policies/:id/accept-return (owner only) ───────────────────────

router.post('/:id/accept-return', requirePolicyOwner(), async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const policy   = req.policy;
    const actor    = req.user.email;
    const { feedback } = req.body;
    requireFields(req.body, ['feedback']);

    if (policy.status !== STATUS.OWNER_ACCEPTANCE) {
      return res.status(400).json({ error: `Policy is not awaiting owner acceptance (status: ${policy.status})` });
    }

    await db.recordOwnerDecision(tenantId, {
      policyId: req.params.id,
      email:    actor,
      version:  policy.current_version,
      decision: 'returned',
      feedback,
    });
    const newVersion = incrementMinor(policy.current_version);
    const updated = await db.updatePolicy(tenantId, req.params.id, { status: STATUS.DRAFT, current_version: newVersion });
    await db.logChange({
      tenantId, policyId: req.params.id,
      event:       `Owner returned the approved version for revision: ${actor}`,
      fromStatus:  STATUS.OWNER_ACCEPTANCE,
      toStatus:    STATUS.DRAFT,
      fromVersion: policy.current_version,
      toVersion:   newVersion,
      actorEmail:  actor,
      metadata:    { feedback },
    });

    res.json({ message: 'Policy returned for revision.', policy: updated });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── POST /api/policies/:id/exec-authorise (assigned exec only) ──────────────
// The category-triggered final tier: the named executive signs off a policy
// sitting in EXEC_REVIEW, promoting it to distribution. The decision is a
// version-pinned, append-only receipt like an authoriser's.

router.post('/:id/exec-authorise', requirePolicyExec(), async (req, res) => {
  try {
    const tenantId  = req.tenant.id;
    const policy    = req.policy;
    const execEmail = req.user.email;

    if (policy.status !== STATUS.EXEC_REVIEW) {
      return res.status(400).json({ error: `Policy is not awaiting executive sign-off (status: ${policy.status})` });
    }

    const doc = await tryNotify(`fetch draft for ${req.params.id}`, () =>
      latestDraftDocument(req.tenant.lf_share_name, policy));
    await db.recordExecDecision(tenantId, {
      policyId:    req.params.id,
      email:       execEmail,
      version:     policy.current_version,
      decision:    'approved',
      contentHash: sha256(doc?.buffer),
    });
    await db.logChange({
      tenantId, policyId: req.params.id,
      event:      `Executive approved: ${execEmail}`,
      actorEmail: execEmail,
    });

    const updated = await finaliseAuthorisation({
      tenantId, policy, actorEmail: execEmail, fromStatus: STATUS.EXEC_REVIEW,
    });
    res.json({ message: 'Executive sign-off recorded. Policy advancing to distribution.', policy: updated });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── POST /api/policies/:id/exec-return (assigned exec only) ─────────────────

router.post('/:id/exec-return', requirePolicyExec(), async (req, res) => {
  try {
    const tenantId  = req.tenant.id;
    const policy    = req.policy;
    const execEmail = req.user.email;
    const { feedback } = req.body;
    requireFields(req.body, ['feedback']);

    if (policy.status !== STATUS.EXEC_REVIEW) {
      return res.status(400).json({ error: `Policy is not awaiting executive sign-off (status: ${policy.status})` });
    }

    await db.recordExecDecision(tenantId, {
      policyId: req.params.id,
      email:    execEmail,
      version:  policy.current_version,
      decision: 'returned',
      feedback,
    });
    const newVersion = incrementMinor(policy.current_version);
    const updated = await db.updatePolicy(tenantId, req.params.id, { status: STATUS.DRAFT, current_version: newVersion });
    await db.logChange({
      tenantId, policyId: req.params.id,
      event:       `Policy returned for revision by executive ${execEmail}`,
      fromStatus:  STATUS.EXEC_REVIEW,
      toStatus:    STATUS.DRAFT,
      fromVersion: policy.current_version,
      toVersion:   newVersion,
      actorEmail:  execEmail,
      metadata:    { feedback },
    });

    await tryNotify(`return notice for ${req.params.id}`, () =>
      messages.sendReturnNotice({
        ownerEmail:      policy.owner_email,
        policyId:        req.params.id,
        title:           policy.title,
        authoriserEmail: execEmail,
        feedback,
      }));

    res.json({ message: 'Policy returned for revision.', policy: updated });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── POST /api/policies/:id/distribute (owner only) ──────────────────────────
//
// Stage 4: publish the authorised document to /current/ under the promoted
// version name, then send each recipient an authenticated Secure Message
// with the document attached. The recipient's authenticated download is the
// acknowledgement receipt (polled — this appliance has no webhooks), so a
// stored document is required and storage failures abort before any sends.

router.post('/:id/distribute', requirePolicyOwner(), async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const policy   = req.policy;
    if (policy.status !== STATUS.PENDING_ACCEPTANCE) {
      return res.status(400).json({ error: 'Policy must be PENDING_ACCEPTANCE to distribute' });
    }

    // Recipients come as explicit {email, manager_email?} entries and/or as
    // distribution group ids expanded server-side — so the acknowledgement
    // rows record exactly who each group contained at send time.
    const { recipients: explicit = [], groupIds = [], expiresAt } = req.body;
    requireFields(req.body, ['expiresAt']);
    if (!Array.isArray(explicit) || !Array.isArray(groupIds)) {
      return res.status(400).json({ error: 'recipients and groupIds must be arrays' });
    }
    if (explicit.some(r => !r || !r.email)) {
      return res.status(400).json({ error: 'Every recipient needs an email' });
    }

    const groupNames = [];
    const byEmail = new Map(); // email → {email, manager_email} — first entry wins
    for (const r of explicit) {
      const email = String(r.email).trim().toLowerCase();
      if (!byEmail.has(email)) byEmail.set(email, { email, manager_email: r.manager_email || null });
    }
    let appUsers = null; // staff directory, fetched once if any group targets roles
    for (const gid of groupIds) {
      const group = /^\d+$/.test(String(gid))
        ? await db.getGroupWithMembers(tenantId, gid)
        : null;
      if (!group) return res.status(400).json({ error: `Unknown distribution group: ${gid}` });
      groupNames.push(group.name);
      // A group = explicit members ∪ everyone holding one of its roles (from
      // the staff directory, resolved NOW so the acknowledgement rows snapshot
      // send-time membership) − its excluded addresses. Exclusions are per
      // group: they never strip explicitly pasted recipients.
      const excluded = new Set((group.excluded_emails || []).map(e => e.toLowerCase()));
      for (const m of group.members) {
        if (excluded.has(m.email)) continue;
        if (!byEmail.has(m.email)) byEmail.set(m.email, { email: m.email, manager_email: m.manager_email || null });
      }
      if (Array.isArray(group.roles) && group.roles.length > 0) {
        appUsers ??= await db.listAppUsersByTenant(tenantId);
        for (const u of appUsers) {
          if (!group.roles.includes(u.role)) continue;
          const email = u.email.toLowerCase();
          if (excluded.has(email)) continue;
          if (!byEmail.has(email)) byEmail.set(email, { email, manager_email: null });
        }
      }
    }
    const recipients = Array.from(byEmail.values());
    if (recipients.length === 0) {
      return res.status(400).json({ error: 'No recipients — add emails or pick a non-empty group' });
    }

    let doc;
    try {
      doc = await latestDraftDocument(req.tenant.lf_share_name, policy);
    } catch (lfErr) {
      console.warn(`[policies] distribute: storage unreachable for ${req.params.id}: ${lfErr.message}`);
      return res.status(503).json({
        error: 'Document storage is unavailable right now — nothing was sent; try again later.',
      });
    }
    if (!doc) {
      return res.status(400).json({
        error: 'Upload the policy document before distributing — the recipient download is the acknowledgement record.',
      });
    }

    // Publish to /current/ under the authorised version's name. Idempotent
    // on re-distribution (same name re-uploads a new revision underneath).
    const ext = (doc.name.match(/\.[a-z0-9]+$/i)?.[0] || '.pdf').toLowerCase();
    const publishedName = `${policy.policy_id}-${policy.current_version}${ext}`;
    let published;
    try {
      published = await uploadFileToFolder(
        req.tenant.lf_share_name, policy.lf_folder_ids.current, publishedName, doc.buffer, doc.contentType,
      );
    } catch (lfErr) {
      console.warn(`[policies] distribute: publish to /current/ failed for ${req.params.id}: ${lfErr.message}`);
      return res.status(503).json({
        error: 'Publishing the document failed — nothing was sent; try again later.',
      });
    }
    await db.logChange({
      tenantId, policyId: req.params.id,
      event:      `Published ${publishedName} to current`,
      actorEmail: req.user.email,
      metadata:   { lf_file_id: published.id, checksum: published.checksum },
    });

    // Archive-on-publish: /current/ should only ever hold the live version,
    // so sweep superseded files into /archive/. Best-effort per file — the
    // publish already succeeded, and a stuck original is warned, not fatal.
    const archiveFolderId = policy.lf_folder_ids?.archive;
    if (archiveFolderId) {
      try {
        const superseded = (await listFiles(req.tenant.lf_share_name, policy.lf_folder_ids.current))
          .filter(f => !f.deleted && f.id !== published.id && f.name !== publishedName);
        const archived = [];
        for (const f of superseded) {
          try {
            const { buffer, contentType } = await downloadFile(req.tenant.lf_share_name, policy.lf_folder_ids.current, f.id);
            await uploadFileToFolder(req.tenant.lf_share_name, archiveFolderId, f.name, buffer, f.content_type || contentType || undefined);
            archived.push(f.name);
            try {
              await deleteFile(req.tenant.lf_share_name, policy.lf_folder_ids.current, f.id);
            } catch (delErr) {
              console.warn(`[policies] archived ${f.name} but could not remove it from /current/: ${delErr.message}`);
            }
          } catch (arcErr) {
            console.warn(`[policies] archiving ${f.name} failed for ${req.params.id}: ${arcErr.message}`);
          }
        }
        if (archived.length) {
          await db.logChange({
            tenantId, policyId: req.params.id,
            event:      `Archived superseded document(s): ${archived.join(', ')}`,
            actorEmail: req.user.email,
          });
        }
      } catch (arcErr) {
        console.warn(`[policies] archive sweep failed for ${req.params.id}: ${arcErr.message}`);
      }
    }

    // Attestation tokens: reuse a recipient's existing token on
    // re-distribution (the db upsert keeps the first token, so the link in
    // the message must match it); mint a fresh one for new recipients.
    const existingAcks = await db.getAcknowledgements(tenantId, req.params.id, policy.current_version);
    const tokenByEmail = new Map(
      existingAcks.filter(a => a.accept_token).map(a => [a.recipient_email, a.accept_token]),
    );
    const withTokens = recipients.map(r => ({
      ...r,
      accept_token: tokenByEmail.get(r.email) || crypto.randomBytes(24).toString('base64url'),
    }));

    const sends = await Promise.allSettled(withTokens.map(r =>
      messages.sendAcceptanceRequest({
        recipientEmail: r.email,
        policyId:       req.params.id,
        title:          policy.title,
        version:        policy.current_version,
        expiresAt,
        documentBuffer: doc.buffer,
        documentName:   publishedName,
        documentType:   doc.contentType,
        acceptUrl:      messages.attestationUrl(r.accept_token),
      })
    ));

    const notified = [];
    const notifyFailed = [];
    const ackRecords = withTokens.map((r, i) => {
      const send = sends[i];
      if (send.status === 'fulfilled') notified.push(r.email);
      else {
        notifyFailed.push(r.email);
        console.warn(`[notify] acceptance request to ${r.email} failed: ${send.reason?.message}`);
      }
      return {
        email:         r.email,
        manager_email: r.manager_email || null,
        lf_message_id: send.status === 'fulfilled' ? send.value.id : null,
        expires_at:    expiresAt,
        // Pin the exact published bytes to the receipt: the acknowledgement
        // proves this file (id + checksum), not just a version label.
        lf_file_id:        published.id ?? null,
        document_checksum: published.checksum ?? null,
        accept_token:      r.accept_token,
      };
    });

    await db.createAcknowledgements(tenantId, req.params.id, policy.current_version, ackRecords);

    // Totals come from the rows, not the request — a re-distribution that
    // adds recipients must keep earlier acknowledgements counted.
    const ackRows = await db.getAcknowledgements(tenantId, req.params.id, policy.current_version);
    await db.updatePolicy(tenantId, req.params.id, {
      acknowledgement_total: ackRows.length,
      acknowledgement_count: ackRows.filter(a => a.acknowledged_at).length,
    });

    for (const rec of ackRecords) {
      if (!rec.lf_message_id) continue;
      await tryNotify(`record acceptance notification for ${rec.email}`, () =>
        db.recordNotification({
          tenantId, policyId: req.params.id,
          eventType:      'acceptance',
          recipientEmail: rec.email,
          lfMessageId:    rec.lf_message_id,
          version:        policy.current_version,
        }));
    }

    await db.logChange({
      tenantId, policyId: req.params.id,
      event:      `Policy distributed to ${recipients.length} recipient(s)` +
                  (groupNames.length ? ` (groups: ${groupNames.join(', ')})` : '') +
                  (notifyFailed.length ? ` — sending failed for ${notifyFailed.join(', ')}` : ''),
      actorEmail: req.user.email,
    });

    res.json({
      message: `Policy distributed to ${notified.length} of ${recipients.length} recipients.`,
      notifications: { notified, failed: notifyFailed },
    });
  } catch (err) {
    console.error('POST /policies/:id/distribute failed:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── POST /api/policies/:id/receipts/poll (owner or admin) ───────────────────
//
// On-demand receipt check: pulls the download log for each outstanding
// acceptance message and records acknowledgements (the scheduler also does
// this every 15 minutes). Returns what changed so the UI can refresh.

router.post('/:id/receipts/poll', requirePolicyOwner(), async (req, res) => {
  try {
    const result = await pollPolicyReceipts(req.tenant.id, req.params.id);
    res.json(result);
  } catch (err) {
    console.error('POST /policies/:id/receipts/poll failed:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── POST /api/policies/:id/retire (admin only) ──────────────────────────────

router.post('/:id/retire', requireRole(['admin', 'howldr_support']), async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const policy = await db.getPolicyById(tenantId, req.params.id);
    if (!policy) return res.status(404).json({ error: 'Policy not found' });
    const updated = await db.updatePolicy(tenantId, req.params.id, { status: STATUS.RETIRED });
    await db.logChange({
      tenantId, policyId: req.params.id,
      event:       'Policy retired',
      fromStatus:  policy.status,
      toStatus:    STATUS.RETIRED,
      actorEmail:  req.user.email,
    });
    res.json({ message: 'Policy retired.', policy: updated });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── POST /api/policies/:id/review (owner only) ──────────────────────────────

router.post('/:id/review', requirePolicyOwner(), async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const policy   = req.policy;
    if (policy.status !== STATUS.ACTIVE) {
      return res.status(400).json({ error: 'Only ACTIVE policies can be sent for review' });
    }
    const updated = await db.updatePolicy(tenantId, req.params.id, {
      status: STATUS.UNDER_REVIEW, advance_notice_sent: false, escalation_sent: false,
    });
    await db.logChange({
      tenantId, policyId: req.params.id,
      event:       'Ad-hoc review triggered',
      fromStatus:  STATUS.ACTIVE,
      toStatus:    STATUS.UNDER_REVIEW,
      actorEmail:  req.user.email,
    });

    // Seed /drafts/ with the published document so revision starts from the
    // authoritative current version. Best-effort — the review is already open.
    if (policy.lf_folder_ids?.current && policy.lf_folder_ids?.drafts) {
      try {
        const copied = await copyNewestFile(
          req.tenant.lf_share_name, policy.lf_folder_ids.current, policy.lf_folder_ids.drafts,
        );
        if (copied) {
          await db.logChange({
            tenantId, policyId: req.params.id,
            event:      `Working copy seeded to drafts: ${copied.name}`,
            actorEmail: req.user.email,
            metadata:   { lf_file_id: copied.file.id, checksum: copied.file.checksum },
          });
        }
      } catch (lfErr) {
        console.warn(`[policies] working-copy seed failed for ${req.params.id}: ${lfErr.message}`);
      }
    }

    res.json({ message: 'Review cycle triggered.', policy: updated });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── GET /api/policies/:id/acknowledgements (read access) ────────────────────

router.get('/:id/acknowledgements', requirePolicyReadAccess(), async (req, res) => {
  try {
    const acks = await db.getAcknowledgements(req.tenant.id, req.params.id, req.query.version);
    res.json(acks);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
