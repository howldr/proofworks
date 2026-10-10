/**
 * howldr ProofWorks
 * API router
 */

const express = require('express');
const router  = express.Router();

const policies      = require('./policies');
const evidence      = require('./evidence');
const risks         = require('./risks');
const accessReviews = require('./access-reviews');
const vendors       = require('./vendors');
const obligations   = require('./obligations');
const audit         = require('./audit');
const dashboard     = require('./dashboard');
const users    = require('./users');
const settings = require('./settings');
const tasks    = require('./tasks');
const groups   = require('./groups');
const attest   = require('./attest');
const db = require('../db/db');
const { handleReceiptWebhook } = require('../notifications/receipts');
const { handleRegisterExport } = require('./register-export');
const { requireTenant } = require('../middleware/tenant');
const { requireUser, requireRole, requireSameTenant } = require('../middleware/auth');
const { requireModule } = require('../middleware/entitlements');
const { MODULE_KEYS } = require('../modules');
const { DEFAULT_THEME } = require('../themes');

// Who am I — lets the SPA discover its role and tenant after sign-in.
// Deliberately user-gated only, not tenant-gated: the tenant slug in this
// response is what the SPA uses to build /t/{slug}/api/... URLs for
// everything else. howldr_support has no tenant → tenant: null.
router.get('/me', requireUser(), async (req, res) => {
  try {
    const { id, email, role, tenant_id } = req.user;
    const tenant = tenant_id == null ? null : await db.getTenantById(tenant_id);
    res.json({
      id,
      email,
      role,
      tenant: tenant
        ? {
            slug:        tenant.slug,
            name:        tenant.name,
            theme:       tenant.theme ?? DEFAULT_THEME,
            themeAccent: tenant.theme_accent ?? null,
            logo:        tenant.logo_data_url ?? null,
          }
        : null,
      // The SPA gates modules on this. howldr_support has no tenant but sees
      // every module.
      entitlements: tenant ? (tenant.entitlements ?? []) : MODULE_KEYS,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Policy lifecycle routes — tenant resolved, user authenticated, user belongs
// to this tenant (or is howldr_support). Per-route role + per-policy access
// gates live inside ./policies.
router.use('/policies',
  requireTenant(),
  requireUser(),
  requireSameTenant(),
  requireModule('policy_hub'),
  policies
);

// Governance modules are for the people who run the register — every role
// except staff (the workforce), who see published policies only. Acceptors
// (named signers) additionally reach the two modules that carry their
// signatures: the Risk Register and Access Reviews.
const GOVERNANCE_ROLES = ['admin', 'owner', 'authoriser', 'governance_lead', 'viewer', 'howldr_support'];
const SIGNER_ROLES     = [...GOVERNANCE_ROLES, 'acceptor'];

// Evidence Locker — reads open to governance roles; write/pack gates live
// inside ./evidence. Enabled separately from Policy Hub.
router.use('/evidence',
  requireTenant(),
  requireUser(),
  requireSameTenant(),
  requireRole(GOVERNANCE_ROLES),
  requireModule('evidence_locker'),
  evidence
);

// Risk Register — reads open to governance roles + acceptors (a risk's named
// acceptor signs here); write/accept gates live inside ./risks. Enabled
// separately; does not require the Evidence Locker.
router.use('/risks',
  requireTenant(),
  requireUser(),
  requireSameTenant(),
  requireRole(SIGNER_ROLES),
  requireModule('risk_register'),
  risks
);

// Tenant user management (Staff directory) — per-route role gates live inside.
router.use('/users',
  requireTenant(),
  requireUser(),
  requireSameTenant(),
  users
);

// "My tasks" — the calling user's action queue (any tenant member).
router.use('/tasks',
  requireTenant(),
  requireUser(),
  requireSameTenant(),
  tasks
);

// Distribution audiences — reads for governance roles (owners pick a group
// when distributing; staff excluded); writes gated per-route inside ./groups.
router.use('/groups',
  requireTenant(),
  requireUser(),
  requireSameTenant(),
  groups
);

// Workspace settings — read-only; admin / governance_lead / howldr_support.
router.use('/settings',
  requireTenant(),
  requireUser(),
  requireSameTenant(),
  requireRole(['admin', 'governance_lead', 'howldr_support']),
  settings
);

// Access Reviews — reads open to governance roles + acceptors (a named
// reviewer decides and attests here); write/decide/attest gates live inside
// ./access-reviews. Enabled separately. (The workforce is reviewed, it
// doesn't review — staff stay out.)
router.use('/access-reviews',
  requireTenant(),
  requireUser(),
  requireSameTenant(),
  requireRole(SIGNER_ROLES),
  requireModule('access_reviews'),
  accessReviews
);

// Vendor Assessments — reads open to governance roles; write/assess/decide
// gates live inside ./vendors. Enabled separately.
router.use('/vendors',
  requireTenant(),
  requireUser(),
  requireSameTenant(),
  requireRole(GOVERNANCE_ROLES),
  requireModule('vendor_assessments'),
  vendors
);

// Obligations Register — the Understanding layer: commitments named by their
// source, linked to what answers them. Reads open to governance roles;
// write gates live inside ./obligations. Enabled separately.
router.use('/obligations',
  requireTenant(),
  requireUser(),
  requireSameTenant(),
  requireRole(GOVERNANCE_ROLES),
  requireModule('obligations'),
  obligations
);

// Suite dashboard — cross-module "needs attention" aggregate. Core; each
// section inside is entitlement-gated, and recent_events is role-gated.
router.use('/dashboard',
  requireTenant(),
  requireUser(),
  requireSameTenant(),
  dashboard
);

// Audit event spine — the cross-module hash-chained ledger. Core (not
// module-gated): the spine exists whenever any module does. Read-only;
// audit-grade readers only.
router.use('/audit',
  requireTenant(),
  requireUser(),
  requireSameTenant(),
  requireRole(['admin', 'governance_lead', 'viewer', 'howldr_support']),
  audit
);

// Register export — admin/governance_lead/viewer can read; nobody else.
// JSON by default; ?format=csv downloads the register as CSV.
router.get('/register',
  requireTenant(),
  requireUser(),
  requireSameTenant(),
  requireRole(['admin', 'governance_lead', 'viewer', 'howldr_support']),
  handleRegisterExport
);

// Public read-and-accept — NOT tenant- or user-gated. Recipients are staff
// without accounts; the bearer token in the URL is the authorisation and
// resolves to a row that carries its own tenant.
router.use('/attest', attest);

// LiquidFiles receipt webhook — NOT tenant-gated by URL.
// Tenant is derived from the policy referenced in the receipt payload.
router.post('/webhooks/liquidfiles', express.json(), handleReceiptWebhook);

module.exports = router;
