/**
 * howldr ProofWorks
 * LiquidFiles Secure Messages
 *
 * Sends authenticated Secure Messages for all policy lifecycle events.
 *
 * Non-repudiation messages (authorisation, acceptance, onboarding) always use:
 *   authorization: 3  — require recipient authentication
 *   private: true     — message body not transmitted in plain email
 *
 * Notification-only messages (owner alerts, reminders) use:
 *   authorization: 0  — no authentication required
 */

const { request, uploadAttachment } = require('./client');

// ─── Authorization levels ────────────────────────────────────────────────────

const AUTH = {
  NONE:     0,  // Link-only access — for informational notifications
  FULL:     3,  // LiquidFiles authentication required — for non-repudiation
};

// ─── App deep links ──────────────────────────────────────────────────────────
//
// Every email that links into ProofWorks goes through policyUrl() so the host
// and route shape are defined in exactly one place. The web app is a static
// export, so the only policy route is /policies/view?id=… — NOT /policies/:id
// (which 404s). APP_BASE_URL must point at the web app (e.g.
// https://policyhub.howldr.com), never the LiquidFiles appliance.

/** Web app origin, trailing slashes stripped so links never get a double `//`. */
function appBaseUrl() {
  return (process.env.APP_BASE_URL || 'https://policyhub.howldr.com').replace(/\/+$/, '');
}

/** Canonical deep link to a policy's detail page. */
function policyUrl(policyId) {
  return `${appBaseUrl()}/policies/view?id=${encodeURIComponent(policyId)}`;
}

/** Public read-and-accept page for an acceptance token (no login required —
 *  the high-entropy token is the authorisation). */
function attestationUrl(token) {
  return `${appBaseUrl()}/accept?t=${encodeURIComponent(token)}`;
}

// ─── Core send function ──────────────────────────────────────────────────────

/**
 * Send a LiquidFiles Secure Message.
 *
 * @param {object} opts
 * @param {string|string[]} opts.recipients    - Recipient email(s)
 * @param {string}          opts.subject       - Message subject
 * @param {string}          opts.body          - Message body text
 * @param {number}          [opts.authorization=AUTH.FULL] - Auth level
 * @param {boolean}         [opts.private=true] - Body not in plain email
 * @param {string}          [opts.expiresAt]   - Expiry date (YYYY-MM-DD)
 * @param {number}          [opts.expiresAfter] - Max downloads per recipient
 * @param {string[]}        [opts.attachments] - LiquidFiles attachment IDs
 * @returns {Promise<object>} Sent message object including message ID
 */
async function sendMessage(opts) {
  const {
    recipients,
    subject,
    body,
    authorization = AUTH.FULL,
    private: isPrivate = true,
    expiresAt,
    expiresAfter,
    attachments = [],
  } = opts;

  const payload = {
    message: {
      recipients:      Array.isArray(recipients) ? recipients : [recipients],
      subject,
      message:         body,
      send_email:      true,
      authorization,
      private_message: isPrivate,
    },
  };

  if (expiresAt)    payload.message.expires_at     = expiresAt;
  if (expiresAfter) payload.message.expires_after  = expiresAfter;
  if (attachments.length) payload.message.attachments = attachments;

  // LiquidFiles v4.3: send is POST /message (singular); response is { message: { id, url, ... } }
  const data = await request('POST', '/message', payload);
  return data.message;
}

// ─── Typed message senders ───────────────────────────────────────────────────

/**
 * Notify owner that a policy has been initiated.
 */
async function sendInitiationNotice({ ownerEmail, policyId, title }) {
  return sendMessage({
    recipients:    ownerEmail,
    subject:       `ProofWorks: POL initiated — ${policyId}`,
    body:          `Your policy "${title}" (${policyId}) has been created in ProofWorks.\n\nPlease begin drafting and upload your working document to the drafts folder when ready.`,
    authorization: AUTH.NONE,
    private:       false,
  });
}

