/**
 * Create a new tenant and invite its first admin.
 *
 * Usage:
 *   railway run npm run create-tenant -- \
 *     --slug=acme --name="Acme Corp" --admin-email=patrick@acme.com \
 *     [--lf-share=acme-policies]              # default: {slug}-policies
 *     [--custom-domain=policies.acme.com]
 *
 * What happens:
 *   1. Inserts a tenants row (errors if slug already exists).
 *   2. Generates a Supabase invite link for the admin (no email sent —
 *      forward the link via whatever channel you want).
 *   3. Pre-creates the app_users row for that admin so the moment they
 *      sign in via the link, requireUser() / requireSameTenant() / role
 *      gates work.
 *
 * Idempotency: if the admin email already exists in Supabase Auth, the
 * Supabase user is reused and bound to this tenant as admin.
 */

const {
  adminClient,
  pgPool,
  parseArgs,
  getTenantBySlug,
  generateInviteOrReuse,
} = require('./_admin-client');

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const slug         = args.slug;
  const name         = args.name;
  const adminEmail   = args['admin-email'];
  const lfShare      = args['lf-share']      || (slug ? `${slug}-policies` : null);
  const customDomain = args['custom-domain'] || null;

  if (!slug || !name || !adminEmail) {
    console.error('required: --slug --name --admin-email');
    console.error('optional: --lf-share (default {slug}-policies)  --custom-domain');
    process.exit(1);
  }

  const pool = pgPool();
  const client = await pool.connect();
  try {
    // Cheap conflict check before we burn a Supabase invite.
    const existing = await client.query('select id from tenants where slug = $1', [slug]);
    if (existing.rows[0]) {
      console.error(`Tenant '${slug}' already exists (id=${existing.rows[0].id}). Aborting.`);
      process.exit(1);
    }

    // Supabase first — if this fails (bad URL, bad key), nothing in the DB
    // changes and we don't leave an orphan tenant row behind.
    const supabase = adminClient();
    const { user, actionLink, reused } = await generateInviteOrReuse(supabase, adminEmail, {
      tenant_slug: slug, role: 'admin',
    });

    // Now both inserts in a single DB transaction.
    let tenant;
    try {
      await client.query('BEGIN');
      const inserted = await client.query(`
        insert into tenants (slug, name, lf_share_name, custom_domain)
        values ($1, $2, $3, $4)
        returning *
      `, [slug, name, lfShare, customDomain]);
      tenant = inserted.rows[0];

      await client.query(`
        insert into app_users (id, email, tenant_id, role)
        values ($1, $2, $3, 'admin')
        on conflict (id) do update
          set email = excluded.email, tenant_id = excluded.tenant_id, role = excluded.role
      `, [user.id, adminEmail, tenant.id]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }

    console.log(`✓ tenant created: id=${tenant.id} slug=${tenant.slug} name="${tenant.name}"`);
    console.log(`  lf_share_name=${tenant.lf_share_name}`);
    if (tenant.custom_domain) console.log(`  custom_domain=${tenant.custom_domain}`);

    if (reused) {
      console.log(`✓ admin re-bound (existing Supabase user): ${adminEmail}  id=${user.id}`);
      console.log(`  No new invite link — they sign in normally and will land in this tenant.`);
    } else {
      console.log(`✓ admin invited: ${adminEmail}  id=${user.id}`);
      console.log(`  Action link (forward to admin to complete sign-in):`);
      console.log(`  ${actionLink}`);
    }
  } finally {
    client.release();
    await pool.end();
  }
})().catch(e => { console.error('create-tenant failed:', e.message); process.exit(1); });
