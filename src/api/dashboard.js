/**
 * howldr ProofWorks
 * Suite dashboard (core — not module-gated as a whole)
 *
 * One aggregate for the cross-module "needs attention" view. Each section is
 * included only when the workspace is entitled to that module, so the endpoint
 * itself carries no requireModule gate — it reports on whatever the tenant
 * has enabled (howldr_support sees every section).
 *
 * Route (mounted behind requireTenant + requireUser + requireSameTenant):
 *   GET /api/dashboard    any tenant member (staff get an empty aggregate —
 *                         their view derives from the ACTIVE-only register)
 *
 * recent_events comes from the audit spine, whose list endpoint is restricted
 * to audit-grade readers — the same restriction applies here: the section is
 * present only for admin / governance_lead / viewer / howldr_support.
 */

const express = require('express');
const router  = express.Router();

const db = require('../db/db');

const AUDIT_READ_ROLES = new Set(['admin', 'governance_lead', 'viewer', 'howldr_support']);

const IN_AUTHORISATION = new Set(['UNDER_REVIEW', 'OWNER_ACCEPTANCE', 'EXEC_REVIEW']);

function band(score) {
  if (score >= 16) return 'Critical';
  if (score >= 10) return 'High';
  if (score >= 5)  return 'Medium';
  return 'Low';
}

