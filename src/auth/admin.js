/**
 * howldr ProofWorks
 * Supabase admin (service-role) helpers
 *
 * Used by the in-app invite flow (POST /api/users) and the bootstrap CLI
 * scripts. Requires the service-role key — SUPABASE_SECRET_KEY — which is
 * NOT the same as the JWT secret used to verify tokens. The API degrades
 * gracefully when it isn't configured (invite returns 503) so the rest of
 * the app boots fine without it.
 */

const { createClient } = require('@supabase/supabase-js');

/** True when the service-role admin API can be used (URL + secret present). */
function isInviteConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
}

/**
 * Service-role Supabase client. Throws (rather than exiting) when unconfigured
 * so callers can turn it into an HTTP error instead of killing the process.
 */
function adminClient() {
  if (!isInviteConfigured()) {
    const err = new Error('Invites are not configured (SUPABASE_URL / SUPABASE_SECRET_KEY missing)');
    err.status = 503;
    throw err;
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Find an existing Supabase Auth user by email, or return null.
 * The admin API has no direct getByEmail, so paginate listUsers.
 */
async function findAuthUserByEmail(supabase, email) {
  // One page (1000) covers our scale; bump perPage if user counts grow.
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  return data.users.find(u => (u.email || '').toLowerCase() === email.toLowerCase()) || null;
}

/**
 * Generate a Supabase invite link without sending Supabase's own email
 * (ProofWorks forwards the link itself). If the address already has an auth
 * user, reuse it so the caller can (re)bind it to app_users.
 *
 * @returns {Promise<{ user: object, actionLink: string|null, reused: boolean }>}
 */
async function generateInviteOrReuse(supabase, email, metadata = {}) {
  const { data, error } = await supabase.auth.admin.generateLink({
    type:    'invite',
    email,
    options: { data: metadata },
  });
  if (error) {
    const msg = (error.message || '').toLowerCase();
    if (msg.includes('already') || msg.includes('exists') || msg.includes('registered')) {
      const existing = await findAuthUserByEmail(supabase, email);
      if (existing) return { user: existing, actionLink: null, reused: true };
    }
    throw error;
  }
  return {
    user:       data.user,
    actionLink: data.properties?.action_link || null,
    reused:     false,
  };
}

module.exports = {
  isInviteConfigured,
  adminClient,
  findAuthUserByEmail,
  generateInviteOrReuse,
};
