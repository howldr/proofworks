/**
 * howldr ProofWorks
 * Review scheduler
 *
 * Runs daily. Checks every active and under-review policy against its
 * review due date and fires the appropriate notification or lifecycle action.
 *
 * Configuration (from .env):
 *   REVIEW_ADVANCE_NOTICE_DAYS  — days before due to send advance notice (default 30)
 *   REVIEW_GRACE_PERIOD_DAYS    — grace period before overdue escalation (default 30)
 *   ACCEPTANCE_REMINDER_DAYS    — comma-separated reminder days (default 3,7,14)
 *   GOVERNANCE_LEAD_EMAIL       — recipient for review-overdue escalations
 */

const cron = require('node-cron');

const {
  sendReviewAdvanceNotice,
  sendReviewTriggered,
  sendReviewOverdueEscalation,
  sendAcceptanceReminder,
  sendAcceptanceEscalation,
  attestationUrl,
} = require('../liquidfiles/messages');

const { STATUS } = require('../register/register');
const { pollAllReceipts } = require('../notifications/receipts');
const { copyNewestFile } = require('../liquidfiles/folders');
const db = require('../db/db');

// Deployment-wide defaults from env. Per-tenant columns override these; env is
// only the fallback when a tenant hasn't set its own cadence.
const DEFAULT_ADVANCE_NOTICE_DAYS = parseInt(process.env.REVIEW_ADVANCE_NOTICE_DAYS || '30', 10);
const DEFAULT_GRACE_PERIOD_DAYS   = parseInt(process.env.REVIEW_GRACE_PERIOD_DAYS   || '30', 10);
const DEFAULT_REMINDER_DAYS       = (process.env.ACCEPTANCE_REMINDER_DAYS || '3,7,14')
  .split(',').map(Number).filter(Number.isFinite);
const DEFAULT_GOVERNANCE_EMAIL    = process.env.GOVERNANCE_LEAD_EMAIL || null;

/** Effective cadence for a tenant row, falling back to the env defaults. */
function cadenceFromTenant(t) {
  return {
    advanceNoticeDays: t?.review_advance_notice_days ?? DEFAULT_ADVANCE_NOTICE_DAYS,
    gracePeriodDays:   t?.review_grace_period_days ?? DEFAULT_GRACE_PERIOD_DAYS,
    reminderDays:      t?.acceptance_reminder_days ?? DEFAULT_REMINDER_DAYS,
    governanceEmail:   t?.governance_lead_email ?? DEFAULT_GOVERNANCE_EMAIL,
  };
}

/** Per-run resolver that loads each tenant's cadence once and reuses it
 *  across that tenant's policies. */
function tenantCadenceResolver() {
  const cache = new Map();
  return async (tenantId) => {
    if (!cache.has(tenantId)) {
      const t = await db.getTenantById(tenantId).catch(() => null);
      cache.set(tenantId, cadenceFromTenant(t));
    }
    return cache.get(tenantId);
  };
}

// ─── Scheduler entry point ───────────────────────────────────────────────────

/**
 * Start the scheduler. Call this once at application startup.
 * Daily lifecycle checks at 08:00; acknowledgement receipt polling every
 * 15 minutes (the appliance has no webhooks).
 */
function startScheduler() {
  console.log('[scheduler] Starting ProofWorks review scheduler');

  cron.schedule('0 8 * * *', async () => {
    console.log('[scheduler] Running daily review check');
    try {
      await runDailyCheck();
    } catch (err) {
      console.error('[scheduler] Daily check failed:', err);
    }
  });

  cron.schedule('*/15 * * * *', async () => {
    try {
      await pollAllReceipts();
    } catch (err) {
      console.error('[scheduler] Receipt poll failed:', err);
    }
  });
}

/**
 * Run all daily checks. Can also be called directly for testing.
 */
async function runDailyCheck() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Pull any receipts that landed since the last poll first, so reminder
  // and escalation checks below don't chase people who already acknowledged.
  await pollAllReceipts();

  const cadenceFor = tenantCadenceResolver();
  await checkReviewDueDates(today, cadenceFor);
  await checkOutstandingAcceptances(today, cadenceFor);
}

// ─── Review due date checks ──────────────────────────────────────────────────

async function checkReviewDueDates(today, cadenceFor) {
  const policies = await db.getPoliciesForReviewCheck();

  for (const policy of policies) {
    try {
      const cadence = await cadenceFor(policy.tenant_id);
      await evaluateReviewDate(policy, today, cadence);
    } catch (err) {
      console.error(`[scheduler] Review check failed for ${policy.policy_id}:`, err);
    }
  }
}

