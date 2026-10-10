/**
 * howldr ProofWorks
 * Module entitlement gate
 *
 * requireModule(key) blocks a module's routes unless the resolved tenant is
 * entitled to it. Mount it right after requireSameTenant() on a module's router
 * (e.g. requireModule('policy_hub')). Core routes (me, settings, staff, tasks)
 * carry no gate.
 *
 * howldr_support is howldr-internal and sees every module regardless of a
 * tenant's entitlements. A tenant admin is NOT exempt — admins are bound by
 * what their workspace has enabled.
 */

const { MODULES } = require('../modules');

function requireModule(key) {
  return (req, res, next) => {
    if (req.user?.role === 'howldr_support') return next();
    const entitled = req.tenant?.entitlements || [];
    if (!entitled.includes(key)) {
      return res.status(403).json({
        error:  `The ${MODULES[key]?.label || key} module is not enabled for this workspace.`,
        code:   'module_not_enabled',
        module: key,
      });
    }
    next();
  };
}

module.exports = { requireModule };
