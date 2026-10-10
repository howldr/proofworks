/**
 * One-off probe: inspect the shape of sent-message + per-recipient receipt
 * data on the live LiquidFiles appliance (v4.3). Reads creds from
 * variables.env (comma format NAME,value). Read-only.
 *
 *   node scripts/probe-message-receipts.js [messageId]
 */

const fs = require('fs');
const path = require('path');

for (const line of fs.readFileSync(path.join(__dirname, '..', 'variables.env'), 'utf8').split(/\r?\n/)) {
  const idx = line.indexOf(',');
  if (idx > 0) process.env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
}

const { request, requestBinary } = require('../src/liquidfiles/client');

async function main() {
  const messageId = process.argv[2];
  if (messageId === '--download-test') {
    // Consume the TEST-0000-000 message's attachment to populate its
    // downloads list, then dump the receipt shape.
    const msg = (await request('GET', '/message/6gSgUsszVxPL5KdPoDCRvE')).message;
    const url = new URL(msg.attachments[0].url);
    const bin = await requestBinary('GET', url.pathname);
    console.log('downloaded bytes:', bin.buffer.length);
    const downloads = await request('GET', '/message/6gSgUsszVxPL5KdPoDCRvE/downloads');
    console.log(JSON.stringify(downloads, null, 2));
    return;
  }
  if (messageId) {
    const data = await request('GET', `/message/${messageId}/downloads`).catch(() => null);
    console.log('downloads:', JSON.stringify(data, null, 2));
    const msg = await request('GET', `/message/${messageId}`);
    console.log(JSON.stringify(msg, null, 2));
    return;
  }
  const data = await request('GET', '/messages/sent?page=1');
  const messages = data.messages || data;
  console.log(`--- ${Array.isArray(messages) ? messages.length : '?'} sent messages on page 1 ---`);
  console.log(JSON.stringify(messages, null, 2).slice(0, 6000));
}

main().catch(err => { console.error(err); process.exit(1); });
