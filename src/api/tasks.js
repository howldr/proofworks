/**
 * howldr ProofWorks
 * "My tasks" — the calling user's action queue.
 *
 *   GET /api/tasks   any tenant member
 *
 * Derives what needs *this* user across the policies they own, authorise, or
 * sign, and the risks they accept (all keyed by email, so any role benefits):
 *   - approve    authoriser · policy under review · not yet approved by me
 *   - sign-off   exec · policy at EXEC_REVIEW naming me as the executive
 *   - accept     risk acceptor · latest round assessed, not yet accepted by me
 *   - revise     owner · draft that was returned for revision
 *   - draft      owner · draft not yet submitted
 *   - distribute owner · authorised, pending acceptance
 *   - review     owner · active policy whose review is due/overdue
 */

const express = require('express');
const router  = express.Router();

const db = require('../db/db');
const { STATUS } = require('../register/register');

function intEnv(name, fallback) {
  const n = parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) ? n : fallback;
}

// Display priority — most urgent first.
const ORDER = { revise: 0, approve: 1, 'sign-off': 1, accept: 2, distribute: 3, review: 4, draft: 5 };

router.get('/', async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const email    = req.user.email;
    const advanceDays =
      req.tenant.review_advance_notice_days ?? intEnv('REVIEW_ADVANCE_NOTICE_DAYS', 30);

    const [owned, authorising, signing] = await Promise.all([
      db.listPolicies({ tenantId, owner: email, limit: 500 }),
      db.listPolicies({ tenantId, authoriserEmail: email, limit: 500 }),
      db.listPolicies({ tenantId, execEmail: email, limit: 500 }),
    ]);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tasks = [];

    // Authoriser: policies under review still awaiting my sign-off.
    for (const p of authorising) {
      if (p.status !== STATUS.UNDER_REVIEW) continue;
      const authorisers = await db.getAuthorisers(tenantId, p.policy_id);
      const mine = authorisers.find(a => a.email === email);
      if (mine && !mine.approved_at) {
        tasks.push(task(p, 'approve', 'Awaiting your approval'));
      }
    }

    // Executive: policies waiting at EXEC_REVIEW that name me.
    for (const p of signing) {
      if (p.status === STATUS.EXEC_REVIEW) {
        tasks.push(task(p, 'sign-off', 'Awaiting your executive sign-off'));
      }
    }

    // Risk acceptor: open, assessed risks whose latest round awaits my
    // acceptance (acceptor_email, falling back to the owner). Only when the
    // workspace is entitled to the Risk Register.
    if ((req.tenant.entitlements || []).includes('risk_register')) {
      const risks = await db.listRisks({ tenantId, status: 'OPEN' });
      for (const r of risks) {
        const acceptor = r.acceptor_email || r.owner_email;
        if (acceptor === email && r.round != null && !r.accepted) {
          tasks.push({
            risk_id: r.risk_id,
            title:   r.title,
            status:  r.status,
            kind:    'accept',
            reason:  `Residual risk awaiting your acceptance (round ${r.round})`,
          });
        }
      }
    }

    // Owner: drafts, distribution, and reviews I own.
    for (const p of owned) {
      if (p.status === STATUS.DRAFT) {
        const authorisers = await db.getAuthorisers(tenantId, p.policy_id);
        if (authorisers.some(a => a.returned_at)) {
          tasks.push(task(p, 'revise', 'Returned for revision — address feedback'));
        } else {
          tasks.push(task(p, 'draft', 'Draft — submit for approval when ready'));
        }
      } else if (p.status === STATUS.PENDING_ACCEPTANCE) {
        tasks.push(task(p, 'distribute', 'Approved — ready to distribute'));
      } else if (p.status === STATUS.ACTIVE && p.next_review_date) {
        const due = new Date(p.next_review_date);
        due.setHours(0, 0, 0, 0);
        const daysUntil = Math.floor((due - today) / 86_400_000);
        if (daysUntil <= 0) {
          tasks.push(task(p, 'review', `Review overdue by ${Math.abs(daysUntil)} day(s)`));
        } else if (daysUntil <= advanceDays) {
          tasks.push(task(p, 'review', `Review due in ${daysUntil} day(s)`));
        }
      }
    }

    tasks.sort((a, b) => (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9));
    res.json({ tasks, count: tasks.length });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

function task(p, kind, reason) {
  return {
    policy_id: p.policy_id,
    title:     p.title,
    status:    p.status,
    version:   p.current_version,
    kind,
    reason,
  };
}

module.exports = router;
