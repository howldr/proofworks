/**
 * howldr ProofWorks
 * Public read-and-accept (attestation) endpoints
 *
 *   GET  /api/attest/:token   what am I accepting? (policy summary)
 *   POST /api/attest/:token   record "I have read and accept"
 *
 * Deliberately NOT tenant- or user-gated: the recipient is a staff member
 * with no ProofWorks account. The high-entropy bearer token minted at
 * distribution (one per recipient per version) is the authorisation, and
 * the row it resolves to carries its own tenant. Attestation is the explicit
 * agreement tier on top of the authenticated-download receipt; it also
 * counts as the acknowledgement, so it advances totals and can activate
 * the policy when it is the last one in.
 */

const express = require('express');
const router  = express.Router();

const db = require('../db/db');
const { STATUS } = require('../register/register');
const { activatePolicy } = require('../notifications/receipts');

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{16,128}$/;

async function lookupToken(req, res) {
  if (!TOKEN_SHAPE.test(req.params.token)) {
    res.status(404).json({ error: 'This acceptance link is not valid.' });
    return null;
  }
  const ack = await db.getAcknowledgementByToken(req.params.token);
  if (!ack) {
    res.status(404).json({ error: 'This acceptance link is not valid.' });
    return null;
  }
  return ack;
}

function summary(ack) {
  return {
    organisation: ack.tenant_name,
    policy: {
      id:      ack.policy_id,
      title:   ack.title,
      version: ack.version,
    },
    recipient:         ack.recipient_email,
    deadline:          ack.expires_at,
    document_checksum: ack.document_checksum,
    downloaded:        ack.download_count != null && ack.download_count > 0,
    attested_at:       ack.attested_at,
  };
}

router.get('/:token', async (req, res) => {
  try {
    const ack = await lookupToken(req, res);
    if (!ack) return;
    res.json(summary(ack));
  } catch (err) {
    console.error('GET /attest failed:', err);
    res.status(500).json({ error: 'Something went wrong — please try again.' });
  }
});

router.post('/:token', async (req, res) => {
  try {
    const ack = await lookupToken(req, res);
    if (!ack) return;

    if (ack.attested_at) {
      // Idempotent: the first attestation stands.
      return res.json({
        message: 'Your acceptance was already recorded.',
        ...summary(ack),
      });
    }

    const wasAcknowledged = ack.acknowledged_at != null;
    const updated = await db.recordAttestation(ack.tenant_id, ack.id, req.ip);
    await db.logChange({
      tenantId:   ack.tenant_id,
      policyId:   ack.policy_id,
      event:      `Attestation recorded: ${ack.recipient_email} accepted ${ack.version}`,
      actorEmail: ack.recipient_email,
      metadata:   {
        attest_ip:         req.ip || null,
        document_checksum: ack.document_checksum || null,
        lf_file_id:        ack.lf_file_id || null,
      },
    });

    // If the download receipt hadn't landed yet, this attestation IS the
    // acknowledgement — advance the counts and activate on the last one.
    if (!wasAcknowledged) {
      const counts = await db.incrementAcknowledgementCount(ack.tenant_id, ack.policy_id);
      if (counts && counts.acknowledgement_count >= counts.acknowledgement_total) {
        const policy = await db.getPolicyById(ack.tenant_id, ack.policy_id);
        if (policy && policy.status === STATUS.PENDING_ACCEPTANCE) {
          await activatePolicy(policy);
        }
      }
    }

    res.json({
      message: 'Thank you — your acceptance has been recorded.',
      ...summary({ ...ack, ...(updated || { attested_at: new Date().toISOString() }) }),
    });
  } catch (err) {
    console.error('POST /attest failed:', err);
    res.status(500).json({ error: 'Something went wrong — please try again.' });
  }
});

module.exports = router;