async function evaluateReviewDate(policy, today, cadence) {
  const reviewDate = new Date(policy.next_review_date);
  reviewDate.setHours(0, 0, 0, 0);

  const daysUntilReview = Math.floor((reviewDate - today) / (1000 * 60 * 60 * 24));

  if (policy.status === STATUS.ACTIVE) {
    if (daysUntilReview <= 0) {
      console.log(`[scheduler] Triggering review for ${policy.policy_id}`);
      await triggerReviewCycle(policy);
    } else if (daysUntilReview <= cadence.advanceNoticeDays && !policy.advance_notice_sent) {
      console.log(`[scheduler] Sending advance review notice for ${policy.policy_id} (${daysUntilReview} days)`);
      await sendReviewAdvanceNotice({
        ownerEmail:     policy.owner_email,
        policyId:       policy.policy_id,
        title:          policy.title,
        nextReviewDate: policy.next_review_date,
      });
      await db.markAdvanceNoticeSent(policy.tenant_id, policy.policy_id);
    }
  } else if (policy.status === STATUS.UNDER_REVIEW) {
    const daysOverdue = Math.abs(daysUntilReview);
    if (daysUntilReview < 0 && daysOverdue > cadence.gracePeriodDays) {
      console.log(`[scheduler] Review overdue escalation for ${policy.policy_id} (${daysOverdue} days overdue)`);
      await sendReviewOverdueEscalation({
        ownerEmail:      policy.owner_email,
        governanceEmail: cadence.governanceEmail,
        policyId:        policy.policy_id,
        title:           policy.title,
        reviewDueDate:   policy.next_review_date,
      });
    }
  }
}

async function triggerReviewCycle(policy) {
  await db.updatePolicy(policy.tenant_id, policy.policy_id, {
    status:              STATUS.UNDER_REVIEW,
    advance_notice_sent: false,
    escalation_sent:     false,
  });

  await db.logChange({
    tenantId:    policy.tenant_id,
    policyId:    policy.policy_id,
    event:       'Scheduled review cycle triggered',
    fromStatus:  STATUS.ACTIVE,
    toStatus:    STATUS.UNDER_REVIEW,
    actorEmail:  'scheduler',
  });

  // Seed /drafts/ with the published document so revision starts from the
  // authoritative current version. Best-effort — the review is already open.
  // The due-review view carries no folder ids, so refetch the full rows.
  try {
    const [full, tenant] = await Promise.all([
      db.getPolicyById(policy.tenant_id, policy.policy_id),
      db.getTenantById(policy.tenant_id),
    ]);
    if (full?.lf_folder_ids?.current && full?.lf_folder_ids?.drafts && tenant?.lf_share_name) {
      const copied = await copyNewestFile(
        tenant.lf_share_name, full.lf_folder_ids.current, full.lf_folder_ids.drafts,
      );
      if (copied) {
        await db.logChange({
          tenantId:   policy.tenant_id,
          policyId:   policy.policy_id,
          event:      `Working copy seeded to drafts: ${copied.name}`,
          actorEmail: 'scheduler',
          metadata:   { lf_file_id: copied.file.id, checksum: copied.file.checksum },
        });
      }
    }
  } catch (lfErr) {
    console.warn(`[scheduler] working-copy seed failed for ${policy.policy_id}: ${lfErr.message}`);
  }

  await sendReviewTriggered({
    ownerEmail:     policy.owner_email,
    policyId:       policy.policy_id,
    title:          policy.title,
    currentVersion: policy.current_version,
  });
}

// ─── Outstanding acceptance checks ──────────────────────────────────────────

async function checkOutstandingAcceptances(today, cadenceFor) {
  const policies = await db.getPoliciesWithOutstandingAcceptances();

  for (const policy of policies) {
    try {
      const cadence = await cadenceFor(policy.tenant_id);
      await evaluateOutstandingAcceptances(policy, today, cadence);
    } catch (err) {
      console.error(`[scheduler] Acceptance check failed for ${policy.policy_id}:`, err);
    }
  }
}

async function evaluateOutstandingAcceptances(policy, today, cadence) {
  const outstanding = await db.getOutstandingRecipients(policy.tenant_id, policy.policy_id);
  const reminderDays = cadence.reminderDays;

  for (const recipient of outstanding) {
    const distributedDate = new Date(recipient.distributed_at);
    distributedDate.setHours(0, 0, 0, 0);
    const daysElapsed = Math.floor((today - distributedDate) / (1000 * 60 * 60 * 24));

    if (reminderDays.includes(daysElapsed)) {
      await sendAcceptanceReminder({
        recipientEmail: recipient.recipient_email,
        policyId:       policy.policy_id,
        title:          policy.title,
        version:        policy.current_version,
        daysOverdue:    daysElapsed,
        expiresAt:      recipient.expires_at,
        acceptUrl:      recipient.accept_token ? attestationUrl(recipient.accept_token) : undefined,
      });
      await db.markReminderSent(policy.tenant_id, policy.policy_id, recipient.recipient_email);
    } else if (daysElapsed > Math.max(...reminderDays) && !policy.escalation_sent) {
      await sendAcceptanceEscalation({
        managerEmail:     recipient.manager_email,
        ownerEmail:       policy.owner_email,
        policyId:         policy.policy_id,
        title:            policy.title,
        version:          policy.current_version,
        outstandingCount: outstanding.length,
      });
      await db.markEscalationSent(policy.tenant_id, policy.policy_id);
      break; // One escalation per policy per run
    }
  }
}

module.exports = { startScheduler, runDailyCheck, cadenceFromTenant };
