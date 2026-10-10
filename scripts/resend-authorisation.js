/**
 * One-off: re-send the authorisation request for a policy to its current
 * authorisers, with the latest draft document attached and the corrected
 * app link (the original June-11 emails pointed at the appliance host).
 *
 * Reads authoritative data from the DB and the draft from LiquidFiles, so it
 * never relies on stale assumptions. Run via railway run so DATABASE_URL,
 * APP_BASE_URL and LIQUIDFILES_* are injected:
 *
 *   # dry run — prints the plan, sends nothing:
 *   railway run node scripts/resend-authorisation.js POL-2026-001
 *
 *   # actually send (REAL secure messages):
 *   railway run node scripts/resend-authorisation.js POL-2026-001 send
 */

const { Pool } = require('pg');
const messages = require('../src/liquidfiles/messages');
const { listFiles, downloadFile } = require('../src/liquidfiles/folders');

function isoDaysFromNow(days) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

async function main() {
  const policyId = process.argv[2];
  const doSend = process.argv[3] === 'send';
  if (!policyId) {
    console.error('usage: railway run node scripts/resend-authorisation.js <POLICY_ID> [send]');
    process.exit(1);
  }
  for (const k of ['DATABASE_URL', 'LIQUIDFILES_BASE_URL', 'LIQUIDFILES_API_KEY']) {
    if (!process.env[k]) {
      console.error(`${k} not set — run via "railway run".`);
      process.exit(1);
    }
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    const pr = await pool.query('select * from policies where policy_id = $1', [policyId]);
    if (pr.rows.length === 0) throw new Error(`policy ${policyId} not found`);
    if (pr.rows.length > 1) throw new Error(`policy ${policyId} exists in multiple tenants — aborting`);
    const policy = pr.rows[0];

    const tr = await pool.query('select * from tenants where id = $1', [policy.tenant_id]);
    const tenant = tr.rows[0];

    const ar = await pool.query(
      'select email, approved_at from policy_authorisers where tenant_id = $1 and policy_id = $2 order by email',
      [policy.tenant_id, policyId],
    );
    const pending = ar.rows.filter(r => !r.approved_at).map(r => r.email);
    if (pending.length === 0) throw new Error('no outstanding authorisers (all have approved, or none assigned)');

    // Fetch the newest draft — the appliance now requires an attachment, and
    // the authoriser should be reviewing the actual document anyway.
    const draftsId = policy.lf_folder_id_drafts;
    if (!draftsId) throw new Error('policy has no drafts folder on the appliance');
    const files = (await listFiles(tenant.lf_share_name, draftsId)).filter(f => !f.deleted);
    if (!files.length) throw new Error('no draft document in the policy drafts folder');
    files.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const newest = files[0];
    const { buffer, contentType } = await downloadFile(tenant.lf_share_name, draftsId, newest.id);

    const expiresAt = isoDaysFromNow(14);
    const link = messages.policyUrl(policyId);

    console.log('─'.repeat(60));
    console.log(`Policy:      ${policyId} ${policy.current_version} — ${policy.title}`);
    console.log(`Tenant:      ${tenant.slug} (#${tenant.id}), share '${tenant.lf_share_name}'`);
    console.log(`Document:    ${newest.name} (${buffer.length} bytes)`);
    console.log(`Deadline:    ${expiresAt}`);
    console.log(`Link:        ${link}`);
    console.log(`Recipients:  ${pending.join(', ')}`);
    console.log('─'.repeat(60));

    if (!doSend) {
      console.log('DRY RUN — nothing sent. Re-run with `send` as the last arg to send.');
      return;
    }

    for (const email of pending) {
      try {
        const m = await messages.sendAuthorisationRequest({
          authoriserEmail: email,
          policyId,
          title:          policy.title,
          version:        policy.current_version,
          expiresAt,
          documentBuffer: buffer,
          documentName:   newest.name,
          documentType:   newest.content_type || contentType,
        });
        console.log(`  ✓ sent to ${email} — message ${m.id}`);
      } catch (e) {
        console.error(`  ✗ FAILED ${email}: ${e.message}`);
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch(e => { console.error('resend failed:', e.message); process.exit(1); });
