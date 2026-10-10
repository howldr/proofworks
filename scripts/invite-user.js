/**
 * Invite a user to an existing tenant with a specific role, or set up a
 * cross-tenant howldr_support user.
 *
 * Usage:
 *   railway run npm run invite-user -- \
 *     --tenant=acme --email=alice@acme.com --role=owner
 *
 *   # cross-tenant support user (tenant omitted/ignored):
 *   railway run npm run invite-user -- \
 *     --email=patrick@howldr.com --role=howldr_support
 *
 * Roles: admin, owner, authoriser, governance_lead, viewer, howldr_support
 *
 * Idempotency: if the email already exists in Supabase Auth, the user is
 * re-bound to the given tenant/role (no new invite link is generated).
 */

const {
  adminClient,
  pgPool,
  parseArgs,
  getTenantBySlug,
  generateInviteOrReuse,
} = require('./_admin-client');

const VALID_ROLES = ['admin', 'owner', 'authoriser', 'governance_lead', 'viewer', 'howldr_support'];

(async () => {
  const args  = parseArgs(process.argv.slice(2));
  const slug  = args.tenant;
  const email = args.email;
  const role  = args.role;

  if (!email || !role) {
    console.error('required: --email --role  (--tenant required unless role=howldr_support)');
    console.error(`roles: ${VALID_ROLES.join(', ')}`);
    process.exit(1);
  }
  if (!VALID_ROLES.includes(role)) {
    console.error(`role must be one of: ${VALID_ROLES.join(', ')}`);
    process.exit(1);
  }
  if (role !== 'howldr_support' && !slug) {
    console.error('--tenant is required for any role except howldr_support');
    process.exit(1);
  }

  const pool = pgPool();
  try {
    let tenantId = null;
    if (role !== 'howldr_support') {
      const tenant = await getTenantBySlug(pool, slug);
      if (!tenant) {
        console.error(`Tenant '${slug}' not found.`);
        process.exit(1);
      }
      tenantId = tenant.id;
    }

    const supabase = adminClient();
    const { user, actionLink, reused } = await generateInviteOrReuse(supabase, email, {
      tenant_id:   tenantId,
      tenant_slug: slug || null,
      role,
    });

    await pool.query(`
      insert into app_users (id, email, tenant_id, role)
      values ($1, $2, $3, $4)
      on conflict (id) do update
        set email = excluded.email, tenant_id = excluded.tenant_id, role = excluded.role
    `, [user.id, email, tenantId, role]);

    console.log(`✓ app_users: id=${user.id} email=${email} tenant_id=${tenantId ?? 'cross-tenant'} role=${role}`);
    if (reused) {
      console.log(`  Existing Supabase user re-bound — no new invite link.`);
    } else {
      console.log(`  Action link (forward to user):`);
      console.log(`  ${actionLink}`);
    }
  } finally {
    await pool.end();
  }
})().catch(e => { console.error('invite-user failed:', e.message); process.exit(1); });
