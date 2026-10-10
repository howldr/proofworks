/**
 * One-off deliverability test: send a simple LiquidFiles notification
 * message (no auth required, no attachment) to a given address.
 *
 *   node scripts/send-test-message.js someone@example.com
 */

const fs = require('fs');
const path = require('path');

for (const line of fs.readFileSync(path.join(__dirname, '..', 'variables.env'), 'utf8').split(/\r?\n/)) {
  const idx = line.indexOf(',');
  if (idx > 0) process.env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
}

const { sendMessage } = require('../src/liquidfiles/messages');
const { uploadAttachment } = require('../src/liquidfiles/client');

async function main() {
  const recipient = process.argv[2];
  if (!recipient) throw new Error('usage: node scripts/send-test-message.js recipient@example.com');
  // The appliance rejects messages without files ("You need to attach at
  // least one file"), so include a one-line text attachment.
  const attachmentId = await uploadAttachment(
    Buffer.from('ProofWorks deliverability test — no action needed.\n'),
    'deliverability-test.txt',
    'text/plain',
  );
  const msg = await sendMessage({
    recipients:    recipient,
    subject:       'ProofWorks deliverability test (PTR fix verification)',
    body:          'If you are reading this, direct email delivery from sft.howldr.com is working.\n\nSent automatically as part of fixing the reverse-DNS issue. No action needed.',
    authorization: 0,
    private:       false,
    attachments:   [attachmentId],
  });
  console.log(`sent: message id ${msg.id} → ${recipient}`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