/**
 * Send authorisation request to an approver.
 * Uses full authentication for non-repudiation.
 *
 * @param {object} opts
 * @param {string}   opts.authoriserEmail
 * @param {string}   opts.policyId
 * @param {string}   opts.title
 * @param {string}   opts.version         - e.g. 'v0.1' (already prefixed)
 * @param {string}   opts.expiresAt       - Authorisation deadline (YYYY-MM-DD)
 * @param {Buffer}   [opts.documentBuffer] - draft document to attach
 * @param {string}   [opts.documentName]   - e.g. 'POL-2025-001-v0.1.docx'
 * @param {string}   [opts.documentType]   - MIME type of the document
 * @returns {Promise<object>} Sent message including ID for receipt tracking
 */
async function sendAuthorisationRequest({
  authoriserEmail, policyId, title, version, expiresAt, documentBuffer, documentName, documentType,
}) {
  const attachments = [];
  if (documentBuffer && documentName) {
    attachments.push(await uploadAttachment(
      documentBuffer, documentName, documentType || 'application/pdf',
    ));
  }

  const docLine = attachments.length
    ? 'Please review the attached policy document.'
    : 'Please review the policy document in ProofWorks.';

  return sendMessage({
    recipients:    authoriserEmail,
    subject:       `Action required: Approve ${policyId} ${version} — ${title}`,
    body:          `${docLine}\n\nPolicy: ${title}\nReference: ${policyId} ${version}\nApproval deadline: ${expiresAt}\n\nTo record your decision, sign in to ProofWorks and open the policy:\n${policyUrl(policyId)}\n\nFrom there you can Approve, or Return it with feedback.\n\nThis message requires authentication to access. Your access is logged.`,
    authorization: AUTH.FULL,
    private:       true,
    expiresAt,
    attachments,
  });
}

/**
 * Request executive sign-off — the category-triggered final tier, requested
 * once all authorisers have approved. Full authentication for non-repudiation.
 *
 * @param {object} opts
 * @param {string}   opts.execEmail
 * @param {string}   opts.policyId
 * @param {string}   opts.title
 * @param {string}   opts.version
 * @param {Buffer}   [opts.documentBuffer]
 * @param {string}   [opts.documentName]
 * @param {string}   [opts.documentType]
 */
async function sendExecAuthorisationRequest({
  execEmail, policyId, title, version, documentBuffer, documentName, documentType,
}) {
  const attachments = [];
  if (documentBuffer && documentName) {
    attachments.push(await uploadAttachment(
      documentBuffer, documentName, documentType || 'application/pdf',
    ));
  }

  const docLine = attachments.length
    ? 'The approved policy document is attached.'
    : 'The approved policy document is available in ProofWorks.';

  return sendMessage({
    recipients:    execEmail,
    subject:       `Executive sign-off required: ${policyId} ${version} — ${title}`,
    body:          `All approvers have approved this policy; it now needs your executive sign-off before it can be distributed.\n\n${docLine}\n\nPolicy: ${title}\nReference: ${policyId} ${version}\n\nTo record your decision, sign in to ProofWorks and open the policy:\n${policyUrl(policyId)}\n\nFrom there you can Approve, or Return it with feedback.\n\nThis message requires authentication to access. Your access is logged.`,
    authorization: AUTH.FULL,
    private:       true,
    attachments,
  });
}

/**
 * Ask the owner to accept the authorised version — the optional (per-tenant)
 * owner-acceptance gate, requested once all authorisers have approved.
 */
async function sendOwnerAcceptanceRequest({ ownerEmail, policyId, title, version }) {
  return sendMessage({
    recipients:    ownerEmail,
    subject:       `Action required: Accept ${policyId} ${version} — ${title}`,
    body:          `All approvers have approved ${title} (${policyId} ${version}).\n\nAs the policy owner, please review and accept the approved version to advance it. Sign in to ProofWorks and open the policy:\n${policyUrl(policyId)}\n\nFrom there you can Accept it, or Return it for revision.`,
    authorization: AUTH.NONE,
    private:       false,
  });
}

/**
 * Notify owner that an authoriser has returned the policy with feedback.
 */
async function sendReturnNotice({ ownerEmail, policyId, title, authoriserEmail, feedback }) {
  return sendMessage({
    recipients:    ownerEmail,
    subject:       `Policy returned for revision: ${policyId} — ${title}`,
    body:          `${authoriserEmail} has returned the policy for revision.\n\nFeedback:\n${feedback}\n\nPlease address the feedback and resubmit when ready.`,
    authorization: AUTH.NONE,
    private:       false,
  });
}

