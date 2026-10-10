/**
 * howldr ProofWorks
 * Tenant resolver middleware
 *
 * Resolution cascade:
 *   1. Host header matches a tenant's custom_domain (e.g. policies.acme.com)
 *   2. URL path begins with /t/{slug}/ — strip the prefix and resolve by slug
 *   3. (Step 5+) JWT custom claim — wired when Supabase Auth lands
 *   4. Non-production only: fall back to the 'default' tenant
 *
 * The howldr app domain itself (Railway public domain, or HOWLDR_APP_DOMAIN)
 * is treated as non-tenant — it's the marketing / admin surface. Tenant URLs
 * on the app domain must use the /t/{slug}/ prefix.
 *
 * On success: req.tenant and req.tenantSource are populated.
 * On failure: req.tenant is undefined. Use requireTenant() to gate routes.
 */

const db = require('../db/db');

const CACHE_TTL_MS = 60_000;
const cache = new Map();

async function lookup(key, fetcher) {
  const entry = cache.get(key);
  if (entry && entry.expires > Date.now()) return entry.tenant;
  const tenant = await fetcher();
  cache.set(key, { tenant, expires: Date.now() + CACHE_TTL_MS });
  return tenant;
}

function isAppDomain(domain) {
  if (!domain) return true;
  if (domain.endsWith('.railway.app')) return true;
  const own = (process.env.HOWLDR_APP_DOMAIN || '').toLowerCase();
  return own && domain === own;
}

function extractPathSlug(url) {
  const m = url.match(/^\/t\/([a-z0-9][a-z0-9-]{0,62})(\/.*|$)/i);
  return m ? { slug: m[1].toLowerCase(), rest: m[2] || '/' } : null;
}

function tenantResolver() {
  return async (req, res, next) => {
    try {
      const host = (req.headers.host || '').split(':')[0].toLowerCase();
      let tenant = null;
      let source = null;

      // 1. Custom domain
      if (host && !isAppDomain(host)) {
        tenant = await lookup(`domain:${host}`, () => db.getTenantByCustomDomain(host));
        if (tenant) source = 'host';
      }

      // 2. Path prefix /t/{slug}/...
      if (!tenant) {
        const m = extractPathSlug(req.url);
        if (m) {
          tenant = await lookup(`slug:${m.slug}`, () => db.getTenantBySlug(m.slug));
          if (tenant) {
            source = 'path';
            req.url = m.rest;
          } else {
            // Path explicitly named a tenant that doesn't exist — fail fast
            // with a meaningful error rather than letting Express 404 on the
            // un-rewritten URL.
            return res.status(404).json({ error: `Tenant '${m.slug}' not found` });
          }
        }
      }

      // 3. JWT claim — wired in step 5 when auth lands

      // 4. Dev / non-prod fallback to default tenant
      if (!tenant && process.env.NODE_ENV !== 'production') {
        tenant = await lookup('slug:default', () => db.getTenantBySlug('default'));
        if (tenant) source = 'fallback-default';
      }

      if (tenant) {
        req.tenant       = tenant;
        req.tenantSource = source;
      }
      next();
    } catch (err) {
      console.error('[tenant] resolution failed:', err);
      next();
    }
  };
}

function requireTenant() {
  return (req, res, next) => {
    if (!req.tenant) {
      return res.status(400).json({
        error: 'Tenant required. Use a custom domain, /t/{slug}/... path prefix, or (in dev) the default tenant.',
      });
    }
    next();
  };
}

module.exports = { tenantResolver, requireTenant };
