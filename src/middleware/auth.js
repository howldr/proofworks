/**
 * howldr ProofWorks
 * Auth middleware (Supabase JWT verification)
 *
 *   authResolver()      — silent; verifies the Bearer JWT, looks up
 *                          app_users, attaches req.user. Missing/invalid
 *                          tokens are dropped quietly so routes that don't
 *                          need auth still work.
 *   requireUser()       — 401 if req.user not set.
 *   requireRole(roles)  — 403 if req.user.role not in roles.
 *   requireSameTenant() — 403 if req.user.tenant_id != req.tenant.id, unless
 *                          the user has the cross-tenant howldr_support role.
 *
 * Verification is keyed off the token's alg header:
 *   ES256 — Supabase's asymmetric signing keys (default for new projects);
 *           verified against the project's JWKS endpoint, cached in-process.
 *   HS256 — legacy shared secret (SUPABASE_JWT_SECRET); also what the test
 *           suite and scripts/mint-test-token.js use.
 */

const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const db  = require('../db/db');

function getJwtSecret() {
  const s = process.env.SUPABASE_JWT_SECRET;
  if (!s) throw new Error('SUPABASE_JWT_SECRET is not set');
  return s;
}

// ─── JWKS (asymmetric keys) ──────────────────────────────────────────────────

const JWKS_TTL_MS = 60 * 60 * 1000;
let jwksCache = { keys: new Map(), fetchedAt: 0 };

async function getSigningKey(kid) {
  const stale = Date.now() - jwksCache.fetchedAt > JWKS_TTL_MS;
  if (stale || !jwksCache.keys.has(kid)) {
    const base = process.env.SUPABASE_URL;
    if (!base) throw new Error('SUPABASE_URL is not set');
    const res = await fetch(`${base.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`);
    if (!res.ok) throw new Error(`JWKS fetch failed: HTTP ${res.status}`);
    const { keys } = await res.json();
    jwksCache = {
      keys: new Map(keys.map(k => [k.kid, crypto.createPublicKey({ key: k, format: 'jwk' })])),
      fetchedAt: Date.now(),
    };
  }
  const key = jwksCache.keys.get(kid);
  if (!key) throw new Error(`no JWKS key matches kid '${kid}'`);
  return key;
}

/** Exposed for tests: drop cached JWKS keys. */
function resetJwksCache() {
  jwksCache = { keys: new Map(), fetchedAt: 0 };
}

async function verifyToken(token) {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded) throw new Error('malformed token');

  if (decoded.header.alg === 'ES256') {
    const key = await getSigningKey(decoded.header.kid);
    return jwt.verify(token, key, { algorithms: ['ES256'], audience: 'authenticated' });
  }
  return jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'], audience: 'authenticated' });
}

function authResolver() {
  return async (req, _res, next) => {
    const header = req.headers.authorization || '';
    const m = header.match(/^Bearer\s+(.+)$/);
    if (!m) return next();

    try {
      const claims = await verifyToken(m[1]);
      let user = await db.getAppUserById(claims.sub);

      // Self-heal: an invite binds app_users to one Supabase user, but the
      // person's first OAuth sign-in can arrive as a different one. If the
      // sub is unknown but the email matches a row, move the row to this sub.
      // Gated on the provider having VERIFIED the email — with a multi-tenant
      // Entra app, any foreign tenant admin can put an arbitrary (unverified)
      // address on their own users, and an unverified match here would hand
      // them that row's role.
      if (!user && claims.email && claims.user_metadata?.email_verified === true) {
        user = await db.rebindAppUserByEmail(claims.email, claims.sub);
        if (user) {
          console.log(`[auth] re-bound app_user ${user.email} to new auth id ${claims.sub}`);
        }
      }

      if (user) {
        req.user       = user;
        req.authClaims = claims;
      }
    } catch (err) {
      console.warn('[auth] token rejected:', err.message);
    }
    next();
  };
}

function requireUser() {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    next();
  };
}

function requireRole(roles) {
  const allowed = new Set(Array.isArray(roles) ? roles : [roles]);
  return (req, res, next) => {
    if (!req.user || !allowed.has(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden — insufficient role' });
    }
    next();
  };
}

function requireSameTenant() {
  return (req, res, next) => {
    if (!req.tenant || !req.user) {
      return res.status(401).json({ error: 'Tenant or user not resolved' });
    }
    if (req.user.role === 'howldr_support') return next();
    // pg returns bigint as string — compare stringwise.
    if (String(req.user.tenant_id) !== String(req.tenant.id)) {
      return res.status(403).json({
        error: 'Forbidden — user is not a member of this tenant',
      });
    }
    next();
  };
}

module.exports = { authResolver, requireUser, requireRole, requireSameTenant, resetJwksCache };
