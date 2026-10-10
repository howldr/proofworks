/**
 * Audit event spine tests.
 *
 * Layer 1 — pure chain core (src/audit/spine.js): canonicalisation,
 * hashing, and verifyChain tamper detection. No mocks, no I/O.
 *
 * Layer 2 — API (GET /api/audit, GET /api/audit/verify): supertest against
 * the app factory with a mocked db layer, matching api.test.js conventions.
 */

process.env.SUPABASE_JWT_SECRET = 'test-jwt-secret';

jest.mock('../src/db/db');
jest.mock('../src/liquidfiles/folders');
jest.mock('../src/liquidfiles/messages');
jest.mock('../src/auth/admin');

const jwt     = require('jsonwebtoken');
const request = require('supertest');

const db    = require('../src/db/db');
const spine = require('../src/audit/spine');
const { createApp } = require('../src/app');

// ─── Layer 1: pure chain core ─────────────────────────────────────────────────

describe('spine.canonicalise', () => {
  test('sorts object keys at every depth', () => {
    const a = spine.canonicalise({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } });
    const b = spine.canonicalise({ a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"c":[3,{"e":5,"f":4}],"d":2},"b":1}');
  });

  test('null, undefined, and arrays are stable', () => {
    expect(spine.canonicalise(null)).toBe('null');
    expect(spine.canonicalise(undefined)).toBe('null');
    expect(spine.canonicalise([1, 'x', null])).toBe('[1,"x",null]');
  });
});

// Build a chain of DB-shaped rows exactly the way db.appendAuditEvent does.
function buildChain(tenantId, events) {
  const rows = [];
  let prevHash = spine.GENESIS;
  events.forEach((e, i) => {
    const event = {
      tenantId,
      occurredAt: `2026-07-08T12:0${i}:00.000Z`,
      actorEmail: e.actor ?? null,
      action:     e.action,
      objectType: e.type,
      objectId:   e.id,
      metadata:   e.metadata ?? null,
    };
    const eventHash = spine.computeEventHash(prevHash, event);
    rows.push({
      id: i + 1,
      tenant_id:   tenantId,
      occurred_at: event.occurredAt,
      actor_email: event.actorEmail,
      action:      event.action,
      object_type: event.objectType,
      object_id:   event.objectId,
      metadata:    event.metadata,
      prev_hash:   prevHash,
      event_hash:  eventHash,
    });
    prevHash = eventHash;
  });
  return rows;
}

const CHAIN_EVENTS = [
  { action: 'created',      type: 'policy',   id: 'POL-2026-001', actor: 'admin@acme.example' },
  { action: 'approved',     type: 'policy',   id: 'POL-2026-001', actor: 'ciso@acme.example',
    metadata: { to_status: 'PENDING_ACCEPTANCE', version: 'v1.0' } },
  { action: 'registered',   type: 'evidence', id: 'EVD-2026-001', actor: 'owner@acme.example',
    metadata: { checksum: 'ab'.repeat(32) } },
  { action: 'assessed',     type: 'risk',     id: 'RSK-2026-001', actor: 'owner@acme.example',
    metadata: { round: 1, residual_score: 6 } },
  { action: 'accepted',     type: 'risk',     id: 'RSK-2026-001', actor: 'ceo@acme.example',
    metadata: { round: 1 } },
];

describe('spine.verifyChain', () => {
  test('an untouched chain verifies intact from genesis', () => {
    const rows = buildChain(1, CHAIN_EVENTS);
    expect(spine.verifyChain(rows)).toEqual({
      intact: true, checked: 5, breakAt: null, reason: null,
    });
  });

  test('an empty chain is intact', () => {
    expect(spine.verifyChain([]).intact).toBe(true);
  });

  test('editing any stored field breaks the chain at that row', () => {
    const rows = buildChain(1, CHAIN_EVENTS);
    rows[2].actor_email = 'attacker@evil.example';   // rewrite history
    const result = spine.verifyChain(rows);
    expect(result.intact).toBe(false);
    expect(result.breakAt).toBe(3);
    expect(result.reason).toBe('event_hash mismatch');
  });

  test('editing metadata breaks the chain', () => {
    const rows = buildChain(1, CHAIN_EVENTS);
    rows[3].metadata = { round: 1, residual_score: 1 };  // launder the score
    const result = spine.verifyChain(rows);
    expect(result.intact).toBe(false);
    expect(result.breakAt).toBe(4);
  });

  test('deleting a row breaks the link that followed it', () => {
    const rows = buildChain(1, CHAIN_EVENTS);
    rows.splice(1, 1);                               // drop the approval
    const result = spine.verifyChain(rows);
    expect(result.intact).toBe(false);
    expect(result.reason).toBe('prev_hash mismatch');
  });

  test('reordering rows breaks the chain', () => {
    const rows = buildChain(1, CHAIN_EVENTS);
    [rows[1], rows[2]] = [rows[2], rows[1]];
    expect(spine.verifyChain(rows).intact).toBe(false);
  });

  test('a forged tail with a self-consistent hash still fails (wrong prev link)', () => {
    const rows = buildChain(1, CHAIN_EVENTS);
    const forged = { ...rows[4], action: 'rejected' };
    forged.event_hash = spine.computeEventHash(spine.GENESIS, {
      tenantId: 1, occurredAt: forged.occurred_at, actorEmail: forged.actor_email,
      action: forged.action, objectType: forged.object_type, objectId: forged.object_id,
      metadata: forged.metadata,
    });
    forged.prev_hash = spine.GENESIS;
    rows[4] = forged;
    expect(spine.verifyChain(rows).intact).toBe(false);
  });
});