/**
 * Notify owner and contributors that the policy has been authorised.
 */
async function sendAuthorisationConfirmation({ ownerEmail, policyId, title, version }) {
  return sendMessage({
    recipients:    ownerEmail,
    subject:       `Policy approved: ${policyId} ${version} — ${title}`,
    body:          `All required approvers have approved ${title} (${policyId} ${version}).\n\nThe policy has been published to the active folder. Distribution messages are being sent to all applicable staff.`,
    authorization: AUTH.NONE,
    private:       false,
  });
}

/**
 * Send policy acceptance request to a staff member.
 * Uses full authentication for non-repudiation. The recipient's authenticated
 * download of the attached document IS the acknowledgement receipt (polled
 * via getMessageDownloads), so the document attachment is required.
 */
async function sendAcceptanceRequest({
  recipientEmail, policyId, title, version, expiresAt, documentBuffer, documentName, documentType,
  acceptUrl,
}) {
  const attachmentId = await uploadAttachment(
    documentBuffer, documentName, documentType || 'application/pdf',
  );

  const acceptBlock = acceptUrl
    ? `Then confirm your acceptance here:\n${acceptUrl}\n\nClicking "I have read and accept" records your formal acknowledgement.`
    : `Your authenticated download is logged and forms your formal acknowledgement record:\n"I have read, understood, and accept this policy."`;

  return sendMessage({
    recipients:    recipientEmail,
    subject:       `Please acknowledge: ${title} (${policyId} ${version})`,
    body:          `A policy requires your acknowledgement.\n\nPolicy: ${title}\nReference: ${policyId} ${version}\n\nPlease download and read the attached document.\n\n${acceptBlock}\n\nIf you have questions, contact your line manager or the policy owner.`,
    authorization: AUTH.FULL,
    private:       true,
    expiresAt,
    attachments:   [attachmentId],
  });
}

/**
 * Send an acceptance reminder to a staff member who has not yet acknowledged.
 */
async function sendAcceptanceReminder({ recipientEmail, policyId, title, version, daysOverdue, expiresAt, acceptUrl }) {
  const action = acceptUrl
    ? `Please read the policy from your original message, then confirm your acceptance here:\n${acceptUrl}`
    : `Please access your original message and reply with your confirmation.`;
  return sendMessage({
    recipients:    recipientEmail,
    subject:       `Reminder: Acknowledgement required — ${title} (${policyId})`,
    body:          `This is a reminder that your acknowledgement of "${title}" (${policyId} ${version}) is outstanding.\n\n${action}\n\nAcknowledgement has been outstanding for ${daysOverdue} days.`,
    authorization: AUTH.FULL,
    private:       true,
    expiresAt,
  });
}

/**
 * Send overdue acceptance escalation to line manager and policy owner.
 */
async function sendAcceptanceEscalation({ managerEmail, ownerEmail, policyId, title, version, outstandingCount }) {
  return sendMessage({
    recipients:    [managerEmail, ownerEmail],
    subject:       `Escalation: Outstanding policy acknowledgements — ${policyId}`,
    body:          `${outstandingCount} staff member(s) have not yet acknowledged "${title}" (${policyId} ${version}) despite multiple reminders.\n\nPlease follow up with the individuals listed in the ProofWorks register.\n\nProofWorks: ${policyUrl(policyId)}`,
    authorization: AUTH.NONE,
    private:       false,
  });
}

/**
 * Notify owner that the policy is now fully active.
 */
async function sendActivationNotice({ ownerEmail, policyId, title, version, nextReviewDate }) {
  return sendMessage({
    recipients:    ownerEmail,
    subject:       `Policy now active: ${policyId} ${version} — ${title}`,
    body:          `All required acknowledgements have been received for "${title}" (${policyId} ${version}).\n\nStatus: ACTIVE\nNext review date: ${nextReviewDate}`,
    authorization: AUTH.NONE,
    private:       false,
  });
}

/**
 * Send 30-day review advance notice to policy owner.
 */
async function sendReviewAdvanceNotice({ ownerEmail, policyId, title, nextReviewDate }) {
  return sendMessage({
    recipients:    ownerEmail,
    subject:       `Review due in 30 days: ${policyId} — ${title}`,
    body:          `Your policy "${title}" (${policyId}) is due for review on ${nextReviewDate}.\n\nPlease prepare to initiate the review cycle. ProofWorks will automatically trigger the review on the due date.`,
    authorization: AUTH.NONE,
    private:       false,
  });
}

