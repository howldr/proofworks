/**
 * howldr ProofWorks
 * Tenant user management (the Staff directory)
 *
 * Every route sits behind requireTenant + requireUser + requireSameTenant
 * (mounted in src/api/index.js). The per-route gates below decide who may
 * read vs. mutate.
 *
 *   GET    /api/users        admin / governance_lead / howldr_support — list members
 *   POST   /api/users        admin (or howldr_support) — invite { email, role }
 *   PATCH  /api/users/:id    admin (or howldr_support) — change { role }
 *   DELETE /api/users/:id    admin (or howldr_support) — remove a member
 *
 * Invites use the Supabase service-role API to mint (or reuse) an auth user
 * and return an action link that ProofWorks forwards itself. When the
 * service-role key isn't configured the invite route returns 503; reads and
 * role changes still work.
 *
 * howldr_support is a cross-tenant role and is deliberately NOT assignable
 * through this tenant-scoped API — it's provisioned via scripts/invite-user.
 */

const express = require('express');
const router  = express.Router();

const db = require('../db/db');
const { requireRole } = require('../middleware/auth');
const { isInviteConfigured, adminClient, generateInviteOrReuse } = require('../auth/admin');

const MANAGE_ROLES = ['admin', 'howldr_support'];
const READ_ROLES   = ['admin', 'governance_lead', 'howldr_support'];

// Roles a tenant admin may assign through the UI (howldr_support excluded).
// acceptor = named signer (risk acceptance, exec sign-off, review attestation);
// staff = workforce (active register only); viewer = observers (auditors,
// assessors, SIEM) with tenant-wide read — deliberately distinct categories.
const ASSIGNABLE_ROLES = ['admin', 'owner', 'authoriser', 'governance_lead', 'acceptor', 'staff', 'viewer'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trim the row down to what the UI needs (no internal columns leak). */
function publicUser(u) {
  return { id: u.id, email: u.email, role: u.role, created_at: u.created_at };
}

// ─── GET /api/users ──────────────────────────────────────────────────────────

router.get('/', requireRole(READ_ROLES), async (req, res) => {
  try {
    const users = await db.listAppUsersByTenant(req.tenant.id);
    res.json(users.map(publicUser));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── POST /api/users (invite) ────────────────────────────────────────────────

router.post('/', requireRole(MANAGE_ROLES), async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const role  = String(req.body.role  || '').trim();

    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'A valid email is required' });
    }
    if (!ASSIGNABLE_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${ASSIGNABLE_ROLES.join(', ')}` });
    }
    if (!isInviteConfigured()) {
      return res.status(503).json({
        error: 'Inviting users is not configured on this deployment. Ask howldr support to provision the account.',
      });
    }

    const tenantId = req.tenant.id;
    const supabase = adminClient();
    const { user, actionLink, reused } = await generateInviteOrReuse(supabase, email, {
      tenant_id:   tenantId,
      tenant_slug: req.tenant.slug,
      role,
    });

    const saved = await db.upsertAppUser({ id: user.id, email, tenantId, role });
    res.status(201).json({ user: publicUser(saved), actionLink, reused });
  } catch (err) {
    console.error('POST /users failed:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── PATCH /api/users/:id (change role) ──────────────────────────────────────

router.patch('/:id', requireRole(MANAGE_ROLES), async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const targetId = req.params.id;
    const role     = String(req.body.role || '').trim();

    if (!ASSIGNABLE_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${ASSIGNABLE_ROLES.join(', ')}` });
    }

    const target = await db.getAppUserById(targetId);
    if (!target || String(target.tenant_id) !== String(tenantId)) {
      return res.status(404).json({ error: 'User not found in this tenant' });
    }
    if (target.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot change your own role' });
    }
    // Don't strip the tenant of its last admin.
    if (target.role === 'admin' && role !== 'admin' && await db.countTenantAdmins(tenantId) <= 1) {
      return res.status(400).json({ error: 'This tenant must keep at least one admin' });
    }

    const updated = await db.updateAppUserRole(tenantId, targetId, role);
    if (!updated) return res.status(404).json({ error: 'User not found in this tenant' });
    res.json({ user: publicUser(updated) });
  } catch (err) {
    console.error('PATCH /users/:id failed:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── DELETE /api/users/:id (remove) ──────────────────────────────────────────

router.delete('/:id', requireRole(MANAGE_ROLES), async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const targetId = req.params.id;

    const target = await db.getAppUserById(targetId);
    if (!target || String(target.tenant_id) !== String(tenantId)) {
      return res.status(404).json({ error: 'User not found in this tenant' });
    }
    if (target.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot remove yourself' });
    }
    if (target.role === 'admin' && await db.countTenantAdmins(tenantId) <= 1) {
      return res.status(400).json({ error: 'This tenant must keep at least one admin' });
    }

    await db.deleteAppUserInTenant(tenantId, targetId);
    res.json({ message: `Removed ${target.email}.` });
  } catch (err) {
    console.error('DELETE /users/:id failed:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
