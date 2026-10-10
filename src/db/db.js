/**
 * howldr ProofWorks
 * Database query layer
 *
 * All Postgres interactions go through this file.
 * Uses the 'pg' library with a connection pool.
 *
 * Every policy/child function is tenant-scoped. Callers pass a tenantId
 * resolved by the tenant middleware (req.tenant.id) or pulled from a row
 * (e.g. policy.tenant_id, notification.tenant_id).
 */

const { Pool } = require('pg');

const spine = require('../audit/spine');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // required for Supabase
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[db] Unexpected pool error:', err);
});

// ─── Utility ──────────────────────────────────────────────────────────────────

async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (duration > 1000) {
      console.warn(`[db] Slow query (${duration}ms):`, text);
    }
    return result;
  } catch (err) {
    console.error('[db] Query error:', { text, params, err: err.message });
    throw err;
  }
}

function requireTenant(tenantId, fnName) {
  if (tenantId === undefined || tenantId === null) {
    throw new Error(`${fnName} requires tenantId`);
  }
}

// ─── Policy ID sequence ───────────────────────────────────────────────────────

/**
 * Atomically allocate the next policy ID for the given tenant/year.
 * The PK on policy_id_sequence is (tenant_id, year) so tenants have
 * independent ID namespaces.
 *
 * @param {number|string} tenantId
 * @returns {Promise<string>} e.g. 'POL-2025-001'
 */
async function allocatePolicyId(tenantId) {
  requireTenant(tenantId, 'allocatePolicyId');
  const year = new Date().getFullYear();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`
      insert into policy_id_sequence (tenant_id, year, last_sequence)
      values ($1, $2, 1)
      on conflict (tenant_id, year) do update
        set last_sequence = policy_id_sequence.last_sequence + 1
      returning last_sequence
    `, [tenantId, year]);
    await client.query('COMMIT');
    const seq = String(result.rows[0].last_sequence).padStart(3, '0');
    return `POL-${year}-${seq}`;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── Policies ─────────────────────────────────────────────────────────────────

/**
 * The schema stores LiquidFiles folder ids as flat columns
 * (lf_folder_id_root, …); the API layer works with a nested lf_folder_ids
 * object. These two helpers translate at the db boundary so neither side
 * silently drops the other's shape.
 */
function withFolderIds(row) {
  if (!row) return row;
  return {
    ...row,
    lf_folder_ids: {
      root:     row.lf_folder_id_root     ?? null,
      current:  row.lf_folder_id_current  ?? null,
      training: row.lf_folder_id_training ?? null,
      drafts:   row.lf_folder_id_drafts   ?? null,
      archive:  row.lf_folder_id_archive  ?? null,
      acks:     row.lf_folder_id_acks     ?? null,
    },
  };
}

function flattenFolderIds(updates) {
  if (!updates.lf_folder_ids) return updates;
  const { lf_folder_ids, ...rest } = updates;
  return {
    ...rest,
    lf_folder_id_root:     lf_folder_ids.root     ?? null,
    lf_folder_id_current:  lf_folder_ids.current  ?? null,
    lf_folder_id_training: lf_folder_ids.training ?? null,
    lf_folder_id_drafts:   lf_folder_ids.drafts   ?? null,
    lf_folder_id_archive:  lf_folder_ids.archive  ?? null,
    lf_folder_id_acks:     lf_folder_ids.acks     ?? null,
  };
}

async function createPolicy(data) {
  requireTenant(data.tenant_id, 'createPolicy');
  const result = await query(`
    insert into policies (
      tenant_id, policy_id, title, category, owner_email, current_version, status,
      review_frequency_months, applicable_roles, exec_email,
      lf_folder_id_root, lf_folder_id_current, lf_folder_id_training,
      lf_folder_id_drafts, lf_folder_id_archive, lf_folder_id_acks,
      acknowledgement_total
    ) values (
      $1, $2, $3, $4, $5, $6, $7,
      $8, $9, $10,
      $11, $12, $13, $14, $15, $16,
      $17
    )
    returning *
  `, [
    data.tenant_id,
    data.policy_id,
    data.title,
    data.category,
    data.owner_email,
    data.current_version || 'v0.1',
    data.status || 'DRAFT',
    data.review_frequency_months || 12,
    data.applicable_roles || [],
    data.exec_email                 || null,
    data.lf_folder_ids?.root        || null,
    data.lf_folder_ids?.current     || null,
    data.lf_folder_ids?.training    || null,
    data.lf_folder_ids?.drafts      || null,
    data.lf_folder_ids?.archive     || null,
    data.lf_folder_ids?.acks        || null,
    data.acknowledgement_total      || 0,
  ]);
  return withFolderIds(result.rows[0]);
}

async function getPolicyById(tenantId, policyId) {
  requireTenant(tenantId, 'getPolicyById');
  const result = await query(
    'select * from policies where tenant_id = $1 and policy_id = $2',
    [tenantId, policyId]
  );
  return withFolderIds(result.rows[0] || null);
}

async function listPolicies({ tenantId, status, category, owner, authoriserEmail, execEmail, limit = 100, offset = 0 } = {}) {
  requireTenant(tenantId, 'listPolicies');
  const params = [tenantId];
  const conditions = ['tenant_id = $1'];

  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }
  if (category) {
    params.push(category);
    conditions.push(`category = $${params.length}`);
  }
  if (owner) {
    params.push(owner);
    conditions.push(`owner_email = $${params.length}`);
  }
  if (execEmail) {
    params.push(execEmail);
    conditions.push(`exec_email = $${params.length}`);
  }
  if (authoriserEmail) {
    params.push(authoriserEmail);
    conditions.push(`exists (
      select 1 from policy_authorisers pa
      where pa.tenant_id = policies.tenant_id
        and pa.policy_id = policies.policy_id
        and pa.email     = $${params.length}
    )`);
  }

  params.push(limit, offset);
  const result = await query(`
    select * from policies
    where ${conditions.join(' and ')}
    order by created_at desc
    limit $${params.length - 1} offset $${params.length}
  `, params);

  return result.rows.map(withFolderIds);
}

async function updatePolicy(tenantId, policyId, updates) {
  requireTenant(tenantId, 'updatePolicy');
  updates = flattenFolderIds(updates);
  const fields = [];
  const params = [];

  const allowed = [
    'title', 'category', 'owner_email', 'current_version', 'status',
    'authorised_date', 'review_frequency_months', 'next_review_date',
    'applicable_roles', 'acknowledgement_count', 'acknowledgement_total',
    'advance_notice_sent', 'escalation_sent', 'review_expires_at', 'exec_email',
    'lf_folder_id_root', 'lf_folder_id_current', 'lf_folder_id_training',
    'lf_folder_id_drafts', 'lf_folder_id_archive', 'lf_folder_id_acks',
  ];

  for (const key of allowed) {
    if (updates[key] !== undefined) {
      params.push(updates[key]);
      fields.push(`${key} = $${params.length}`);
    }
  }

  if (fields.length === 0) return getPolicyById(tenantId, policyId);

  params.push(tenantId, policyId);
  const result = await query(`
    update policies set ${fields.join(', ')}
    where tenant_id = $${params.length - 1} and policy_id = $${params.length}
    returning *
  `, params);

  return withFolderIds(result.rows[0]);
}

async function incrementAcknowledgementCount(tenantId, policyId) {
  requireTenant(tenantId, 'incrementAcknowledgementCount');
  const result = await query(`
    update policies
    set acknowledgement_count = acknowledgement_count + 1
    where tenant_id = $1 and policy_id = $2
    returning acknowledgement_count, acknowledgement_total
  `, [tenantId, policyId]);
  return result.rows[0];
}

// ─── Authorisation routes (ordered stages + append-only approvals) ─────────────
//
// A route is an ordered list of stages; each stage is { threshold, members }.
// threshold === null means every member must approve; an integer N means a
// quorum of N. Membership lives on policy_authorisers (one row per member,
// tagged with stage_position); decisions live append-only in policy_approvals,
// pinned to the policy version. Nothing here mutates a prior decision — the
// current decision for an authoriser is simply their latest row for the
// version under review, so a version bump on return starts a clean round.

/**
 * Replace a policy's authorisation route. `stages` is an ordered array of
 * `{ threshold, members }` (threshold null = all, integer = quorum). Membership
 * (policy_authorisers) and stage definitions (policy_auth_stages) are rewritten
 * transactionally; the append-only policy_approvals history is left untouched.
 */
