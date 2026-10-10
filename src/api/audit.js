/**
 * howldr ProofWorks
 * Audit event spine API (core — not module-gated)
 *
 * Read-only. The spine has no write endpoints: events are appended by the
 * modules themselves (via db.logChange / logEvidenceEvent / logRiskEvent →
 * db.appendAuditEvent) as a by-product of doing the work.
 *
 * Routes (mounted behind requireTenant + requireUser + requireSameTenant +
 * requireRole(admin / governance_lead / viewer / howldr_support)):
 *   GET /api/audit          list events, latest first
 *                           ?object_type= &object_id= &action= &limit=
 *   GET /api/audit/verify   recompute the tenant's whole hash chain and
 *                           report whether it is intact
 */

const express = require('express');
const router  = express.Router();

const db = require('../db/db');
const { verifyChain } = require('../audit/spine');

router.get('/', async (req, res) => {
  try {
    const { object_type: objectType, object_id: objectId, action, limit } = req.query;
    const events = await db.getAuditEvents(req.tenant.id, { objectType, objectId, action, limit });
    res.json({ events });
  } catch (err) {
    console.error('[audit] list failed:', err.message);
    res.status(500).json({ error: 'Failed to list audit events' });
  }
});

router.get('/verify', async (req, res) => {
  try {
    const chain  = await db.getAuditChain(req.tenant.id);
    const result = verifyChain(chain);
    res.json({
      intact:         result.intact,
      events_checked: result.checked,
      break_at:       result.breakAt,
      reason:         result.reason,
    });
  } catch (err) {
    console.error('[audit] verify failed:', err.message);
    res.status(500).json({ error: 'Failed to verify audit chain' });
  }
});

module.exports = router;
