/**
 * howldr ProofWorks
 * Per-policy access middlewares
 *
 * Tenant-wide role checks live in middleware/auth.js (requireRole).
 * This file handles "is this user related to THIS policy?" — middlewares
 * that look up the policy + authoriser list and enforce
 * owner / authoriser / read access.
 *
 *   requirePolicyOwner()      — admin/howldr_support OR policy.owner_email
 *                                matches req.user.email.
 *   requirePolicyAuthoriser() — admin/howldr_support OR req.user.email is
 *                                in policy_authorisers for this policy.
 *   requirePolicyReadAccess() — admin/governance_lead/viewer/howldr_support
 *                                OR (owner if their email matches) OR
 *                                (authoriser if they're on the list) OR
 *                                (acceptor if they're the policy's exec). Pass
 *                                { staff: true } on routes the workforce may
 *                                read — granted only while the policy is
 *                                ACTIVE. Routes without the flag (comments,
 *                                reads, acknowledgements, changelog) stay
 *                                closed to staff: an employee reads the
 *                                published policy, not the workflow around it.
 *
 * Side effect: when these middlewares load the policy, they attach it to
 * req.policy so the route handler doesn't have to re-fetch. Routes can
 * still call db.getPolicyById themselves; req.policy is just a cache.
 */

const db = require('../db/db');

const CROSS_TENANT = new Set(['admin', 'howldr_support']);
const TENANT_WIDE_READ = new Set(['admin', 'governance_lead', 'viewer', 'howldr_support']);

async function loadPolicy(req, res) {
  if (req.policy) return req.policy;
  const policy = await db.getPolicyById(req.tenant.id, req.params.id);
  if (!policy) {
    res.status(404).json({ error: 'Policy not found' });
    return null;
  }
  req.policy = policy;
  return policy;
}

function requirePolicyOwner() {
  return async (req, res, next) => {
    try {
      const policy = await loadPolicy(req, res);
      if (!policy) return;
      if (CROSS_TENANT.has(req.user.role)) return next();
      if (policy.owner_email !== req.user.email) {
        return res.status(403).json({ error: 'Only the policy owner can perform this action' });
      }
      next();
    } catch (err) { next(err); }
  };
}

function requirePolicyAuthoriser() {
  return async (req, res, next) => {
    try {
      const policy = await loadPolicy(req, res);
      if (!policy) return;
      if (CROSS_TENANT.has(req.user.role)) return next();
      const auths = await db.getAuthorisers(req.tenant.id, req.params.id);
      if (!auths.some(a => a.email === req.user.email)) {
        return res.status(403).json({ error: 'Only an assigned authoriser can perform this action' });
      }
      next();
    } catch (err) { next(err); }
  };
}

function requirePolicyExec() {
  return async (req, res, next) => {
    try {
      const policy = await loadPolicy(req, res);
      if (!policy) return;
      if (CROSS_TENANT.has(req.user.role)) return next();
      if (!policy.exec_email || policy.exec_email !== req.user.email) {
        return res.status(403).json({ error: 'Only the assigned executive can perform this action' });
      }
      next();
    } catch (err) { next(err); }
  };
}

function requirePolicyReadAccess({ staff = false } = {}) {
  return async (req, res, next) => {
    try {
      const policy = await loadPolicy(req, res);
      if (!policy) return;
      if (TENANT_WIDE_READ.has(req.user.role)) return next();
      if (req.user.role === 'staff') {
        if (staff && policy.status === 'ACTIVE') return next();
        return res.status(403).json({ error: 'Forbidden — staff see published policies only' });
      }
      if (req.user.role === 'owner' && policy.owner_email === req.user.email) return next();
      if (req.user.role === 'authoriser') {
        const auths = await db.getAuthorisers(req.tenant.id, req.params.id);
        if (auths.some(a => a.email === req.user.email)) return next();
      }
      // Acceptors (named signers) read the policies awaiting their executive
      // sign-off — assignment is by exec_email, mirroring owner/authoriser.
      if (req.user.role === 'acceptor' && policy.exec_email === req.user.email) return next();
      return res.status(403).json({ error: 'Forbidden — no access to this policy' });
    } catch (err) { next(err); }
  };
}

module.exports = { requirePolicyOwner, requirePolicyAuthoriser, requirePolicyExec, requirePolicyReadAccess };
