/**
 * Mint a test Supabase-shaped JWT and seed (or update) the matching
 * app_users row in Postgres. Run with `railway run` so SUPABASE_JWT_SECRET
 * and DATABASE_URL are injected.
 *
 * Usage:
 *   railway run node scripts/mint-test-token.js \
 *     --email=test@howldr.local --tenant=default --role=admin
 *
 * Flags:
 *   --email       email for the app_users row (default: test@proofworks.local)
 *   --tenant      tenant slug (default: default; ignored when role is howldr_support)
 *   --role        admin|owner|authoriser|governance_lead|viewer|howldr_support
 *                 (default: admin)
 *   --sub         existing UUID to reuse (default: a fresh randomUUID)
 *   --ttl         minutes the token is valid (default: 60)
 *
 * Prints sub / email / token. Curl with:
 *   Authorization: Bearer <token>
 */

require('dotenv').config();
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const { Pool } = require('pg');

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=') || true]; })
);

const email      = args.email   || 'test@proofworks.local';
const tenantSlug = args.tenant  || 'default';
const role       = args.role    || 'admin';
const sub        = args.sub     || randomUUID();
const ttlMin     = parseInt(args.ttl || '60', 10);

if (!process.env.SUPABASE_JWT_SECRET) {
  console.error('SUPABASE_JWT_SECRET not set — run via `railway run`'); process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set — run via `railway run`'); process.exit(1);
}

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  try {
    let tenantId = null;
    if (role !== 'howldr_support') {
      const t = await pool.query('select id from tenants where slug = $1', [tenantSlug]);
      if (!t.rows[0]) { console.error(`tenant '${tenantSlug}' not found`); process.exit(1); }
      tenantId = t.rows[0].id;
    }

    await pool.query(`
      insert into app_users (id, email, tenant_id, role)
      values ($1, $2, $3, $4)
      on conflict (id) do update
        set email = excluded.email,
            tenant_id = excluded.tenant_id,
            role = excluded.role
    `, [sub, email, tenantId, role]);

    const exp = Math.floor(Date.now() / 1000) + ttlMin * 60;
    const token = jwt.sign({
      sub, email,
      aud:  'authenticated',
      role: 'authenticated', // Supabase's auth.users.role; our app role is in app_users
      iss:  'supabase',
      exp,
    }, process.env.SUPABASE_JWT_SECRET, { algorithm: 'HS256' });

    console.log(`sub:    ${sub}`);
    console.log(`email:  ${email}`);
    console.log(`tenant: ${tenantSlug} (id=${tenantId ?? 'null/cross-tenant'})`);
    console.log(`role:   ${role}`);
    console.log(`exp:    ${new Date(exp * 1000).toISOString()}`);
    console.log(`token:  ${token}`);
  } finally {
    await pool.end();
  }
})().catch(e => { console.error(e.message); process.exit(1); });