function isoDay(d) {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

router.get('/', async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    // Which sections a role may see mirrors the module mounts: acceptors
    // (named signers) reach risks + access reviews but not evidence/vendors.
    const MOUNT_DENIED = req.user.role === 'acceptor'
      ? new Set(['evidence_locker', 'vendor_assessments'])
      : new Set();
    const entitled = (key) =>
      !MOUNT_DENIED.has(key) &&
      (req.user.role === 'howldr_support' || (req.tenant.entitlements || []).includes(key));

    // Staff (the workforce) see the published register only — the governance
    // aggregate (risk/evidence/vendor attention items carry titles) is not
    // theirs. The SPA derives its stat cards from GET /api/policies, which is
    // already ACTIVE-filtered for staff, so an empty aggregate renders fine.
    if (req.user.role === 'staff') return res.json({});

    const today  = new Date().toISOString().slice(0, 10);
    const in30   = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const out    = {};

    if (entitled('policy_hub')) {
      const [policies, outstandingAcks] = await Promise.all([
        db.listPolicies({ tenantId, limit: 500 }),
        db.countOutstandingAcceptances(tenantId),
      ]);
      const live    = policies.filter(p => p.status !== 'RETIRED');
      const withDue = live.filter(p => p.next_review_date != null);
      out.policies = {
        total:              live.length,
        active:             live.filter(p => p.status === 'ACTIVE').length,
        in_authorisation:   live.filter(p => IN_AUTHORISATION.has(p.status)).length,
        pending_acceptance: live.filter(p => p.status === 'PENDING_ACCEPTANCE').length,
        review_overdue:     withDue.filter(p => isoDay(p.next_review_date) <  today).length,
        review_due_30d:     withDue.filter(p => isoDay(p.next_review_date) >= today &&
                                                isoDay(p.next_review_date) <= in30).length,
        outstanding_acknowledgements: outstandingAcks,
      };
    }

    if (entitled('evidence_locker')) {
      const items    = await db.listEvidence({ tenantId, status: 'ACTIVE' });
      const dated    = items.filter(i => i.expires_at != null);
      const expired  = dated.filter(i => isoDay(i.expires_at) < today);
      const expiring = dated.filter(i => isoDay(i.expires_at) >= today && isoDay(i.expires_at) <= in30);
      out.evidence = {
        active:       items.length,
        expired:      expired.length,
        expiring_30d: expiring.length,
        attention: [...expired, ...expiring]
          .sort((a, b) => isoDay(a.expires_at).localeCompare(isoDay(b.expires_at)))
          .slice(0, 5)
          .map(i => ({
            evidence_id: i.evidence_id,
            title:       i.title,
            expires_at:  isoDay(i.expires_at),
            expired:     isoDay(i.expires_at) < today,
          })),
      };
    }

    if (entitled('risk_register')) {
      const risks    = await db.listRisks({ tenantId, status: 'OPEN' });
      const awaiting = risks.filter(r => r.round != null && !r.accepted);
      const overdue  = risks.filter(r => r.next_review_date != null && isoDay(r.next_review_date) < today);
      out.risks = {
        open:                risks.length,
        awaiting_acceptance: awaiting.length,
        not_assessed:        risks.filter(r => r.round == null).length,
        review_overdue:      overdue.length,
        attention: awaiting.slice(0, 5).map(r => {
          const score = r.residual_likelihood * r.residual_impact;
          return {
            risk_id:        r.risk_id,
            title:          r.title,
            residual_score: score,
            residual_band:  band(score),
          };
        }),
      };
    }

    if (entitled('access_reviews')) {
      const reviews = await db.listAccessReviews({ tenantId, status: 'OPEN' });
      const isOverdue = (r) => r.due_date != null && isoDay(r.due_date) < today;
      out.access_reviews = {
        open:            reviews.length,
        overdue:         reviews.filter(isOverdue).length,
        ready_to_attest: reviews.filter(r => r.lines_total > 0 && r.lines_decided >= r.lines_total).length,
        attention: reviews.slice(0, 5).map(r => ({
          review_id:     r.review_id,
          title:         r.title,
          system:        r.system,
          due_date:      r.due_date ? isoDay(r.due_date) : null,
          overdue:       isOverdue(r),
          lines_total:   r.lines_total,
          lines_decided: r.lines_decided,
        })),
      };
    }

    if (entitled('vendor_assessments')) {
      const vendors  = await db.listVendors({ tenantId, status: 'OPEN' });
      const awaiting = vendors.filter(v => v.round != null && v.decision == null);
      const overdue  = vendors.filter(v => v.next_review_date != null && isoDay(v.next_review_date) < today);
      out.vendors = {
        open:             vendors.length,
        awaiting_decision: awaiting.length,
        not_assessed:     vendors.filter(v => v.round == null).length,
        review_overdue:   overdue.length,
        attention: awaiting.slice(0, 5).map(v => {
          const score = v.residual_likelihood * v.residual_impact;
          return {
            vendor_id:      v.vendor_id,
            name:           v.name,
            tier:           v.tier,
            residual_score: score,
            residual_band:  band(score),
          };
        }),
      };
    }

    if (entitled('obligations')) {
      const rows = await db.listObligations({ tenantId, status: 'ACTIVE' });
      const unanswered = rows.filter(o =>
        !(o.policy_ids?.length || o.risk_ids?.length || o.evidence_ids?.length));
      // Answered by a method but with nothing proving it — the break on the
      // spine's obligation → control → *evidence* hop.
      const unproven = rows.filter(o =>
        (o.policy_ids?.length || o.risk_ids?.length) && !o.evidence_ids?.length);
      const overdue = rows.filter(o => o.next_review_date != null && isoDay(o.next_review_date) < today);
      out.obligations = {
        active:         rows.length,
        unanswered:     unanswered.length,
        unproven:       unproven.length,
        review_overdue: overdue.length,
        review_due_30d: rows.filter(o => o.next_review_date != null &&
                          isoDay(o.next_review_date) >= today && isoDay(o.next_review_date) <= in30).length,
        // Unanswered obligations are the register's loudest signal.
        attention: unanswered.slice(0, 5).map(o => ({
          obligation_id: o.obligation_id,
          title:         o.title,
          source_type:   o.source_type,
          source_name:   o.source_name,
        })),
      };
    }

    if (AUDIT_READ_ROLES.has(req.user.role)) {
      out.recent_events = await db.getAuditEvents(tenantId, { limit: 8 });
    }

    res.json(out);
  } catch (err) {
    console.error('[dashboard] failed:', err.message);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

module.exports = router;
