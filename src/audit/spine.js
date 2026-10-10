/**
 * howldr ProofWorks
 * Audit event spine — hash-chain core (pure, no I/O)
 *
 * The spine is the cross-module, append-only ledger every module writes to
 * (policy transitions, evidence events, risk events — and future modules).
 * Each event is chained to its predecessor per tenant:
 *
 *   event_hash = sha256( prev_hash + '\n' + canonicalise(event fields) )
 *
 * so the ledger is tamper-EVIDENT: editing, deleting, or reordering any past
 * row breaks every hash after it. Verification (verifyChain) recomputes the
 * chain from genesis and reports the first break. Signing individual events
 * is deferred until a key-custody story exists (ADR 0003 §7) — the chain
 * carries the integrity guarantee until then.
 *
 * Everything in this file is pure and synchronous so it can be unit-tested
 * without a database; db.appendAuditEvent() owns locking + persistence.
 */

const crypto = require('crypto');

/** prev_hash of the first event in a tenant's chain. */
const GENESIS = '0'.repeat(64);

/**
 * Deterministic JSON: objects serialise with sorted keys at every depth so
 * the same logical event always produces the same bytes. Arrays keep order
 * (order is meaningful). undefined collapses to null.
 */
function canonicalise(value) {
  if (value === undefined || value === null) return 'null';
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalise).join(',') + ']';
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalise(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

/**
 * The exact fields that are hashed — anything not listed here can change
 * without breaking the chain, so keep this the complete evidentiary core.
 */
function hashableFields(event) {
  return {
    tenant_id:   Number(event.tenantId),
    occurred_at: event.occurredAt,               // ISO-8601 string, set by the writer
    actor_email: event.actorEmail ?? null,
    action:      event.action,
    object_type: event.objectType,
    object_id:   event.objectId,
    metadata:    event.metadata ?? null,
  };
}

/** sha256 hex of the event chained onto prevHash. */
function computeEventHash(prevHash, event) {
  const body = canonicalise(hashableFields(event));
  return crypto.createHash('sha256')
    .update(`${prevHash}\n${body}`)
    .digest('hex');
}

/**
 * Walk a tenant's chain (rows ordered by id ascending, as stored) and
 * recompute every link.
 *
 * Rows are DB rows: snake_case columns, metadata already parsed (jsonb).
 * Returns { intact, checked, breakAt } where breakAt is the id of the first
 * row whose stored hash (or stored prev link) fails to recompute.
 */
function verifyChain(rows) {
  let prevHash = GENESIS;
  for (const row of rows) {
    if (row.prev_hash !== prevHash) {
      return { intact: false, checked: rows.length, breakAt: row.id, reason: 'prev_hash mismatch' };
    }
    const expected = computeEventHash(prevHash, {
      tenantId:    row.tenant_id,
      occurredAt:  row.occurred_at instanceof Date ? row.occurred_at.toISOString() : row.occurred_at,
      actorEmail:  row.actor_email,
      action:      row.action,
      objectType:  row.object_type,
      objectId:    row.object_id,
      metadata:    row.metadata,
    });
    if (row.event_hash !== expected) {
      return { intact: false, checked: rows.length, breakAt: row.id, reason: 'event_hash mismatch' };
    }
    prevHash = row.event_hash;
  }
  return { intact: true, checked: rows.length, breakAt: null, reason: null };
}

module.exports = { GENESIS, canonicalise, computeEventHash, verifyChain };
