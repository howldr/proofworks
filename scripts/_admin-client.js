/**
 * Shared helpers for the bootstrap CLI scripts.
 * Run any consumer via `railway run` so DATABASE_URL, SUPABASE_URL, and
 * SUPABASE_SECRET_KEY are injected from the Railway service variables.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { Pool } = require('pg');

// Invite link generation is shared with the in-app POST /api/users route.
const { findAuthUserByEmail, generateInviteOrReuse } = require('../src/auth/admin');

function getEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`${name} is not set. Run via 'railway run' so env vars are injected.`);
    process.exit(1);
  }
  return v;
}

function adminClient() {
  return createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SECRET_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function pgPool() {
  return new Pool({
    connectionString: getEnv('DATABASE_URL'),
    ssl: { rejectUnauthorized: false },
  });
}

/** Parse `--key=value` and `--flag` (boolean) from process.argv. */
function parseArgs(argv) {
  return Object.fromEntries(
    argv
      .filter(a => a.startsWith('--'))
      .map(a => {
        const [k, ...v] = a.slice(2).split('=');
        return [k, v.join('=') || true];
      })
  );
}

async function getTenantBySlug(pool, slug) {
  const r = await pool.query('select * from tenants where slug = $1', [slug]);
  return r.rows[0] || null;
}

module.exports = {
  adminClient,
  pgPool,
  parseArgs,
  getTenantBySlug,
  findAuthUserByEmail,
  generateInviteOrReuse,
};
