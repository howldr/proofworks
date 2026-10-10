/**
 * Set (or list) a tenant's module entitlements — for howldr-hosted and self-hosted
 * deployments alike.
 *
 * Usage:
 *   railway run node scripts/set-entitlements.js                       # list all tenants
 *   railway run node scripts/set-entitlements.js <slug>               # show one tenant
 *   railway run node scripts/set-entitlements.js <slug> policy_hub,evidence_locker,risk_register,access_reviews
 *
 * Entitlements are per-tenant (tenants.entitlements). This is the way to turn
 * modules on/off for a workspace; self-hosters drop the `railway run` prefix and
 * point DATABASE_URL at their own database. Known modules come from src/modules.js.
 */

const { pgPool } = require('./_admin-client');
const { MODULE_KEYS } = require('../src/modules');

(async () => {
  const [slug, csv] = process.argv.slice(2);
  const pool = pgPool();
  try {
    if (!slug) {
      const { rows } = await pool.query('select slug, name, entitlements from tenants order by slug');
      if (!rows.length) return console.log('No tenants.');
      for (const r of rows) {
        console.log(`${r.slug.padEnd(20)} ${(r.entitlements || []).join(', ') || '(none)'}`);
      }
      return;
    }

    if (!csv) {
      const { rows } = await pool.query('select slug, name, entitlements from tenants where slug = $1', [slug]);
      if (!rows.length) { console.error(`Tenant '${slug}' not found`); process.exitCode = 1; return; }
      console.log(`${rows[0].slug}: ${(rows[0].entitlements || []).join(', ') || '(none)'}`);
      return;
    }

    const mods = Array.from(new Set(csv.split(',').map(s => s.trim()).filter(Boolean)));
    const bad = mods.filter(m => !MODULE_KEYS.includes(m));
    if (bad.length) {
      console.error(`Unknown module(s): ${bad.join(', ')}`);
      console.error(`Known modules: ${MODULE_KEYS.join(', ')}`);
      process.exitCode = 1;
      return;
    }

    const { rows } = await pool.query(
      'update tenants set entitlements = $2 where slug = $1 returning slug, entitlements',
      [slug, mods],
    );
    if (!rows.length) { console.error(`Tenant '${slug}' not found`); process.exitCode = 1; return; }
    console.log(`${rows[0].slug} → ${rows[0].entitlements.join(', ')}`);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