async function setAuthorisationRoute(tenantId, policyId, stages) {
  requireTenant(tenantId, 'setAuthorisationRoute');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('delete from policy_authorisers where tenant_id = $1 and policy_id = $2', [tenantId, policyId]);
    await client.query('delete from policy_auth_stages where tenant_id = $1 and policy_id = $2', [tenantId, policyId]);
    for (let i = 0; i < stages.length; i++) {
      const position = i + 1;
      const threshold = stages[i].threshold ?? null;
      await client.query(
        'insert into policy_auth_stages (tenant_id, policy_id, position, threshold) values ($1, $2, $3, $4)',
        [tenantId, policyId, position, threshold]
      );
      for (const email of stages[i].members) {
        await client.query(
          'insert into policy_authorisers (tenant_id, policy_id, email, stage_position) values ($1, $2, $3, $4)',
          [tenantId, policyId, email, position]
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Backward-compatible single-stage route (threshold = all). */
async function setAuthorisers(tenantId, policyId, emails) {
  requireTenant(tenantId, 'setAuthorisers');
  return setAuthorisationRoute(tenantId, policyId, [{ threshold: null, members: emails }]);
}

/**
 * Append a decision row (never updates an existing one). The stage is derived
 * from the authoriser's current membership, so callers needn't supply it.
 */
async function recordApproval(tenantId, { policyId, email, version, contentHash = null }) {
  requireTenant(tenantId, 'recordApproval');
  await query(`
    insert into policy_approvals
      (tenant_id, policy_id, stage_position, authoriser_email, decision, version, content_hash)
    select $1, $2, coalesce(pa.stage_position, 1), $3, 'approved', $4, $5
    from policy_authorisers pa
    where pa.tenant_id = $1 and pa.policy_id = $2 and pa.email = $3
  `, [tenantId, policyId, email, version, contentHash]);
}

async function recordReturn(tenantId, { policyId, email, version, feedback }) {
  requireTenant(tenantId, 'recordReturn');
  await query(`
    insert into policy_approvals
      (tenant_id, policy_id, stage_position, authoriser_email, decision, version, feedback)
    select $1, $2, coalesce(pa.stage_position, 1), $3, 'returned', $4, $5
    from policy_authorisers pa
    where pa.tenant_id = $1 and pa.policy_id = $2 and pa.email = $3
  `, [tenantId, policyId, email, version, feedback]);
}

/**
 * Flat authoriser list, shape-compatible with the pre-routes API: each row
 * carries { email, stage_position } plus approved_at/returned_at/feedback
 * derived from the latest append-only decision for the policy's current
 * version. Used by the middleware membership check, the "my tasks" queue, and
 * the policy-detail response.
 */
async function getAuthorisers(tenantId, policyId) {
  requireTenant(tenantId, 'getAuthorisers');
  const result = await query(`
    select
      pa.id, pa.email, pa.stage_position, pa.created_at,
      case when ap.decision = 'approved' then ap.created_at end as approved_at,
      case when ap.decision = 'returned' then ap.created_at end as returned_at,
      case when ap.decision = 'returned' then ap.feedback  end as feedback
    from policy_authorisers pa
    join policies p on p.tenant_id = pa.tenant_id and p.policy_id = pa.policy_id
    left join lateral (
      select decision, created_at, feedback
      from policy_approvals a
      where a.tenant_id = pa.tenant_id and a.policy_id = pa.policy_id
        and a.authoriser_email = pa.email and a.version = p.current_version
      order by a.created_at desc, a.id desc
      limit 1
    ) ap on true
    where pa.tenant_id = $1 and pa.policy_id = $2
    order by pa.stage_position, pa.created_at
  `, [tenantId, policyId]);
  return result.rows;
}

// ─── Executive authorisation (append-only, stored under stage_position 0) ──────

/** Record the exec's decision for a version. Reserved stage_position 0 keeps it
 *  out of the 1-based authoriser route while sharing the receipt table. */
async function recordExecDecision(tenantId, { policyId, email, version, decision, contentHash = null, feedback = null }) {
  requireTenant(tenantId, 'recordExecDecision');
  await query(`
    insert into policy_approvals
      (tenant_id, policy_id, stage_position, authoriser_email, decision, version, content_hash, feedback)
    values ($1, $2, 0, $3, $4, $5, $6, $7)
  `, [tenantId, policyId, email, decision, version, contentHash, feedback]);
}

/** The exec's latest decision for a version, or null. */
async function getExecDecision(tenantId, policyId, version) {
  requireTenant(tenantId, 'getExecDecision');
  const result = await query(`
    select authoriser_email as email, decision, created_at, feedback
    from policy_approvals
    where tenant_id = $1 and policy_id = $2 and version = $3 and stage_position = 0
    order by created_at desc, id desc
    limit 1
  `, [tenantId, policyId, version]);
  return result.rows[0] || null;
}

/** Record the owner's acceptance decision. Reserved stage_position -1 keeps it
 *  out of the 1-based authoriser route and distinct from the exec (0). */
async function recordOwnerDecision(tenantId, { policyId, email, version, decision, contentHash = null, feedback = null }) {
  requireTenant(tenantId, 'recordOwnerDecision');
  await query(`
    insert into policy_approvals
      (tenant_id, policy_id, stage_position, authoriser_email, decision, version, content_hash, feedback)
    values ($1, $2, -1, $3, $4, $5, $6, $7)
  `, [tenantId, policyId, email, decision, version, contentHash, feedback]);
}

/** The owner's latest acceptance decision for a version, or null. */
async function getOwnerDecision(tenantId, policyId, version) {
  requireTenant(tenantId, 'getOwnerDecision');
  const result = await query(`
    select authoriser_email as email, decision, created_at, feedback
    from policy_approvals
    where tenant_id = $1 and policy_id = $2 and version = $3 and stage_position = -1
    order by created_at desc, id desc
    limit 1
  `, [tenantId, policyId, version]);
  return result.rows[0] || null;
}

/**
 * The route with per-stage progress for a given version: an ordered array of
 * stages, each { position, threshold, members:[{email,decision,decidedAt,feedback}],
 * memberCount, approved, required, satisfied }, plus the derived engine fields
 * `activeStage` (lowest unsatisfied stage) and `fullyApproved`.
 */
async function getRouteState(tenantId, policyId, version) {
  requireTenant(tenantId, 'getRouteState');
  const [stagesRes, membersRes, apprRes] = await Promise.all([
    query('select position, threshold from policy_auth_stages where tenant_id = $1 and policy_id = $2 order by position',
      [tenantId, policyId]),
    query('select email, stage_position from policy_authorisers where tenant_id = $1 and policy_id = $2 order by created_at',
      [tenantId, policyId]),
    query(`
      select distinct on (authoriser_email) authoriser_email, decision, created_at, feedback
      from policy_approvals
      where tenant_id = $1 and policy_id = $2 and version = $3
      order by authoriser_email, created_at desc, id desc
    `, [tenantId, policyId, version]),
  ]);

  const latest = new Map(apprRes.rows.map(r => [r.authoriser_email, r]));
  const membersByStage = new Map();
  for (const m of membersRes.rows) {
    if (!membersByStage.has(m.stage_position)) membersByStage.set(m.stage_position, []);
    membersByStage.get(m.stage_position).push(m.email);
  }

  const stages = stagesRes.rows.map(s => {
    const emails = membersByStage.get(s.position) || [];
    const members = emails.map(email => {
      const d = latest.get(email);
      return {
        email,
        decision: d ? d.decision : null,
        decidedAt: d ? d.created_at : null,
        feedback: d && d.decision === 'returned' ? d.feedback : null,
      };
    });
    const approved = members.filter(m => m.decision === 'approved').length;
    const required = s.threshold == null ? emails.length : Math.min(s.threshold, emails.length);
    const satisfied = emails.length > 0 && approved >= required;
    return {
      position: s.position, threshold: s.threshold, members,
      memberCount: emails.length, approved, required, satisfied,
    };
  });

  const activeStage = stages.find(s => !s.satisfied) || null;
  const fullyApproved = stages.length > 0 && stages.every(s => s.satisfied);
  return { stages, activeStage, fullyApproved };
}

// ─── Acknowledgements ─────────────────────────────────────────────────────────

async function createAcknowledgements(tenantId, policyId, version, recipients) {
  requireTenant(tenantId, 'createAcknowledgements');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of recipients) {
      await client.query(`
        insert into acknowledgements
          (tenant_id, policy_id, version, recipient_email, manager_email, lf_message_id, expires_at,
           lf_file_id, document_checksum, accept_token)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        on conflict (tenant_id, policy_id, version, recipient_email) do update
          set lf_message_id     = excluded.lf_message_id,
              lf_file_id        = excluded.lf_file_id,
              document_checksum = excluded.document_checksum,
              accept_token      = coalesce(acknowledgements.accept_token, excluded.accept_token),
              distributed_at    = now()
      `, [tenantId, policyId, version, r.email, r.manager_email || null, r.lf_message_id || null, r.expires_at || null,
          r.lf_file_id || null, r.document_checksum || null, r.accept_token || null]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function recordAcknowledgement({ tenantId, policyId, version, recipientEmail, acknowledgedAt, ipAddress, downloadCount, messageId }) {
  requireTenant(tenantId, 'recordAcknowledgement');
  await query(`
    update acknowledgements
    set acknowledged_at = $1,
        ip_address      = $2,
        download_count  = $3,
        lf_message_id   = coalesce($4, lf_message_id)
    where tenant_id       = $5
      and policy_id       = $6
      and version         = $7
      and recipient_email = $8
      and acknowledged_at is null
  `, [acknowledgedAt || new Date(), ipAddress, downloadCount || 1, messageId, tenantId, policyId, version, recipientEmail]);
}

/**
 * Look up an acceptance row by its bearer token — the ONLY tenant-unscoped
 * acknowledgement read. The token is high-entropy and unique, so possession
 * is the authorisation; the row carries its own tenant_id for what follows.
 */
async function getAcknowledgementByToken(token) {
  const result = await query(`
    select a.*, p.title, p.status as policy_status, t.name as tenant_name
    from acknowledgements a
    join policies p on p.tenant_id = a.tenant_id and p.policy_id = a.policy_id
    join tenants t on t.id = a.tenant_id
    where a.accept_token = $1
  `, [token]);
  return result.rows[0] || null;
}

/** Record the explicit "I have read and accept" click. Idempotent — first
 *  attestation wins; also counts as the acknowledgement if the recipient
 *  hasn't downloaded yet. */
async function recordAttestation(tenantId, id, ip) {
  requireTenant(tenantId, 'recordAttestation');
  const result = await query(`
    update acknowledgements
    set attested_at     = coalesce(attested_at, now()),
        attest_ip       = coalesce(attest_ip, $3),
        acknowledged_at = coalesce(acknowledged_at, now())
    where tenant_id = $1 and id = $2
    returning *
  `, [tenantId, id, ip || null]);
  return result.rows[0] || null;
}

async function getAcknowledgements(tenantId, policyId, version = null) {
  requireTenant(tenantId, 'getAcknowledgements');
  const params = [tenantId, policyId];
  const versionClause = version ? `and version = $3` : '';
  if (version) params.push(version);

  const result = await query(`
    select * from acknowledgements
    where tenant_id = $1 and policy_id = $2 ${versionClause}
    order by recipient_email
  `, params);
  return result.rows;
}

async function getOutstandingRecipients(tenantId, policyId) {
  requireTenant(tenantId, 'getOutstandingRecipients');
  const result = await query(`
    select * from outstanding_acceptances
    where tenant_id = $1 and policy_id = $2
    order by days_elapsed desc
  `, [tenantId, policyId]);
  return result.rows;
}

async function markReminderSent(tenantId, policyId, recipientEmail) {
  requireTenant(tenantId, 'markReminderSent');
  await query(`
    update acknowledgements
    set reminded_at = array_append(coalesce(reminded_at, '{}'), now())
    where tenant_id = $1 and policy_id = $2 and recipient_email = $3
  `, [tenantId, policyId, recipientEmail]);
}

// ─── Notifications ────────────────────────────────────────────────────────────

async function recordNotification({ tenantId, policyId, eventType, recipientEmail, lfMessageId, version }) {
  requireTenant(tenantId, 'recordNotification');
  const result = await query(`
    insert into notifications
      (tenant_id, policy_id, event_type, recipient_email, lf_message_id, version)
    values ($1, $2, $3, $4, $5, $6)
    returning *
  `, [tenantId, policyId, eventType, recipientEmail, lfMessageId || null, version || null]);
  return result.rows[0];
}

/**
 * Look up a notification by its LiquidFiles message id. Not tenant-scoped
 * because the LF webhook only knows the message id; the returned row carries
 * tenant_id so the caller scopes downstream queries.
 */
async function getNotificationByMessageId(lfMessageId) {
  const result = await query(`
    select * from notifications
    where lf_message_id = $1
    order by sent_at desc
    limit 1
  `, [lfMessageId]);
  return result.rows[0] || null;
}

// ─── Review activity: comments + reads ────────────────────────────────────────

async function addComment(tenantId, policyId, { version, authorEmail, kind, body }) {
  requireTenant(tenantId, 'addComment');
  const result = await query(`
    insert into policy_comments (tenant_id, policy_id, version, author_email, kind, body)
    values ($1, $2, $3, $4, $5, $6)
    returning *
  `, [tenantId, policyId, version, authorEmail, kind || 'comment', body]);
  return result.rows[0];
}

async function getComments(tenantId, policyId) {
  requireTenant(tenantId, 'getComments');
  const result = await query(
    'select * from policy_comments where tenant_id = $1 and policy_id = $2 order by created_at',
    [tenantId, policyId]
  );
  return result.rows;
}

/** Record (or increment) a reviewer's read of a policy version. */
async function recordRead(tenantId, policyId, { version, readerEmail }) {
  requireTenant(tenantId, 'recordRead');
  const result = await query(`
    insert into policy_reads (tenant_id, policy_id, version, reader_email)
    values ($1, $2, $3, $4)
    on conflict (tenant_id, policy_id, version, reader_email) do update
      set read_count = policy_reads.read_count + 1, last_read_at = now()
    returning *
  `, [tenantId, policyId, version, readerEmail]);
  return result.rows[0];
}

async function getReads(tenantId, policyId, version = null) {
  requireTenant(tenantId, 'getReads');
  const params = [tenantId, policyId];
  let versionClause = '';
  if (version) { versionClause = 'and version = $3'; params.push(version); }
  const result = await query(
    `select * from policy_reads where tenant_id = $1 and policy_id = $2 ${versionClause} order by last_read_at desc`,
    params
  );
  return result.rows;
}

// ─── Changelog ────────────────────────────────────────────────────────────────

async function logChange({ tenantId, policyId, event, fromStatus, toStatus, fromVersion, toVersion, actorEmail, metadata }) {
  requireTenant(tenantId, 'logChange');
  await query(`
    insert into policy_changelog
      (tenant_id, policy_id, event, from_status, to_status, from_version, to_version, actor_email, metadata)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `, [
    tenantId,
    policyId,
    event,
    fromStatus   || null,
    toStatus     || null,
    fromVersion  || null,
    toVersion    || null,
    actorEmail   || null,
    metadata     ? JSON.stringify(metadata) : null,
  ]);
  // Feed the cross-module spine. The changelog's typed columns fold into
  // metadata so the normalized event is self-contained.
  const spineMeta = {
    ...(metadata || {}),
    ...(fromStatus  ? { from_status:  fromStatus }  : {}),
    ...(toStatus    ? { to_status:    toStatus }    : {}),
    ...(fromVersion ? { from_version: fromVersion } : {}),
    ...(toVersion   ? { to_version:   toVersion }   : {}),
  };
  await appendAuditEvent({
    tenantId, actorEmail,
    action: event, objectType: 'policy', objectId: policyId,
    metadata: Object.keys(spineMeta).length ? spineMeta : null,
  });
}

async function getChangelog(tenantId, policyId) {
  requireTenant(tenantId, 'getChangelog');
  const result = await query(`
    select * from policy_changelog
    where tenant_id = $1 and policy_id = $2
    order by created_at asc
  `, [tenantId, policyId]);
  return result.rows;
}

// ─── Scheduler queries ────────────────────────────────────────────────────────
// Cross-tenant by design — the scheduler sweeps all policies in one pass.
// Each returned row carries tenant_id; the scheduler passes that into
// subsequent tenant-scoped writes.

async function getPoliciesForReviewCheck() {
  const result = await query(`select * from policies_due_for_review`);
  return result.rows;
}

async function getPoliciesWithOutstandingAcceptances() {
  const result = await query(`
    select distinct
      p.tenant_id, p.policy_id, p.title, p.owner_email,
      p.current_version, p.status, p.escalation_sent
    from policies p
    join acknowledgements a
      on a.tenant_id = p.tenant_id and a.policy_id = p.policy_id
    where p.status = 'PENDING_ACCEPTANCE'
      and a.acknowledged_at is null
  `);
  return result.rows;
}

async function markAdvanceNoticeSent(tenantId, policyId) {
  requireTenant(tenantId, 'markAdvanceNoticeSent');
  await query(
    'update policies set advance_notice_sent = true where tenant_id = $1 and policy_id = $2',
    [tenantId, policyId]
  );
}

async function markEscalationSent(tenantId, policyId) {
  requireTenant(tenantId, 'markEscalationSent');
  await query(
    'update policies set escalation_sent = true where tenant_id = $1 and policy_id = $2',
    [tenantId, policyId]
  );
}

// ─── App users (Supabase Auth) ────────────────────────────────────────────────

async function getAppUserById(id) {
  const result = await query('select * from app_users where id = $1', [id]);
  return result.rows[0] || null;
}

async function getAppUserByEmail(email) {
  const result = await query('select * from app_users where email = $1', [email]);
  return result.rows[0] || null;
}

/**
 * Point an app_users row at a different Supabase Auth user id, matched by
 * email (case-insensitive). Used by the auth resolver to self-heal when an
 * invite was bound to one Supabase user but the person's OAuth sign-in
 * arrived as another (e.g. invite pre-dates first sign-in, or the address
 * was re-created). Returns the updated row, or null if no email match.
 */
async function rebindAppUserByEmail(email, newId) {
  const result = await query(
    'update app_users set id = $2 where lower(email) = lower($1) returning *',
    [email, newId]
  );
  return result.rows[0] || null;
}

async function listAppUsersByTenant(tenantId) {
  if (tenantId === undefined || tenantId === null) {
    throw new Error('listAppUsersByTenant requires tenantId');
  }
  const result = await query(
    'select * from app_users where tenant_id = $1 order by email',
    [tenantId]
  );
  return result.rows;
}

/**
 * Insert or upsert an app_users row tied to a Supabase Auth user.
 *
 * @param {object} u
 * @param {string} u.id         - auth.users.id (uuid)
 * @param {string} u.email
 * @param {?number} u.tenantId  - null for howldr_support, required otherwise
 * @param {string} u.role
 */
async function upsertAppUser({ id, email, tenantId, role }) {
  const result = await query(`
    insert into app_users (id, email, tenant_id, role)
    values ($1, $2, $3, $4)
    on conflict (id) do update
      set email     = excluded.email,
          tenant_id = excluded.tenant_id,
          role      = excluded.role
    returning *
  `, [id, email, tenantId ?? null, role]);
  return result.rows[0];
}

async function deleteAppUser(id) {
  await query('delete from app_users where id = $1', [id]);
}

/**
 * Change a tenant member's role. Scoped by tenant so a global uuid can't be
 * used to mutate another tenant's user. Returns the updated row, or null if
 * no member with that id exists in the tenant.
 */
async function updateAppUserRole(tenantId, id, role) {
  requireTenant(tenantId, 'updateAppUserRole');
  const result = await query(
    'update app_users set role = $3 where tenant_id = $1 and id = $2 returning *',
    [tenantId, id, role]
  );
  return result.rows[0] || null;
}

/** Remove a tenant member (tenant-scoped). Returns true if a row was deleted. */
async function deleteAppUserInTenant(tenantId, id) {
  requireTenant(tenantId, 'deleteAppUserInTenant');
  const result = await query(
    'delete from app_users where tenant_id = $1 and id = $2',
    [tenantId, id]
  );
  return result.rowCount > 0;
}

/** Count of admins in a tenant — used to block removing/demoting the last one. */
async function countTenantAdmins(tenantId) {
  requireTenant(tenantId, 'countTenantAdmins');
  const result = await query(
    "select count(*)::int as n from app_users where tenant_id = $1 and role = 'admin'",
    [tenantId]
  );
  return result.rows[0].n;
}

// ─── Tenants ──────────────────────────────────────────────────────────────────

async function getTenantById(id) {
  const result = await query('select * from tenants where id = $1', [id]);
  return result.rows[0] || null;
}

async function getTenantBySlug(slug) {
  const result = await query('select * from tenants where slug = $1', [slug]);
  return result.rows[0] || null;
}

async function getTenantByCustomDomain(domain) {
  const result = await query(
    'select * from tenants where custom_domain = $1',
    [domain]
  );
  return result.rows[0] || null;
}

/**
 * Update a tenant's reminder/review cadence. Each field is optional — null/
 * undefined leaves the existing value (coalesce), so callers can patch one
 * field at a time. Returns the updated tenant row.
 */
async function updateTenantCadence(tenantId, {
  reviewAdvanceNoticeDays, reviewGracePeriodDays, acceptanceReminderDays, governanceLeadEmail,
  execRequiredCategories, ownerAcceptanceRequired,
} = {}) {
  requireTenant(tenantId, 'updateTenantCadence');
  const result = await query(`
    update tenants set
      review_advance_notice_days = coalesce($2, review_advance_notice_days),
      review_grace_period_days   = coalesce($3, review_grace_period_days),
      acceptance_reminder_days   = coalesce($4, acceptance_reminder_days),
      governance_lead_email      = coalesce($5, governance_lead_email),
      exec_required_categories   = coalesce($6, exec_required_categories),
      owner_acceptance_required  = coalesce($7, owner_acceptance_required)
    where id = $1
    returning *
  `, [
    tenantId,
    reviewAdvanceNoticeDays ?? null,
    reviewGracePeriodDays ?? null,
    acceptanceReminderDays ?? null,
    governanceLeadEmail ?? null,
    execRequiredCategories ?? null,
    ownerAcceptanceRequired ?? null,
  ]);
  return result.rows[0] || null;
}

/** Update the workspace's presentation fields — theme preset, custom accent,
 *  logo. Only the keys present are touched; null clears accent/logo. All
 *  values are validated in the API layer — this just persists. */
async function updateTenantAppearance(tenantId, { theme, themeAccent, logoDataUrl } = {}) {
  requireTenant(tenantId, 'updateTenantAppearance');
  const params = [tenantId];
  const sets = [];
  if (theme !== undefined)       { params.push(theme);       sets.push(`theme = $${params.length}`); }
  if (themeAccent !== undefined) { params.push(themeAccent); sets.push(`theme_accent = $${params.length}`); }
  if (logoDataUrl !== undefined) { params.push(logoDataUrl); sets.push(`logo_data_url = $${params.length}`); }
  if (sets.length === 0) {
    const result = await query('select * from tenants where id = $1', [tenantId]);
    return result.rows[0] || null;
  }
  const result = await query(
    `update tenants set ${sets.join(', ')} where id = $1 returning *`,
    params
  );
  return result.rows[0] || null;
}

// ─── Distribution audiences (recipient groups) ────────────────────────────────

async function listGroups(tenantId) {
  requireTenant(tenantId, 'listGroups');
  const result = await query(`
    select g.id, g.name, g.roles, g.excluded_emails, g.created_at,
           count(m.id)::int as member_count
    from distribution_groups g
    left join distribution_group_members m on m.group_id = g.id
    where g.tenant_id = $1
    group by g.id
    order by g.name
  `, [tenantId]);
  return result.rows;
}

async function getGroupWithMembers(tenantId, id) {
  requireTenant(tenantId, 'getGroupWithMembers');
  const g = await query('select * from distribution_groups where tenant_id = $1 and id = $2', [tenantId, id]);
  if (!g.rows[0]) return null;
  const members = await query(
    'select email, manager_email from distribution_group_members where group_id = $1 order by email',
    [id]
  );
  return { ...g.rows[0], members: members.rows };
}

async function createGroup(tenantId, name, members = [], roles = [], excludedEmails = []) {
  requireTenant(tenantId, 'createGroup');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const g = await client.query(
      'insert into distribution_groups (tenant_id, name, roles, excluded_emails) values ($1, $2, $3, $4) returning id',
      [tenantId, name, roles, excludedEmails]
    );
    const groupId = g.rows[0].id;
    for (const m of members) {
      await client.query(
        'insert into distribution_group_members (tenant_id, group_id, email, manager_email) values ($1, $2, $3, $4) on conflict (group_id, email) do nothing',
        [tenantId, groupId, m.email, m.manager_email || null]
      );
    }
    await client.query('COMMIT');
    return getGroupWithMembers(tenantId, groupId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function updateGroup(tenantId, id, { name, members, roles, excludedEmails }) {
  requireTenant(tenantId, 'updateGroup');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const owned = await client.query('select id from distribution_groups where tenant_id = $1 and id = $2', [tenantId, id]);
    if (!owned.rows[0]) { await client.query('ROLLBACK'); return null; }
    if (name !== undefined) {
      await client.query('update distribution_groups set name = $3 where tenant_id = $1 and id = $2', [tenantId, id, name]);
    }
    if (roles !== undefined) {
      await client.query('update distribution_groups set roles = $3 where tenant_id = $1 and id = $2', [tenantId, id, roles]);
    }
    if (excludedEmails !== undefined) {
      await client.query('update distribution_groups set excluded_emails = $3 where tenant_id = $1 and id = $2', [tenantId, id, excludedEmails]);
    }
    if (members !== undefined) {
      await client.query('delete from distribution_group_members where group_id = $1', [id]);
      for (const m of members) {
        await client.query(
          'insert into distribution_group_members (tenant_id, group_id, email, manager_email) values ($1, $2, $3, $4) on conflict (group_id, email) do nothing',
          [tenantId, id, m.email, m.manager_email || null]
        );
      }
    }
    await client.query('COMMIT');
    return getGroupWithMembers(tenantId, id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function deleteGroup(tenantId, id) {
  requireTenant(tenantId, 'deleteGroup');
  const result = await query('delete from distribution_groups where tenant_id = $1 and id = $2', [tenantId, id]);
  return result.rowCount > 0;
}

// ─── Health check ─────────────────────────────────────────────────────────────

// ─── Evidence Locker ──────────────────────────────────────────────────────────
// Items are append-only in spirit: metadata edits are allowed (and logged as
// events), but proof fields and history are never erased — items RETIRE, they
// don't delete. Proof strength (held/fingerprinted/declared) is derived from
// lf_file_id/checksum by the API layer, never stored.

async function allocateEvidenceId(tenantId) {
  requireTenant(tenantId, 'allocateEvidenceId');
  const year = new Date().getFullYear();
  const result = await query(`
    insert into evidence_id_sequence (tenant_id, year, last_sequence)
    values ($1, $2, 1)
    on conflict (tenant_id, year) do update
      set last_sequence = evidence_id_sequence.last_sequence + 1
    returning last_sequence
  `, [tenantId, year]);
  const seq = String(result.rows[0].last_sequence).padStart(3, '0');
  return `EVD-${year}-${seq}`;
}

async function createEvidenceItem(data) {
  requireTenant(data.tenant_id, 'createEvidenceItem');
  const result = await query(`
    insert into evidence_items (
      tenant_id, evidence_id, title, description, category, tags, control_label,
      owner_email, collected_at, expires_at, locator,
      lf_file_id, lf_folder_id, file_name, file_size, checksum, created_by
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
    returning *
  `, [
    data.tenant_id, data.evidence_id, data.title, data.description ?? null,
    data.category ?? null, data.tags ?? [], data.control_label ?? null,
    data.owner_email, data.collected_at ?? null, data.expires_at ?? null,
    data.locator ?? null,
    data.lf_file_id ?? null, data.lf_folder_id ?? null, data.file_name ?? null,
    data.file_size ?? null, data.checksum ?? null, data.created_by,
  ]);
  return result.rows[0];
}

async function getEvidenceById(tenantId, evidenceId) {
  requireTenant(tenantId, 'getEvidenceById');
  const result = await query(
    'select * from evidence_items where tenant_id = $1 and evidence_id = $2',
    [tenantId, evidenceId]
  );
  return result.rows[0] || null;
}

async function listEvidence({ tenantId, status, category, limit = 500, offset = 0 } = {}) {
  requireTenant(tenantId, 'listEvidence');
  const clauses = ['tenant_id = $1'];
  const params  = [tenantId];
  if (status)   { params.push(status);   clauses.push(`status = $${params.length}`); }
  if (category) { params.push(category); clauses.push(`category = $${params.length}`); }
  params.push(limit, offset);
  const result = await query(`
    select * from evidence_items
    where ${clauses.join(' and ')}
    order by evidence_id desc
    limit $${params.length - 1} offset $${params.length}
  `, params);
  return result.rows;
}

async function updateEvidenceItem(tenantId, evidenceId, updates) {
  requireTenant(tenantId, 'updateEvidenceItem');
  const allowed = [
    'title', 'description', 'category', 'tags', 'control_label', 'owner_email',
    'collected_at', 'expires_at', 'locator',
    'lf_file_id', 'lf_folder_id', 'file_name', 'file_size', 'checksum',
    'status', 'superseded_by',
  ];
  const fields = [];
  const params = [];
  for (const key of allowed) {
    if (updates[key] !== undefined) {
      params.push(updates[key]);
      fields.push(`${key} = $${params.length}`);
    }
  }
  if (!fields.length) return getEvidenceById(tenantId, evidenceId);
  params.push(tenantId, evidenceId);
  const result = await query(`
    update evidence_items set ${fields.join(', ')}
    where tenant_id = $${params.length - 1} and evidence_id = $${params.length}
    returning *
  `, params);
  return result.rows[0] || null;
}

async function logEvidenceEvent({ tenantId, evidenceId, event, actorEmail, metadata }) {
  requireTenant(tenantId, 'logEvidenceEvent');
  await query(`
    insert into evidence_events (tenant_id, evidence_id, event, actor_email, metadata)
    values ($1, $2, $3, $4, $5)
  `, [tenantId, evidenceId, event, actorEmail ?? null, metadata ? JSON.stringify(metadata) : null]);
  await appendAuditEvent({
    tenantId, actorEmail, action: event, objectType: 'evidence', objectId: evidenceId, metadata,
  });
}

async function getEvidenceEvents(tenantId, evidenceId) {
  requireTenant(tenantId, 'getEvidenceEvents');
  const result = await query(
    'select * from evidence_events where tenant_id = $1 and evidence_id = $2 order by created_at, id',
    [tenantId, evidenceId]
  );
  return result.rows;
}

/** Every decision receipt in the tenant (authoriser stages 1+, exec 0,
 *  owner -1) — for the evidence-pack export. */
async function listApprovalReceipts(tenantId) {
  requireTenant(tenantId, 'listApprovalReceipts');
  const result = await query(`
    select
      a.policy_id, p.title,
      case when a.stage_position = 0  then 'executive'
           when a.stage_position = -1 then 'owner'
           else 'authoriser' end as tier,
      a.stage_position, a.authoriser_email, a.decision, a.version,
      a.content_hash, a.created_at
    from policy_approvals a
    join policies p on p.tenant_id = a.tenant_id and p.policy_id = a.policy_id
    where a.tenant_id = $1
    order by a.policy_id, a.created_at, a.id
  `, [tenantId]);
  return result.rows;
}

// ─── Risk Register ────────────────────────────────────────────────────────────
// Assessment rounds and acceptance receipts are append-only; acceptance state
// is DERIVED (latest acceptance covering the latest round), never stored.

async function allocateRiskId(tenantId) {
  requireTenant(tenantId, 'allocateRiskId');
  const year = new Date().getFullYear();
  const result = await query(`
    insert into risk_id_sequence (tenant_id, year, last_sequence)
    values ($1, $2, 1)
    on conflict (tenant_id, year) do update
      set last_sequence = risk_id_sequence.last_sequence + 1
    returning last_sequence
  `, [tenantId, year]);
  const seq = String(result.rows[0].last_sequence).padStart(3, '0');
  return `RSK-${year}-${seq}`;
}

async function createRisk(data) {
  requireTenant(data.tenant_id, 'createRisk');
  const result = await query(`
    insert into risks (
      tenant_id, risk_id, title, description, category, tags,
      owner_email, acceptor_email, next_review_date, policy_ids, evidence_ids, created_by
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    returning *
  `, [
    data.tenant_id, data.risk_id, data.title, data.description ?? null,
    data.category ?? null, data.tags ?? [],
    data.owner_email, data.acceptor_email ?? null, data.next_review_date ?? null,
    data.policy_ids ?? [], data.evidence_ids ?? [], data.created_by,
  ]);
  return result.rows[0];
}

async function getRiskById(tenantId, riskId) {
  requireTenant(tenantId, 'getRiskById');
  const result = await query(
    'select * from risks where tenant_id = $1 and risk_id = $2',
    [tenantId, riskId]
  );
  return result.rows[0] || null;
}

/** Risks with their latest assessment round and derived acceptance flag. */
async function listRisks({ tenantId, status, category, limit = 500, offset = 0 } = {}) {
  requireTenant(tenantId, 'listRisks');
  const clauses = ['r.tenant_id = $1'];
  const params  = [tenantId];
  if (status)   { params.push(status);   clauses.push(`r.status = $${params.length}`); }
  if (category) { params.push(category); clauses.push(`r.category = $${params.length}`); }
  params.push(limit, offset);
  const result = await query(`
    select
      r.*,
      a.round,
      a.inherent_likelihood, a.inherent_impact,
      a.residual_likelihood, a.residual_impact,
      a.treatment,
      (acc.id is not null) as accepted
    from risks r
    left join lateral (
      select * from risk_assessments x
      where x.tenant_id = r.tenant_id and x.risk_id = r.risk_id
      order by x.round desc limit 1
    ) a on true
    left join lateral (
      select id from risk_acceptances y
      where y.tenant_id = r.tenant_id and y.risk_id = r.risk_id and y.round = a.round
      order by y.created_at desc limit 1
    ) acc on true
    where ${clauses.join(' and ')}
    order by r.risk_id desc
    limit $${params.length - 1} offset $${params.length}
  `, params);
  return result.rows;
}

// ─── Risk ↔ policy ↔ evidence links ──────────────────────────────────────────
// risks.policy_ids / risks.evidence_ids are validated references (checked on
// write against the tenant's real objects). These are the reverse lookups —
// "which risks cite this policy/evidence" — with the latest round + acceptance
// state so a linked risk shows meaningfully on the object's detail page.

async function getRisksLinkedToPolicy(tenantId, policyId) {
  requireTenant(tenantId, 'getRisksLinkedToPolicy');
  const result = await query(`
    select
      r.risk_id, r.title, r.status, r.category, r.owner_email,
      a.round, a.residual_likelihood, a.residual_impact,
      (acc.id is not null) as accepted
    from risks r
    left join lateral (
      select * from risk_assessments x
      where x.tenant_id = r.tenant_id and x.risk_id = r.risk_id
      order by x.round desc limit 1
    ) a on true
    left join lateral (
      select id from risk_acceptances y
      where y.tenant_id = r.tenant_id and y.risk_id = r.risk_id and y.round = a.round
      order by y.created_at desc limit 1
    ) acc on true
    where r.tenant_id = $1 and $2 = any(r.policy_ids)
    order by r.risk_id desc
  `, [tenantId, policyId]);
  return result.rows;
}

async function getRisksLinkedToEvidence(tenantId, evidenceId) {
  requireTenant(tenantId, 'getRisksLinkedToEvidence');
  const result = await query(`
    select
      r.risk_id, r.title, r.status, r.category, r.owner_email,
      a.round, a.residual_likelihood, a.residual_impact,
      (acc.id is not null) as accepted
    from risks r
    left join lateral (
      select * from risk_assessments x
      where x.tenant_id = r.tenant_id and x.risk_id = r.risk_id
      order by x.round desc limit 1
    ) a on true
    left join lateral (
      select id from risk_acceptances y
      where y.tenant_id = r.tenant_id and y.risk_id = r.risk_id and y.round = a.round
      order by y.created_at desc limit 1
    ) acc on true
    where r.tenant_id = $1 and $2 = any(r.evidence_ids)
    order by r.risk_id desc
  `, [tenantId, evidenceId]);
  return result.rows;
}

/** Subset of the given policy ids that actually exist in the tenant. */
async function filterExistingPolicyIds(tenantId, ids) {
  requireTenant(tenantId, 'filterExistingPolicyIds');
  if (!ids?.length) return [];
  const result = await query(
    'select policy_id from policies where tenant_id = $1 and policy_id = any($2)',
    [tenantId, ids]
  );
  return result.rows.map(r => r.policy_id);
}

/** Subset of the given evidence ids that actually exist in the tenant. */
async function filterExistingEvidenceIds(tenantId, ids) {
  requireTenant(tenantId, 'filterExistingEvidenceIds');
  if (!ids?.length) return [];
  const result = await query(
    'select evidence_id from evidence_items where tenant_id = $1 and evidence_id = any($2)',
    [tenantId, ids]
  );
  return result.rows.map(r => r.evidence_id);
}

async function updateRisk(tenantId, riskId, updates) {
  requireTenant(tenantId, 'updateRisk');
  const allowed = [
    'title', 'description', 'category', 'tags', 'owner_email', 'acceptor_email',
    'next_review_date', 'policy_ids', 'evidence_ids', 'status',
  ];
  const fields = [];
  const params = [];
  for (const key of allowed) {
    if (updates[key] !== undefined) {
      params.push(updates[key]);
      fields.push(`${key} = $${params.length}`);
    }
  }
  if (!fields.length) return getRiskById(tenantId, riskId);
  params.push(tenantId, riskId);
  const result = await query(`
    update risks set ${fields.join(', ')}
    where tenant_id = $${params.length - 1} and risk_id = $${params.length}
    returning *
  `, params);
  return result.rows[0] || null;
}

/** Append the next assessment round (round number derived atomically). */
async function addRiskAssessment(tenantId, {
  riskId, inherentLikelihood, inherentImpact, residualLikelihood, residualImpact,
  treatment, treatmentNotes, assessedBy,
}) {
  requireTenant(tenantId, 'addRiskAssessment');
  const result = await query(`
    insert into risk_assessments (
      tenant_id, risk_id, round,
      inherent_likelihood, inherent_impact, residual_likelihood, residual_impact,
      treatment, treatment_notes, assessed_by
    )
    select $1, $2, coalesce(max(x.round), 0) + 1, $3, $4, $5, $6, $7, $8, $9
    from risk_assessments x
    where x.tenant_id = $1 and x.risk_id = $2
    returning *
  `, [
    tenantId, riskId,
    inherentLikelihood, inherentImpact, residualLikelihood, residualImpact,
    treatment, treatmentNotes ?? null, assessedBy,
  ]);
  return result.rows[0];
}

async function getRiskAssessments(tenantId, riskId) {
  requireTenant(tenantId, 'getRiskAssessments');
  const result = await query(
    'select * from risk_assessments where tenant_id = $1 and risk_id = $2 order by round',
    [tenantId, riskId]
  );
  return result.rows;
}

/** Append an acceptance receipt pinned to an assessment round. */
async function addRiskAcceptance(tenantId, { riskId, round, acceptorEmail, notes }) {
  requireTenant(tenantId, 'addRiskAcceptance');
  const result = await query(`
    insert into risk_acceptances (tenant_id, risk_id, round, acceptor_email, notes)
    values ($1, $2, $3, $4, $5)
    returning *
  `, [tenantId, riskId, round, acceptorEmail, notes ?? null]);
  return result.rows[0];
}

async function getRiskAcceptances(tenantId, riskId) {
  requireTenant(tenantId, 'getRiskAcceptances');
  const result = await query(
    'select * from risk_acceptances where tenant_id = $1 and risk_id = $2 order by created_at, id',
    [tenantId, riskId]
  );
  return result.rows;
}

async function logRiskEvent({ tenantId, riskId, event, actorEmail, metadata }) {
  requireTenant(tenantId, 'logRiskEvent');
  await query(`
    insert into risk_events (tenant_id, risk_id, event, actor_email, metadata)
    values ($1, $2, $3, $4, $5)
  `, [tenantId, riskId, event, actorEmail ?? null, metadata ? JSON.stringify(metadata) : null]);
  await appendAuditEvent({
    tenantId, actorEmail, action: event, objectType: 'risk', objectId: riskId, metadata,
  });
}

// ─── Audit event spine ────────────────────────────────────────────────────────
// The cross-module, append-only, hash-chained ledger (see src/audit/spine.js
// and the schema comments). logChange / logEvidenceEvent / logRiskEvent feed it
// automatically; future modules may call appendAuditEvent directly.

// Advisory-lock namespace for per-tenant chain serialisation (arbitrary but
// stable — must not collide with other advisory-lock users in this app; there
// are none today).
const AUDIT_LOCK_NS = 7501;

/**
 * Append one event to the tenant's hash chain.
 *
 * Serialised per tenant with a transaction-scoped advisory lock so concurrent
 * writers can't both chain onto the same prev_hash. occurred_at is set here
 * (not by a column default) because its exact ISO value is part of the hash.
 *
 * Failures propagate: an action isn't complete until its evidence is recorded.
 */
async function appendAuditEvent({ tenantId, actorEmail, action, objectType, objectId, metadata }) {
  requireTenant(tenantId, 'appendAuditEvent');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('select pg_advisory_xact_lock($1, $2)', [AUDIT_LOCK_NS, Number(tenantId)]);
    const last = await client.query(
      'select event_hash from audit_events where tenant_id = $1 order by id desc limit 1',
      [tenantId]
    );
    const prevHash   = last.rows[0]?.event_hash || spine.GENESIS;
    const occurredAt = new Date().toISOString();
    const event = {
      tenantId, occurredAt,
      actorEmail: actorEmail ?? null,
      action, objectType, objectId,
      metadata: metadata ?? null,
    };
    const eventHash = spine.computeEventHash(prevHash, event);
    const result = await client.query(`
      insert into audit_events
        (tenant_id, occurred_at, actor_email, action, object_type, object_id, metadata, prev_hash, event_hash)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      returning *
    `, [
      tenantId, occurredAt, event.actorEmail, action, objectType, objectId,
      metadata ? JSON.stringify(metadata) : null, prevHash, eventHash,
    ]);
    await client.query('COMMIT');
    return result.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * List spine events, latest first. Filterable by object and action.
 * @param {object} [opts] - { objectType, objectId, action, limit }
 */
async function getAuditEvents(tenantId, { objectType, objectId, action, limit } = {}) {
  requireTenant(tenantId, 'getAuditEvents');
  const where  = ['tenant_id = $1'];
  const params = [tenantId];
  if (objectType) { params.push(objectType); where.push(`object_type = $${params.length}`); }
  if (objectId)   { params.push(objectId);   where.push(`object_id   = $${params.length}`); }
  if (action)     { params.push(action);     where.push(`action      = $${params.length}`); }
  const cap = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
  const result = await query(
    `select * from audit_events where ${where.join(' and ')} order by id desc limit ${cap}`,
    params
  );
  return result.rows;
}

// ─── Access Reviews ───────────────────────────────────────────────────────────
// A review is a campaign over LINES (subject × resource); the reviewer decides
// each line and then ATTESTS the whole list — the attestation is the
// append-only receipt. Line decisions are working state while the review is
// OPEN; the receipt pins the final counts.

async function allocateAccessReviewId(tenantId) {
  requireTenant(tenantId, 'allocateAccessReviewId');
  const year = new Date().getFullYear();
  const result = await query(`
    insert into access_review_id_sequence (tenant_id, year, last_sequence)
    values ($1, $2, 1)
    on conflict (tenant_id, year) do update
      set last_sequence = access_review_id_sequence.last_sequence + 1
    returning last_sequence
  `, [tenantId, year]);
  const seq = String(result.rows[0].last_sequence).padStart(3, '0');
  return `ARV-${year}-${seq}`;
}

/** Create the review and its initial lines atomically. */
async function createAccessReview(data, lines) {
  requireTenant(data.tenant_id, 'createAccessReview');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`
      insert into access_reviews (
        tenant_id, review_id, title, system, description,
        reviewer_email, due_date, next_review_date, created_by
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      returning *
    `, [
      data.tenant_id, data.review_id, data.title, data.system, data.description ?? null,
      data.reviewer_email, data.due_date ?? null, data.next_review_date ?? null, data.created_by,
    ]);
    for (const line of lines) {
      await client.query(`
        insert into access_review_lines (tenant_id, review_id, subject, resource, access_detail)
        values ($1, $2, $3, $4, $5)
      `, [data.tenant_id, data.review_id, line.subject, line.resource, line.access_detail ?? null]);
    }
    await client.query('COMMIT');
    return result.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getAccessReviewById(tenantId, reviewId) {
  requireTenant(tenantId, 'getAccessReviewById');
  const result = await query(
    'select * from access_reviews where tenant_id = $1 and review_id = $2',
    [tenantId, reviewId]
  );
  return result.rows[0] || null;
}

/** Reviews with per-review line/decision counts for the list + dashboard. */
async function listAccessReviews({ tenantId, status, limit = 500, offset = 0 } = {}) {
  requireTenant(tenantId, 'listAccessReviews');
  const clauses = ['r.tenant_id = $1'];
  const params  = [tenantId];
  if (status) { params.push(status); clauses.push(`r.status = $${params.length}`); }
  params.push(limit, offset);
  const result = await query(`
    select
      r.*,
      count(l.id)::int                                    as lines_total,
      count(l.decision)::int                              as lines_decided,
      count(*) filter (where l.decision = 'flag')::int    as lines_flag,
      count(*) filter (where l.decision = 'remove')::int  as lines_remove
    from access_reviews r
    left join access_review_lines l
      on l.tenant_id = r.tenant_id and l.review_id = r.review_id
    where ${clauses.join(' and ')}
    group by r.id
    order by r.review_id desc
    limit $${params.length - 1} offset $${params.length}
  `, params);
  return result.rows;
}

async function listAccessReviewLines(tenantId, reviewId) {
  requireTenant(tenantId, 'listAccessReviewLines');
  const result = await query(
    'select * from access_review_lines where tenant_id = $1 and review_id = $2 order by id',
    [tenantId, reviewId]
  );
  return result.rows;
}

async function addAccessReviewLines(tenantId, reviewId, lines) {
  requireTenant(tenantId, 'addAccessReviewLines');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const added = [];
    for (const line of lines) {
      const r = await client.query(`
        insert into access_review_lines (tenant_id, review_id, subject, resource, access_detail)
        values ($1, $2, $3, $4, $5) returning *
      `, [tenantId, reviewId, line.subject, line.resource, line.access_detail ?? null]);
      added.push(r.rows[0]);
    }
    await client.query('COMMIT');
    return added;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getAccessReviewLine(tenantId, reviewId, lineId) {
  requireTenant(tenantId, 'getAccessReviewLine');
  const result = await query(
    'select * from access_review_lines where tenant_id = $1 and review_id = $2 and id = $3',
    [tenantId, reviewId, lineId]
  );
  return result.rows[0] || null;
}

async function decideAccessReviewLine(tenantId, reviewId, lineId, { decision, note, decidedBy }) {
  requireTenant(tenantId, 'decideAccessReviewLine');
  const result = await query(`
    update access_review_lines
    set decision = $4, decision_note = $5, decided_by = $6, decided_at = now()
    where tenant_id = $1 and review_id = $2 and id = $3
    returning *
  `, [tenantId, reviewId, lineId, decision, note ?? null, decidedBy]);
  return result.rows[0] || null;
}

async function updateAccessReview(tenantId, reviewId, updates) {
  requireTenant(tenantId, 'updateAccessReview');
  const allowed = ['title', 'system', 'description', 'reviewer_email', 'due_date', 'next_review_date', 'status'];
  const fields = [];
  const params = [];
  for (const key of allowed) {
    if (updates[key] !== undefined) {
      params.push(updates[key]);
      fields.push(`${key} = $${params.length}`);
    }
  }
  if (!fields.length) return getAccessReviewById(tenantId, reviewId);
  params.push(tenantId, reviewId);
  const result = await query(`
    update access_reviews set ${fields.join(', ')}
    where tenant_id = $${params.length - 1} and review_id = $${params.length}
    returning *
  `, params);
  return result.rows[0] || null;
}

async function addAccessReviewAttestation(tenantId, data) {
  requireTenant(tenantId, 'addAccessReviewAttestation');
  const result = await query(`
    insert into access_review_attestations
      (tenant_id, review_id, reviewer_email, notes, lines_total, lines_keep, lines_flag, lines_remove)
    values ($1,$2,$3,$4,$5,$6,$7,$8)
    returning *
  `, [
    tenantId, data.review_id, data.reviewer_email, data.notes ?? null,
    data.lines_total, data.lines_keep, data.lines_flag, data.lines_remove,
  ]);
  return result.rows[0];
}

async function getAccessReviewAttestations(tenantId, reviewId) {
  requireTenant(tenantId, 'getAccessReviewAttestations');
  const result = await query(
    'select * from access_review_attestations where tenant_id = $1 and review_id = $2 order by created_at, id',
    [tenantId, reviewId]
  );
  return result.rows;
}

/** Every line in the tenant, joined with its review — the audit pack's export. */
async function listAllAccessReviewLines(tenantId) {
  requireTenant(tenantId, 'listAllAccessReviewLines');
  const result = await query(`
    select l.*, r.title, r.system, r.status as review_status
    from access_review_lines l
    join access_reviews r on r.tenant_id = l.tenant_id and r.review_id = l.review_id
    where l.tenant_id = $1
    order by l.review_id, l.id
  `, [tenantId]);
  return result.rows;
}

/** Every attestation receipt in the tenant — the audit pack's export. */
async function listAccessReviewAttestations(tenantId) {
  requireTenant(tenantId, 'listAccessReviewAttestations');
  const result = await query(`
    select a.*, r.title, r.system
    from access_review_attestations a
    join access_reviews r on r.tenant_id = a.tenant_id and r.review_id = a.review_id
    where a.tenant_id = $1
    order by a.review_id, a.created_at
  `, [tenantId]);
  return result.rows;
}

/** Every assessment round in the tenant, joined with its risk title — the
 *  audit pack's review history. */
async function listRiskAssessments(tenantId) {
  requireTenant(tenantId, 'listRiskAssessments');
  const result = await query(`
    select a.*, r.title
    from risk_assessments a
    join risks r on r.tenant_id = a.tenant_id and r.risk_id = a.risk_id
    where a.tenant_id = $1
    order by a.risk_id, a.round
  `, [tenantId]);
  return result.rows;
}

/** Every acceptance receipt in the tenant, joined with its risk title. */
async function listRiskAcceptances(tenantId) {
  requireTenant(tenantId, 'listRiskAcceptances');
  const result = await query(`
    select y.*, r.title
    from risk_acceptances y
    join risks r on r.tenant_id = y.tenant_id and r.risk_id = y.risk_id
    where y.tenant_id = $1
    order by y.risk_id, y.round, y.created_at
  `, [tenantId]);
  return result.rows;
}

/** Tenant-wide count of unacknowledged distributions (the outstanding view). */
async function countOutstandingAcceptances(tenantId) {
  requireTenant(tenantId, 'countOutstandingAcceptances');
  const result = await query(
    'select count(*)::int as n from outstanding_acceptances where tenant_id = $1',
    [tenantId]
  );
  return result.rows[0].n;
}

/** The tenant's full chain, oldest first — the input shape verifyChain expects. */
async function getAuditChain(tenantId) {
  requireTenant(tenantId, 'getAuditChain');
  const result = await query(
    'select * from audit_events where tenant_id = $1 order by id asc',
    [tenantId]
  );
  return result.rows;
}

async function getRiskEvents(tenantId, riskId) {
  requireTenant(tenantId, 'getRiskEvents');
  const result = await query(
    'select * from risk_events where tenant_id = $1 and risk_id = $2 order by created_at, id',
    [tenantId, riskId]
  );
  return result.rows;
}

// ─── Vendor Assessments ───────────────────────────────────────────────────────
// A vendor is a risk until understood: append-only 5×5 assessment rounds, and
// a DECISION receipt (approve OR decline) pinned to the round it judged.
// Decision state is DERIVED (latest decision covering the latest round),
// never stored.

async function allocateVendorId(tenantId) {
  requireTenant(tenantId, 'allocateVendorId');
  const year = new Date().getFullYear();
  const result = await query(`
    insert into vendor_id_sequence (tenant_id, year, last_sequence)
    values ($1, $2, 1)
    on conflict (tenant_id, year) do update
      set last_sequence = vendor_id_sequence.last_sequence + 1
    returning last_sequence
  `, [tenantId, year]);
  const seq = String(result.rows[0].last_sequence).padStart(3, '0');
  return `VEN-${year}-${seq}`;
}

async function createVendor(data) {
  requireTenant(data.tenant_id, 'createVendor');
  const result = await query(`
    insert into vendors (
      tenant_id, vendor_id, name, description, category, tags, tier, data_scope,
      owner_email, approver_email, next_review_date,
      policy_ids, evidence_ids, risk_ids, created_by
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    returning *
  `, [
    data.tenant_id, data.vendor_id, data.name, data.description ?? null,
    data.category ?? null, data.tags ?? [], data.tier ?? 'medium', data.data_scope ?? null,
    data.owner_email, data.approver_email ?? null, data.next_review_date ?? null,
    data.policy_ids ?? [], data.evidence_ids ?? [], data.risk_ids ?? [], data.created_by,
  ]);
  return result.rows[0];
}

async function getVendorById(tenantId, vendorId) {
  requireTenant(tenantId, 'getVendorById');
  const result = await query(
    'select * from vendors where tenant_id = $1 and vendor_id = $2',
    [tenantId, vendorId]
  );
  return result.rows[0] || null;
}

/** Vendors with their latest assessment round and the decision covering it. */
async function listVendors({ tenantId, status, category, tier, limit = 500, offset = 0 } = {}) {
  requireTenant(tenantId, 'listVendors');
  const clauses = ['v.tenant_id = $1'];
  const params  = [tenantId];
  if (status)   { params.push(status);   clauses.push(`v.status = $${params.length}`); }
  if (category) { params.push(category); clauses.push(`v.category = $${params.length}`); }
  if (tier)     { params.push(tier);     clauses.push(`v.tier = $${params.length}`); }
  params.push(limit, offset);
  const result = await query(`
    select
      v.*,
      a.round,
      a.inherent_likelihood, a.inherent_impact,
      a.residual_likelihood, a.residual_impact,
      a.treatment,
      d.decision
    from vendors v
    left join lateral (
      select * from vendor_assessments x
      where x.tenant_id = v.tenant_id and x.vendor_id = v.vendor_id
      order by x.round desc limit 1
    ) a on true
    left join lateral (
      select decision from vendor_decisions y
      where y.tenant_id = v.tenant_id and y.vendor_id = v.vendor_id and y.round = a.round
      order by y.created_at desc limit 1
    ) d on true
    where ${clauses.join(' and ')}
    order by v.vendor_id desc
    limit $${params.length - 1} offset $${params.length}
  `, params);
  return result.rows;
}

async function updateVendor(tenantId, vendorId, updates) {
  requireTenant(tenantId, 'updateVendor');
  const allowed = [
    'name', 'description', 'category', 'tags', 'tier', 'data_scope',
    'owner_email', 'approver_email', 'next_review_date',
    'policy_ids', 'evidence_ids', 'risk_ids', 'status',
  ];
  const fields = [];
  const params = [];
  for (const key of allowed) {
    if (updates[key] !== undefined) {
      params.push(updates[key]);
      fields.push(`${key} = $${params.length}`);
    }
  }
  if (!fields.length) return getVendorById(tenantId, vendorId);
  params.push(tenantId, vendorId);
  const result = await query(`
    update vendors set ${fields.join(', ')}
    where tenant_id = $${params.length - 1} and vendor_id = $${params.length}
    returning *
  `, params);
  return result.rows[0] || null;
}

/** Append the next assessment round (round number derived atomically). */
async function addVendorAssessment(tenantId, {
  vendorId, inherentLikelihood, inherentImpact, residualLikelihood, residualImpact,
  treatment, treatmentNotes, assessedBy,
}) {
  requireTenant(tenantId, 'addVendorAssessment');
  const result = await query(`
    insert into vendor_assessments (
      tenant_id, vendor_id, round,
      inherent_likelihood, inherent_impact, residual_likelihood, residual_impact,
      treatment, treatment_notes, assessed_by
    )
    select $1, $2, coalesce(max(x.round), 0) + 1, $3, $4, $5, $6, $7, $8, $9
    from vendor_assessments x
    where x.tenant_id = $1 and x.vendor_id = $2
    returning *
  `, [
    tenantId, vendorId,
    inherentLikelihood, inherentImpact, residualLikelihood, residualImpact,
    treatment, treatmentNotes ?? null, assessedBy,
  ]);
  return result.rows[0];
}

async function getVendorAssessments(tenantId, vendorId) {
  requireTenant(tenantId, 'getVendorAssessments');
  const result = await query(
    'select * from vendor_assessments where tenant_id = $1 and vendor_id = $2 order by round',
    [tenantId, vendorId]
  );
  return result.rows;
}

/** Append a decision receipt (approve or decline) pinned to an assessment round. */
async function addVendorDecision(tenantId, { vendorId, round, decision, deciderEmail, notes }) {
  requireTenant(tenantId, 'addVendorDecision');
  const result = await query(`
    insert into vendor_decisions (tenant_id, vendor_id, round, decision, decider_email, notes)
    values ($1, $2, $3, $4, $5, $6)
    returning *
  `, [tenantId, vendorId, round, decision, deciderEmail, notes ?? null]);
  return result.rows[0];
}

async function getVendorDecisions(tenantId, vendorId) {
  requireTenant(tenantId, 'getVendorDecisions');
  const result = await query(
    'select * from vendor_decisions where tenant_id = $1 and vendor_id = $2 order by created_at, id',
    [tenantId, vendorId]
  );
  return result.rows;
}

async function logVendorEvent({ tenantId, vendorId, event, actorEmail, metadata }) {
  requireTenant(tenantId, 'logVendorEvent');
  await query(`
    insert into vendor_events (tenant_id, vendor_id, event, actor_email, metadata)
    values ($1, $2, $3, $4, $5)
  `, [tenantId, vendorId, event, actorEmail ?? null, metadata ? JSON.stringify(metadata) : null]);
  await appendAuditEvent({
    tenantId, actorEmail, action: event, objectType: 'vendor', objectId: vendorId, metadata,
  });
}

async function getVendorEvents(tenantId, vendorId) {
  requireTenant(tenantId, 'getVendorEvents');
  const result = await query(
    'select * from vendor_events where tenant_id = $1 and vendor_id = $2 order by created_at, id',
    [tenantId, vendorId]
  );
  return result.rows;
}

/** Every assessment round in the tenant, joined with its vendor name — the
 *  audit pack's review history. */
async function listVendorAssessments(tenantId) {
  requireTenant(tenantId, 'listVendorAssessments');
  const result = await query(`
    select a.*, v.name
    from vendor_assessments a
    join vendors v on v.tenant_id = a.tenant_id and v.vendor_id = a.vendor_id
    where a.tenant_id = $1
    order by a.vendor_id, a.round
  `, [tenantId]);
  return result.rows;
}

/** Every decision receipt in the tenant, joined with its vendor name. */
async function listVendorDecisions(tenantId) {
  requireTenant(tenantId, 'listVendorDecisions');
  const result = await query(`
    select d.*, v.name
    from vendor_decisions d
    join vendors v on v.tenant_id = d.tenant_id and v.vendor_id = d.vendor_id
    where d.tenant_id = $1
    order by d.vendor_id, d.round, d.created_at
  `, [tenantId]);
  return result.rows;
}

/** Subset of the given risk ids that actually exist in the tenant. */
async function filterExistingRiskIds(tenantId, ids) {
  requireTenant(tenantId, 'filterExistingRiskIds');
  if (!ids?.length) return [];
  const result = await query(
    'select risk_id from risks where tenant_id = $1 and risk_id = any($2)',
    [tenantId, ids]
  );
  return result.rows.map(r => r.risk_id);
}

// ─── Obligations Register ─────────────────────────────────────────────────────
// The Understanding layer: commitments named by their source, linked to the
// risks, policies, and evidence that answer them. Retired, never deleted.

async function allocateObligationId(tenantId) {
  requireTenant(tenantId, 'allocateObligationId');
  const year = new Date().getFullYear();
  const result = await query(`
    insert into obligation_id_sequence (tenant_id, year, last_sequence)
    values ($1, $2, 1)
    on conflict (tenant_id, year) do update
      set last_sequence = obligation_id_sequence.last_sequence + 1
    returning last_sequence
  `, [tenantId, year]);
  const seq = String(result.rows[0].last_sequence).padStart(3, '0');
  return `OBL-${year}-${seq}`;
}

async function createObligation(data) {
  requireTenant(data.tenant_id, 'createObligation');
  const result = await query(`
    insert into obligations (
      tenant_id, obligation_id, title, description, source_type, source_name,
      source_ref, owner_email, next_review_date,
      policy_ids, risk_ids, evidence_ids, created_by
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    returning *
  `, [
    data.tenant_id, data.obligation_id, data.title, data.description ?? null,
    data.source_type, data.source_name, data.source_ref ?? null,
    data.owner_email, data.next_review_date ?? null,
    data.policy_ids ?? [], data.risk_ids ?? [], data.evidence_ids ?? [], data.created_by,
  ]);
  return result.rows[0];
}

async function getObligationById(tenantId, obligationId) {
  requireTenant(tenantId, 'getObligationById');
  const result = await query(
    'select * from obligations where tenant_id = $1 and obligation_id = $2',
    [tenantId, obligationId]
  );
  return result.rows[0] || null;
}

async function listObligations({ tenantId, status, sourceType, limit = 500, offset = 0 } = {}) {
  requireTenant(tenantId, 'listObligations');
  const clauses = ['tenant_id = $1'];
  const params  = [tenantId];
  if (status)     { params.push(status);     clauses.push(`status = $${params.length}`); }
  if (sourceType) { params.push(sourceType); clauses.push(`source_type = $${params.length}`); }
  params.push(limit, offset);
  const result = await query(`
    select * from obligations
    where ${clauses.join(' and ')}
    order by obligation_id desc
    limit $${params.length - 1} offset $${params.length}
  `, params);
  return result.rows;
}

async function updateObligation(tenantId, obligationId, updates) {
  requireTenant(tenantId, 'updateObligation');
  const allowed = [
    'title', 'description', 'source_type', 'source_name', 'source_ref',
    'owner_email', 'next_review_date',
    'policy_ids', 'risk_ids', 'evidence_ids', 'status',
  ];
  const fields = [];
  const params = [];
  for (const key of allowed) {
    if (updates[key] !== undefined) {
      params.push(updates[key]);
      fields.push(`${key} = $${params.length}`);
    }
  }
  if (!fields.length) return getObligationById(tenantId, obligationId);
  params.push(tenantId, obligationId);
  const result = await query(`
    update obligations set ${fields.join(', ')}
    where tenant_id = $${params.length - 1} and obligation_id = $${params.length}
    returning *
  `, params);
  return result.rows[0] || null;
}

async function logObligationEvent({ tenantId, obligationId, event, actorEmail, metadata }) {
  requireTenant(tenantId, 'logObligationEvent');
  await query(`
    insert into obligation_events (tenant_id, obligation_id, event, actor_email, metadata)
    values ($1, $2, $3, $4, $5)
  `, [tenantId, obligationId, event, actorEmail ?? null, metadata ? JSON.stringify(metadata) : null]);
  await appendAuditEvent({
    tenantId, actorEmail, action: event, objectType: 'obligation', objectId: obligationId, metadata,
  });
}

async function getObligationEvents(tenantId, obligationId) {
  requireTenant(tenantId, 'getObligationEvents');
  const result = await query(
    'select * from obligation_events where tenant_id = $1 and obligation_id = $2 order by created_at, id',
    [tenantId, obligationId]
  );
  return result.rows;
}

/** Obligations naming a given policy / risk / evidence item — the back-link
 *  ("why does this exist?") shown on the linked object's detail page. */
async function getObligationsLinkedTo(tenantId, kind, id) {
  requireTenant(tenantId, 'getObligationsLinkedTo');
  const col = { policy: 'policy_ids', risk: 'risk_ids', evidence: 'evidence_ids' }[kind];
  if (!col) throw new Error(`getObligationsLinkedTo: unknown kind '${kind}'`);
  const result = await query(`
    select obligation_id, title, source_type, source_name, source_ref, status
    from obligations
    where tenant_id = $1 and $2 = any(${col})
    order by obligation_id
  `, [tenantId, id]);
  return result.rows;
}

async function healthCheck() {
  const result = await query('select now() as time');
  return result.rows[0];
}

module.exports = {
  // App users
  getAppUserById,
  getAppUserByEmail,
  rebindAppUserByEmail,
  listAppUsersByTenant,
  upsertAppUser,
  deleteAppUser,
  updateAppUserRole,
  deleteAppUserInTenant,
  countTenantAdmins,
  // Tenants
  getTenantById,
  getTenantBySlug,
  getTenantByCustomDomain,
  updateTenantCadence,
  updateTenantAppearance,
  // Distribution groups
  listGroups,
  getGroupWithMembers,
  createGroup,
  updateGroup,
  deleteGroup,
  // Policy IDs
  allocatePolicyId,
  // Policies
  createPolicy,
  getPolicyById,
  listPolicies,
  updatePolicy,
  incrementAcknowledgementCount,
  // Authorisation routes
  setAuthorisationRoute,
  setAuthorisers,
  recordApproval,
  recordReturn,
  getAuthorisers,
  getRouteState,
  recordExecDecision,
  getExecDecision,
  recordOwnerDecision,
  getOwnerDecision,
  // Acknowledgements
  createAcknowledgements,
  recordAcknowledgement,
  getAcknowledgementByToken,
  recordAttestation,
  getAcknowledgements,
  getOutstandingRecipients,
  markReminderSent,
  // Notifications
  recordNotification,
  getNotificationByMessageId,
  // Review activity
  addComment,
  getComments,
  recordRead,
  getReads,
  // Changelog
  logChange,
  getChangelog,
  // Evidence Locker
  allocateEvidenceId,
  createEvidenceItem,
  getEvidenceById,
  listEvidence,
  updateEvidenceItem,
  logEvidenceEvent,
  getEvidenceEvents,
  listApprovalReceipts,
  // Risk Register
  allocateRiskId,
  createRisk,
  getRiskById,
  listRisks,
  updateRisk,
  addRiskAssessment,
  getRiskAssessments,
  addRiskAcceptance,
  getRiskAcceptances,
  logRiskEvent,
  getRiskEvents,

  appendAuditEvent,
  getAuditEvents,
  getAuditChain,
  countOutstandingAcceptances,

  getRisksLinkedToPolicy,
  getRisksLinkedToEvidence,
  filterExistingPolicyIds,
  filterExistingEvidenceIds,
  listRiskAssessments,
  listRiskAcceptances,

  allocateAccessReviewId,
  createAccessReview,
  getAccessReviewById,
  listAccessReviews,
  listAccessReviewLines,
  addAccessReviewLines,
  getAccessReviewLine,
  decideAccessReviewLine,
  updateAccessReview,
  addAccessReviewAttestation,
  getAccessReviewAttestations,
  listAccessReviewAttestations,
  listAllAccessReviewLines,
  // Vendor Assessments
  allocateVendorId,
  createVendor,
  getVendorById,
  listVendors,
  updateVendor,
  addVendorAssessment,
  getVendorAssessments,
  addVendorDecision,
  getVendorDecisions,
  logVendorEvent,
  getVendorEvents,
  listVendorAssessments,
  listVendorDecisions,
  filterExistingRiskIds,
  // Obligations Register
  allocateObligationId,
  createObligation,
  getObligationById,
  listObligations,
  updateObligation,
  logObligationEvent,
  getObligationEvents,
  getObligationsLinkedTo,
  // Scheduler
  getPoliciesForReviewCheck,
  getPoliciesWithOutstandingAcceptances,
  markAdvanceNoticeSent,
  markEscalationSent,
  // Health
  healthCheck,
};
