/**
 * howldr ProofWorks
 * Distribution audiences — reusable recipient groups
 *
 *   GET    /api/groups        read access (register roles — owners pick a
 *                             group when distributing; staff excluded)
 *   GET    /api/groups/:id    read access (group with members; staff excluded)
 *   POST   /api/groups        admin / governance_lead / howldr_support
 *   PUT    /api/groups/:id    admin / governance_lead / howldr_support
 *   DELETE /api/groups/:id    admin / governance_lead / howldr_support
 *
 * A group is a named list of acknowledgement recipients (staff email +
 * optional manager email for escalation), optionally widened by ROLES — at
 * send time everyone in the staff directory holding one of the group's roles
 * is included too — and narrowed by EXCLUDED addresses. Distribution accepts
 * groupIds and expands them server-side, so the register records exactly who
 * a group contained at send time via the acknowledgement rows.
 */

const express = require('express');
const router  = express.Router();

const db = require('../db/db');
const { requireRole } = require('../middleware/auth');

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const canManage = requireRole(['admin', 'governance_lead', 'howldr_support']);

// Everyone who works the register — but not staff: an audience is member +
// manager emails (org structure), and the workforce has no distribution role.
const canRead = requireRole(['admin', 'owner', 'authoriser', 'governance_lead', 'viewer', 'howldr_support']);

/** Group ids are bigserial — reject non-numeric ids before they hit pg. */
function groupId(req, res, next) {
  if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Group not found' });
  next();
}

// Roles an audience may target — the tenant-assignable set (howldr_support is
// cross-tenant and never a recipient). Role membership resolves against the
// staff directory at send time, so it only covers people with app accounts.
const AUDIENCE_ROLES = ['admin', 'owner', 'authoriser', 'governance_lead', 'acceptor', 'staff', 'viewer'];

/** Normalise + validate a roles payload. Returns { roles } or { error }. */
function parseRoles(raw) {
  if (raw === undefined) return { roles: undefined };
  if (!Array.isArray(raw)) return { error: 'roles must be an array' };
  const roles = [];
  for (const r of raw) {
    if (typeof r !== 'string' || !AUDIENCE_ROLES.includes(r)) {
      return { error: `roles must be from: ${AUDIENCE_ROLES.join(', ')}` };
    }
    if (!roles.includes(r)) roles.push(r);
  }
  return { roles };
}

/** Normalise + validate an excluded-emails payload. Returns { excluded } or { error }. */
function parseExcluded(raw) {
  if (raw === undefined) return { excluded: undefined };
  if (!Array.isArray(raw)) return { error: 'excludedEmails must be an array' };
  const seen = new Set();
  for (const e of raw) {
    const email = typeof e === 'string' ? e.trim().toLowerCase() : '';
    if (!EMAIL.test(email)) return { error: `invalid excluded email: ${e ?? '(missing)'}` };
    seen.add(email);
  }
  return { excluded: [...seen] };
}

/** Normalise + validate a members payload. Returns { members } or { error }. */
function parseMembers(raw) {
  if (raw === undefined) return { members: undefined };
  if (!Array.isArray(raw)) return { error: 'members must be an array' };
  const seen = new Set();
  const members = [];
  for (const m of raw) {
    const email = typeof m?.email === 'string' ? m.email.trim().toLowerCase() : '';
    if (!EMAIL.test(email)) return { error: `invalid member email: ${m?.email ?? '(missing)'}` };
    const manager = typeof m.manager_email === 'string' && m.manager_email.trim() !== ''
      ? m.manager_email.trim().toLowerCase()
      : null;
    if (manager !== null && !EMAIL.test(manager)) {
      return { error: `invalid manager email: ${m.manager_email}` };
    }
    if (seen.has(email)) continue; // dedupe, first entry wins
    seen.add(email);
    members.push({ email, manager_email: manager });
  }
  return { members };
}

router.get('/', canRead, async (req, res) => {
  try {
    res.json({ groups: await db.listGroups(req.tenant.id) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/:id', canRead, groupId, async (req, res) => {
  try {
    const group = await db.getGroupWithMembers(req.tenant.id, req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    res.json({ group });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/', canManage, async (req, res) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) return res.status(400).json({ error: 'name is required' });
    const { members, error } = parseMembers(req.body.members ?? []);
    if (error) return res.status(400).json({ error });
    const { roles, error: roleError } = parseRoles(req.body.roles ?? []);
    if (roleError) return res.status(400).json({ error: roleError });
    const { excluded, error: exclError } = parseExcluded(req.body.excludedEmails ?? []);
    if (exclError) return res.status(400).json({ error: exclError });

    const group = await db.createGroup(req.tenant.id, name, members, roles, excluded);
    res.status(201).json({ group });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A group with that name already exists' });
    }
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.put('/:id', groupId, canManage, async (req, res) => {
  try {
    let name;
    if (req.body?.name !== undefined) {
      name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
      if (!name) return res.status(400).json({ error: 'name must be a non-empty string' });
    }
    const { members, error } = parseMembers(req.body?.members);
    if (error) return res.status(400).json({ error });
    const { roles, error: roleError } = parseRoles(req.body?.roles);
    if (roleError) return res.status(400).json({ error: roleError });
    const { excluded, error: exclError } = parseExcluded(req.body?.excludedEmails);
    if (exclError) return res.status(400).json({ error: exclError });
    if (name === undefined && members === undefined && roles === undefined && excluded === undefined) {
      return res.status(400).json({ error: 'Nothing to change — send name, members, roles, and/or excludedEmails' });
    }

    const group = await db.updateGroup(req.tenant.id, req.params.id, {
      name, members, roles, excludedEmails: excluded,
    });
    if (!group) return res.status(404).json({ error: 'Group not found' });
    res.json({ group });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A group with that name already exists' });
    }
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.delete('/:id', groupId, canManage, async (req, res) => {
  try {
    const group = await db.getGroupWithMembers(req.tenant.id, req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    await db.deleteGroup(req.tenant.id, req.params.id);
    res.json({ message: `Group "${group.name}" deleted` });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
