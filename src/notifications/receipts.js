/**
 * howldr ProofWorks
 * Acknowledgement receipts
 *
 * The acknowledgement record is the recipient's authenticated download of
 * the policy document from their acceptance Secure Message.
 *
 * Primary path — POLLING: the production appliance (v4.3) has no webhooks,
 * so pollPolicyReceipts/pollAllReceipts pull GET /message/{id}/downloads for
 * every outstanding acceptance (scheduler cron + on-demand API route).
 *
 * Secondary path — the webhook handler below is kept for appliances that do
 * support receipt callbacks (POST /api/webhooks/liquidfiles).
 *
 * Both paths record the acknowledgement and advance the policy to ACTIVE
 * when all required recipients have confirmed.
 */

const crypto = require('crypto');

const { STATUS } = require('../register/register');
const { sendActivationNotice, getMessageDownloads } = require('../liquidfiles/messages');

const db = require('../db/db');

const WEBHOOK_SECRET = process.env.LIQUIDFILES_WEBHOOK_SECRET;

// ─── Webhook handler (Express route handler) ─────────────────────────────────

/**
 * Handle an incoming LiquidFiles receipt webhook.
 * Mount this at POST /api/webhooks/liquidfiles in your Express app.
 *
 * @example
 * const { handleReceiptWebhook } = require('./notifications/receipts');
 * app.post('/api/webhooks/liquidfiles', express.json(), handleReceiptWebhook);
 */
async function handleReceiptWebhook(req, res) {
  if (WEBHOOK_SECRET) {
    const signature = req.headers['x-liquidfiles-signature'];
    if (!verifySignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }
  }

  const event = req.body;

  try {
    await processReceiptEvent(event);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[webhook] Failed to process receipt event:', err);
    res.status(500).json({ error: 'Internal error processing receipt' });
  }
}

// ─── Receipt event processing ─────────────────────────────────────────────────

/**
 * Process a receipt event from LiquidFiles.
 *
 * Expected payload shape (LiquidFiles receipt webhook):
 * {
 *   message_id:      "abc123",
 *   recipient_email: "staff@company.com",
 *   accessed_at:     "2025-03-15T09:22:41Z",
 *   ip_address:      "203.0.113.42",
 *   download_count:  1,
 *   event_type:      "download" | "access"
 * }
 */
async function processReceiptEvent(event) {
  const { message_id, recipient_email, accessed_at, ip_address, download_count } = event;

  if (!message_id || !recipient_email) {
    console.warn('[webhook] Receipt event missing required fields:', event);
    return;
  }

  const notification = await db.getNotificationByMessageId(message_id);

  if (!notification) {
    // Message not tracked by ProofWorks (e.g. a manual message) — ignore
    return;
  }

  console.log(
    `[webhook] Receipt: ${notification.event_type} | ${notification.policy_id} | ${recipient_email} | ${accessed_at}`
  );

  if (notification.event_type === 'acceptance') {
    await processAcceptanceReceipt({
      notification,
      recipientEmail: recipient_email,
      accessedAt:     accessed_at,
      ipAddress:      ip_address,
      downloadCount:  download_count,
    });
  } else if (notification.event_type === 'authorisation') {
    // Authorisation receipts are noted but the authoriser must explicitly reply
    // to approve or return. Just log the access here.
    await logAuthorisationAccess({ notification, recipientEmail: recipient_email, accessedAt: accessed_at });
  }
}

async function processAcceptanceReceipt({ notification, recipientEmail, accessedAt, ipAddress, downloadCount }) {
  const tenantId = notification.tenant_id;
  await db.recordAcknowledgement({
    tenantId,
    policyId:       notification.policy_id,
    version:        notification.version,
    recipientEmail,
    acknowledgedAt: accessedAt,
    ipAddress,
    downloadCount,
    messageId:      notification.lf_message_id,
  });

  const counts = await db.incrementAcknowledgementCount(tenantId, notification.policy_id);
  const allAcknowledged = counts.acknowledgement_count >= counts.acknowledgement_total;

  if (allAcknowledged) {
    const policy = await db.getPolicyById(tenantId, notification.policy_id);
    if (policy && policy.status === STATUS.PENDING_ACCEPTANCE) {
      await activatePolicy(policy);
    }
  }
}