// ─── Layer 2: API ─────────────────────────────────────────────────────────────

const TENANT = {
  id: 1, slug: 'default', name: 'Default', status: 'active', lf_share_name: 'policies',
  exec_required_categories: [],
  owner_acceptance_required: false,
  entitlements: ['policy_hub'],
};

const USERS = {
  admin:  { id: 'u-admin',  email: 'admin@acme.example',  role: 'admin',          tenant_id: 1 },
  gov:    { id: 'u-gov',    email: 'gov@acme.example',    role: 'governance_lead', tenant_id: 1 },
  viewer: { id: 'u-viewer', email: 'viewer@acme.example', role: 'viewer',          tenant_id: 1 },
  owner:  { id: 'u-owner',  email: 'owner@acme.example',  role: 'owner',           tenant_id: 1 },
  auth:   { id: 'u-auth',   email: 'ciso@acme.example',   role: 'authoriser',      tenant_id: 1 },
};

function tokenFor(user) {
  return jwt.sign({ sub: user.id }, process.env.SUPABASE_JWT_SECRET, {
    algorithm: 'HS256',
    audience:  'authenticated',
    expiresIn: '1h',
  });
}

function asUser(req, user) {
  return req.set('Authorization', `Bearer ${tokenFor(user)}`);
}

let app;

beforeEach(() => {
  jest.clearAllMocks();
  db.getTenantByCustomDomain.mockResolvedValue(null);
  db.getTenantBySlug.mockResolvedValue(TENANT);
  db.getAppUserById.mockImplementation(async (id) =>
    Object.values(USERS).find(u => u.id === id) || null
  );
  app = createApp();
});

describe('GET /api/audit', () => {
  test('returns events for audit-grade roles', async () => {
    const rows = buildChain(1, CHAIN_EVENTS).reverse();  // list endpoint is latest-first
    db.getAuditEvents.mockResolvedValue(rows);
    for (const user of [USERS.admin, USERS.gov, USERS.viewer]) {
      const res = await asUser(request(app).get('/api/audit'), user);
      expect(res.status).toBe(200);
      expect(res.body.events).toHaveLength(5);
      expect(res.body.events[0].action).toBe('accepted');
    }
  });

  test('passes filters through to the db layer', async () => {
    db.getAuditEvents.mockResolvedValue([]);
    const res = await asUser(
      request(app).get('/api/audit?object_type=risk&object_id=RSK-2026-001&action=accepted&limit=10'),
      USERS.admin
    );
    expect(res.status).toBe(200);
    expect(db.getAuditEvents).toHaveBeenCalledWith(1, {
      objectType: 'risk', objectId: 'RSK-2026-001', action: 'accepted', limit: '10',
    });
  });

  test('is denied to owner and authoriser roles', async () => {
    for (const user of [USERS.owner, USERS.auth]) {
      const res = await asUser(request(app).get('/api/audit'), user);
      expect(res.status).toBe(403);
    }
  });

  test('is denied without authentication', async () => {
    const res = await request(app).get('/api/audit');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/audit/verify', () => {
  test('reports an intact chain', async () => {
    db.getAuditChain.mockResolvedValue(buildChain(1, CHAIN_EVENTS));
    const res = await asUser(request(app).get('/api/audit/verify'), USERS.viewer);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      intact: true, events_checked: 5, break_at: null, reason: null,
    });
  });

  test('detects a tampered row and names it', async () => {
    const rows = buildChain(1, CHAIN_EVENTS);
    rows[1].metadata = { to_status: 'PENDING_ACCEPTANCE', version: 'v9.9' };
    db.getAuditChain.mockResolvedValue(rows);
    const res = await asUser(request(app).get('/api/audit/verify'), USERS.admin);
    expect(res.status).toBe(200);
    expect(res.body.intact).toBe(false);
    expect(res.body.break_at).toBe(2);
    expect(res.body.reason).toBe('event_hash mismatch');
  });

  test('is denied to non-audit roles', async () => {
    const res = await asUser(request(app).get('/api/audit/verify'), USERS.owner);
    expect(res.status).toBe(403);
  });
});