/**
 * Notify owner that the review cycle has been triggered.
 */
async function sendReviewTriggered({ ownerEmail, policyId, title, currentVersion }) {
  return sendMessage({
    recipients:    ownerEmail,
    subject:       `Review cycle started: ${policyId} — ${title}`,
    body:          `The scheduled review for "${title}" (${policyId} ${currentVersion}) has been triggered.\n\nThe current document has been copied to your drafts folder as a starting point. Please review and update as needed, then submit for approval.`,
    authorization: AUTH.NONE,
    private:       false,
  });
}

/**
 * Send review overdue escalation to owner and governance lead.
 */
async function sendReviewOverdueEscalation({ ownerEmail, governanceEmail, policyId, title, reviewDueDate }) {
  return sendMessage({
    recipients:    [ownerEmail, governanceEmail],
    subject:       `Review overdue: ${policyId} — ${title}`,
    body:          `The review for "${title}" (${policyId}) was due on ${reviewDueDate} and has not yet been completed.\n\nPlease action this review as a priority.`,
    authorization: AUTH.NONE,
    private:       false,
  });
}

/**
 * Send new staff onboarding acceptance request.
 * Same as acceptance request but indicates this is part of onboarding.
 */
async function sendOnboardingAcceptanceRequest({
  recipientEmail, policyId, title, version, expiresAt, documentBuffer, documentName,
}) {
  const attachmentId = await uploadAttachment(documentBuffer, documentName, 'application/pdf');

  return sendMessage({
    recipients:    recipientEmail,
    subject:       `Onboarding: Please acknowledge — ${title} (${policyId})`,
    body:          `As part of your onboarding, you are required to acknowledge the following policy.\n\nPolicy: ${title}\nReference: ${policyId} ${version}\n\nPlease read the attached document, then reply confirming:\n"I have read, understood, and accept this policy."\n\nYour access to this message is logged and forms your formal acknowledgement record.`,
    authorization: AUTH.FULL,
    private:       true,
    expiresAt,
    expiresAfter:  1,
    attachments:   [attachmentId],
  });
}

// ─── Message retrieval ───────────────────────────────────────────────────────

/**
 * Retrieve a message and its per-recipient access log.
 * Used for polling receipt status when webhooks are not configured.
 *
 * @param {string} messageId
 * @returns {Promise<object>}
 */
async function getMessage(messageId) {
  const data = await request('GET', `/message/${messageId}`);
  return data.message;
}

/**
 * List sent messages for audit purposes.
 *
 * @param {object} [opts]
 * @param {number} [opts.page=1]
 * @returns {Promise<object[]>}
 */
async function listSentMessages(opts = {}) {
  const page = opts.page || 1;
  const data = await request('GET', `/messages/sent?page=${page}`);
  return data.messages;
}

/**
 * Per-download receipt log for a message. This appliance (v4.3) has no
 * webhooks, so acknowledgement receipts are polled from here.
 *
 * Shape verified live (2026-06-12): { downloads: [{ attachment_id, filename,
 * recipient (downloader's email), downloaded_at, remote_ip, remote_host,
 * user_agent, ... }] }
 *
 * @param {string} messageId
 * @returns {Promise<object[]>}
 */
async function getMessageDownloads(messageId) {
  const data = await request('GET', `/message/${encodeURIComponent(messageId)}/downloads`);
  return data?.downloads ?? [];
}

module.exports = {
  AUTH,
  appBaseUrl,
  policyUrl,
  attestationUrl,
  sendMessage,
  sendInitiationNotice,
  sendAuthorisationRequest,
  sendExecAuthorisationRequest,
  sendOwnerAcceptanceRequest,
  sendReturnNotice,
  sendAuthorisationConfirmation,
  sendAcceptanceRequest,
  sendAcceptanceReminder,
  sendAcceptanceEscalation,
  sendActivationNotice,
  sendReviewAdvanceNotice,
  sendReviewTriggered,
  sendReviewOverdueEscalation,
  sendOnboardingAcceptanceRequest,
  getMessage,
  getMessageDownloads,
  listSentMessages,
};