async function activatePolicy(policy) {
  const updated = await db.updatePolicy(policy.tenant_id, policy.policy_id, { status: STATUS.ACTIVE });
  await db.logChange({
    tenantId:    policy.tenant_id,
    policyId:    policy.policy_id,
    event:       'All acknowledgements received — policy active',
    fromStatus:  STATUS.PENDING_ACCEPTANCE,
    toStatus:    STATUS.ACTIVE,
  });

  // Owner notice is informational — the status change above must stand
  // even if the appliance can't send right now.
  try {
    await sendActivationNotice({
      ownerEmail:     updated.owner_email,
      policyId:       updated.policy_id,
      title:          updated.title,
      version:        updated.current_version,
      nextReviewDate: updated.next_review_date,
    });
  } catch (err) {
    console.warn(`[receipts] activation notice for ${updated.policy_id} failed: ${err.message}`);
  }

  console.log(`[receipts] Policy activated: ${updated.policy_id} ${updated.current_version}`);
}

// ─── Receipt polling (no webhooks on this appliance) ─────────────────────────

/**
 * Pull download receipts for one policy's outstanding acceptances and record
 * any acknowledgements found. Activates the policy when the last one lands.
 *
 * @returns {Promise<{checked: number, recorded: number, activated: boolean}>}
 */
async function pollPolicyReceipts(tenantId, policyId) {
  const outstanding = await db.getOutstandingRecipients(tenantId, policyId);
  let recorded = 0;
  let activated = false;

  for (const ack of outstanding) {
    if (!ack.lf_message_id) continue; // send failed at distribution — nothing to poll

    let downloads;
    try {
      downloads = await getMessageDownloads(ack.lf_message_id);
    } catch (err) {
      console.warn(`[receipts] download log for message ${ack.lf_message_id} failed: ${err.message}`);
      continue;
    }

    // The receipt must be the recipient's own authenticated download —
    // an admin or sender opening the attachment does not acknowledge.
    const own = downloads.filter(
      d => d.recipient && d.recipient.toLowerCase() === ack.recipient_email.toLowerCase()
    );
    if (!own.length) continue;

    const first = own.reduce((a, b) =>
      new Date(a.downloaded_at) <= new Date(b.downloaded_at) ? a : b);

    await db.recordAcknowledgement({
      tenantId,
      policyId,
      version:        ack.version,
      recipientEmail: ack.recipient_email,
      acknowledgedAt: first.downloaded_at,
      ipAddress:      first.remote_ip || first.remote_host || null,
      downloadCount:  own.length,
      messageId:      ack.lf_message_id,
    });
    await db.logChange({
      tenantId,
      policyId,
      event:      `Acknowledgement receipt: ${ack.recipient_email} downloaded ${first.filename}`,
      actorEmail: ack.recipient_email,
      metadata:   {
        lf_message_id: ack.lf_message_id,
        downloaded_at: first.downloaded_at,
        remote_ip:     first.remote_ip || first.remote_host || null,
      },
    });
    recorded++;

    const counts = await db.incrementAcknowledgementCount(tenantId, policyId);
    if (counts && counts.acknowledgement_count >= counts.acknowledgement_total) {
      const policy = await db.getPolicyById(tenantId, policyId);
      if (policy && policy.status === STATUS.PENDING_ACCEPTANCE) {
        await activatePolicy(policy);
        activated = true;
      }
    }
  }

  return { checked: outstanding.length, recorded, activated };
}

/**
 * Poll receipts for every policy with outstanding acceptances, across all
 * tenants. Called by the scheduler.
 */
async function pollAllReceipts() {
  const policies = await db.getPoliciesWithOutstandingAcceptances();
  for (const policy of policies) {
    try {
      const result = await pollPolicyReceipts(policy.tenant_id, policy.policy_id);
      if (result.recorded) {
        console.log(`[receipts] ${policy.policy_id}: recorded ${result.recorded} acknowledgement(s)`);
      }
    } catch (err) {
      console.error(`[receipts] poll failed for ${policy.policy_id}:`, err);
    }
  }
}

async function logAuthorisationAccess({ notification, recipientEmail, accessedAt }) {
  await db.logChange({
    tenantId:    notification.tenant_id,
    policyId:    notification.policy_id,
    event:       `Authorisation message accessed by ${recipientEmail}`,
    actorEmail:  recipientEmail,
    metadata:    { accessed_at: accessedAt, lf_message_id: notification.lf_message_id },
  });
  console.log(`[webhook] Authorisation accessed: ${notification.policy_id} by ${recipientEmail} at ${accessedAt}`);
}

// ─── Webhook signature verification ─────────────────────────────────────────

function verifySignature(body, signature) {
  if (!signature) return false;
  const expected = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}

module.exports = {
  handleReceiptWebhook,
  processReceiptEvent,
  pollPolicyReceipts,
  pollAllReceipts,
  activatePolicy,
};
