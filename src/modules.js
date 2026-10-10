/**
 * howldr ProofWorks
 * Module registry
 *
 * The optional product surfaces. The evidence spine (append-only, version +
 * hash-pinned receipts), tenancy, auth, staff, and settings are CORE and always
 * on — they are not modules. These are the surfaces a tenant is entitled to.
 *
 * Entitlements live per-tenant (tenants.entitlements). They are product
 * configuration, not licence enforcement — the code is MIT (ADR 0004). How they
 * get set depends on who runs the deployment and is decoupled from enforcement:
 *   - howldr-hosted: set by howldr (scripts/set-entitlements.js) with the service.
 *   - self-hosted: the operator sets them with the same script.
 * Either way, requireModule() and the UI only ever read tenants.entitlements.
 */

const MODULES = {
  policy_hub:      { key: 'policy_hub',      label: 'Policy Hub' },
  evidence_locker: { key: 'evidence_locker', label: 'Evidence Locker' },
  risk_register:   { key: 'risk_register',   label: 'Risk Register' },
  access_reviews:  { key: 'access_reviews',  label: 'Access Reviews' },
  vendor_assessments: { key: 'vendor_assessments', label: 'Vendor Assessments' },
  obligations:     { key: 'obligations',     label: 'Obligations' },
};

const MODULE_KEYS = Object.keys(MODULES);

/** What a brand-new tenant is entitled to until told otherwise. Matches the
 *  tenants.entitlements column default so fresh installs and new tenants agree. */
const DEFAULT_ENTITLEMENTS = ['policy_hub'];

module.exports = { MODULES, MODULE_KEYS, DEFAULT_ENTITLEMENTS };
