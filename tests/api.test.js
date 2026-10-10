/**
 * API integration tests — supertest against the app factory with a mocked
 * db layer. No live Postgres or LiquidFiles required.
 */

process.env.SUPABASE_JWT_SECRET = 'test-jwt-secret';

jest.mock('../src/db/db');
jest.mock('../src/liquidfiles/folders');
jest.mock('../src/liquidfiles/messages');
jest.mock('../src/auth/admin');

const jwt     = require('jsonwebtoken');
const request = require('supertest');

const db    = require('../src/db/db');
const lf    = require('../src/liquidfiles/folders');
const msg   = require('../src/liquidfiles/messages');
const admin = require('../src/auth/admin');
const { createApp } = require('../src/app');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// exec_required_categories uses 'Security' — a category BASE_POLICY (IT) doesn't
// use — so the exec gate only fires in tests that opt in with a Security policy.
// (The tenant middleware caches the fixture for 60s, so this can't be overridden
// per-test; it must live on the shared fixture.) owner_acceptance_required is a
// boolean that varies per test — the cache holds TENANT by reference, so tests
// mutate the flag inline; beforeEach resets it to false for isolation.
const TENANT = {
  id: 1, slug: 'default', name: 'Default', status: 'active', lf_share_name: 'policies',
  exec_required_categories: ['Security'],
  owner_acceptance_required: false,
  entitlements: ['policy_hub'],
};

const LF_FOLDERS = {
  root: 'p-root', current: 'p-current', training: 'p-training',
  drafts: 'p-drafts', archive: 'p-archive', acks: 'p-acks',
};

const USERS = {
  admin:      { id: 'u-admin',      email: 'admin@acme.example',      role: 'admin',           tenant_id: 1 },
  owner:      { id: 'u-owner',      email: 'owner@acme.example',      role: 'owner',           tenant_id: 1 },
  authoriser: { id: 'u-auth',       email: 'ciso@acme.example',       role: 'authoriser',      tenant_id: 1 },
  viewer:     { id: 'u-viewer',     email: 'viewer@acme.example',     role: 'viewer',          tenant_id: 1 },
  staff:      { id: 'u-staff',      email: 'staff@acme.example',      role: 'staff',           tenant_id: 1 },
  acceptor:   { id: 'u-acceptor',   email: 'signer@acme.example',     role: 'acceptor',        tenant_id: 1 },
  exec:       { id: 'u-exec',       email: 'ceo@acme.example',        role: 'viewer',          tenant_id: 1 },
  outsider:   { id: 'u-outsider',   email: 'spy@other.example',       role: 'admin',           tenant_id: 2 },
  support:    { id: 'u-support',    email: 'support@howldr.com',      role: 'howldr_support',  tenant_id: null },
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

// Build a db.getRouteState() return value from a compact stage spec:
//   [{ threshold, members:[emails], approvedBy?:[emails], returnedBy?:[emails] }]
// threshold null = all; integer = quorum.
function routeState(stages) {
  const built = stages.map((s, i) => {
    const approvedBy = new Set(s.approvedBy || []);
    const returnedBy = new Set(s.returnedBy || []);
    const members = s.members.map(email => ({
      email,
      decision: approvedBy.has(email) ? 'approved' : returnedBy.has(email) ? 'returned' : null,
      decidedAt: approvedBy.has(email) || returnedBy.has(email) ? new Date().toISOString() : null,
      feedback: null,
    }));
    const approved = members.filter(m => m.decision === 'approved').length;
    const required = s.threshold == null ? s.members.length : Math.min(s.threshold, s.members.length);
    const satisfied = s.members.length > 0 && approved >= required;
    return {
      position: i + 1, threshold: s.threshold ?? null, members,
      memberCount: s.members.length, approved, required, satisfied,
    };
  });
  const activeStage = built.find(s => !s.satisfied) || null;
  const fullyApproved = built.length > 0 && built.every(s => s.satisfied);
  return { stages: built, activeStage, fullyApproved };
}

const BASE_POLICY = {
  policy_id: 'POL-2026-001',
  title: 'Acceptable Use Policy',
  category: 'IT',
  owner_email: USERS.owner.email,
  current_version: 'v1.3',
  status: 'UNDER_REVIEW',
  review_frequency_months: 12,
  applicable_roles: ['all-staff'],
  acknowledgement_count: 0,
  acknowledgement_total: 0,
  tenant_id: 1,
};

let app;

beforeEach(() => {
  jest.clearAllMocks();

  // Tenant resolution: no custom domain, dev fallback to 'default'.
  db.getTenantByCustomDomain.mockResolvedValue(null);
  db.getTenantBySlug.mockResolvedValue(TENANT);

  // Auth resolution: map token sub → fixture user.
  db.getAppUserById.mockImplementation(async (id) =>
    Object.values(USERS).find(u => u.id === id) || null
  );

  // Common defaults; individual tests override as needed.
  db.getPolicyById.mockResolvedValue({ ...BASE_POLICY });
  db.getAuthorisers.mockResolvedValue([{ email: USERS.authoriser.email, stage_position: 1 }]);
  // Default route: one stage, one member (the authoriser), not yet approved.
  db.getRouteState.mockResolvedValue(routeState([{ threshold: null, members: [USERS.authoriser.email] }]));
  db.setAuthorisationRoute.mockResolvedValue();
  db.setAuthorisers.mockResolvedValue();
  db.recordApproval.mockResolvedValue();
  db.recordReturn.mockResolvedValue();
  db.recordExecDecision.mockResolvedValue();
  db.getExecDecision.mockResolvedValue(null);
  db.recordOwnerDecision.mockResolvedValue();
  db.getOwnerDecision.mockResolvedValue(null);
  // Reset the per-tenant toggles (the fixture is cached by reference).
  TENANT.owner_acceptance_required = false;
  TENANT.entitlements = ['policy_hub'];
  db.updatePolicy.mockImplementation(async (_t, _id, updates) => ({ ...BASE_POLICY, ...updates }));
  db.logChange.mockResolvedValue();
  db.listPolicies.mockResolvedValue([{ ...BASE_POLICY }]);
  // Risk↔policy↔evidence links: detail endpoints include reverse lookups, and
  // link writes validate ids exist. Default: no linked risks, every id exists.
  db.getRisksLinkedToPolicy.mockResolvedValue([]);
  db.getRisksLinkedToEvidence.mockResolvedValue([]);
  db.filterExistingPolicyIds.mockImplementation(async (_t, ids) => ids ?? []);
  db.filterExistingEvidenceIds.mockImplementation(async (_t, ids) => ids ?? []);
  // Audit spine + audit-pack extras.
  db.getAuditChain.mockResolvedValue([]);
  db.listRiskAssessments.mockResolvedValue([]);
  db.listRiskAcceptances.mockResolvedValue([]);

  lf.createPolicyFolders.mockResolvedValue({ ...LF_FOLDERS });
  lf.uploadFileToFolder.mockResolvedValue({
    id: 'lf-file-1', name: 'stored.docx', size: 1234, checksum: 'sha256-test',
  });
  lf.listFiles.mockResolvedValue([]);
  lf.downloadFile.mockResolvedValue({ buffer: Buffer.from('doc'), contentType: 'application/pdf' });

  msg.sendAuthorisationRequest.mockResolvedValue({ id: 'lf-msg-1' });
  msg.sendAuthorisationConfirmation.mockResolvedValue({ id: 'lf-msg-2' });
  msg.sendReturnNotice.mockResolvedValue({ id: 'lf-msg-3' });
  msg.sendExecAuthorisationRequest.mockResolvedValue({ id: 'lf-msg-exec' });
  msg.sendOwnerAcceptanceRequest.mockResolvedValue({ id: 'lf-msg-owner' });

  // Supabase admin (invite) — configured by default; individual tests override.
  admin.isInviteConfigured.mockReturnValue(true);
  admin.adminClient.mockReturnValue({});
  admin.generateInviteOrReuse.mockResolvedValue({
    user: { id: 'new-auth-uuid', email: 'invitee@acme.example' },
    actionLink: 'https://auth.example/invite#token',
    reused: false,
  });

  app = createApp();
});

// NOTE: the tenant middleware caches lookups for 60s (module-level cache).
// All tests use the same TENANT fixture, so the cache is benign here.

// ─── Health & root ────────────────────────────────────────────────────────────

describe('GET /health', () => {
  test('reports ok when the db responds', async () => {
    db.healthCheck.mockResolvedValue({ time: '2026-06-11T12:00:00Z' });
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('reports error when the db is down', async () => {
    db.healthCheck.mockRejectedValue(new Error('no db'));
    const res = await request(app).get('/health');
    expect(res.status).toBe(500);
    expect(res.body.status).toBe('error');
  });
});

// ─── Authentication ───────────────────────────────────────────────────────────

describe('authentication', () => {
  test('rejects requests without a token', async () => {
    const res = await request(app).get('/api/policies');
    expect(res.status).toBe(401);
  });

  test('rejects a token signed with the wrong secret', async () => {
    const bad = jwt.sign({ sub: USERS.admin.id }, 'wrong-secret', {
      algorithm: 'HS256', audience: 'authenticated',
    });
    const res = await request(app).get('/api/policies').set('Authorization', `Bearer ${bad}`);
    expect(res.status).toBe(401);
  });

  test('rejects a valid token whose user has no app_users row', async () => {
    db.getAppUserById.mockResolvedValue(null);
    const res = await asUser(request(app).get('/api/policies'), USERS.admin);
    expect(res.status).toBe(401);
  });

  test('rejects users from another tenant', async () => {
    const res = await asUser(request(app).get('/api/policies'), USERS.outsider);
    expect(res.status).toBe(403);
  });

  test('allows howldr_support across tenants', async () => {
    const res = await asUser(request(app).get('/api/policies'), USERS.support);
    expect(res.status).toBe(200);
  });

  describe('self-healing email re-bind', () => {
    function tokenWithEmail(sub, email, emailVerified) {
      return jwt.sign(
        { sub, email, user_metadata: { email_verified: emailVerified } },
        process.env.SUPABASE_JWT_SECRET,
        { algorithm: 'HS256', audience: 'authenticated', expiresIn: '1h' },
      );
    }

    test('unknown sub with a verified email match re-binds and authenticates', async () => {
      db.getAppUserById.mockResolvedValue(null);
      db.rebindAppUserByEmail.mockResolvedValue({ ...USERS.admin, id: 'u-new-oauth' });

      const res = await request(app)
        .get('/api/policies')
        .set('Authorization', `Bearer ${tokenWithEmail('u-new-oauth', USERS.admin.email, true)}`);

      expect(res.status).toBe(200);
      expect(db.rebindAppUserByEmail).toHaveBeenCalledWith(USERS.admin.email, 'u-new-oauth');
    });

    test('unverified email never re-binds', async () => {
      db.getAppUserById.mockResolvedValue(null);

      const res = await request(app)
        .get('/api/policies')
        .set('Authorization', `Bearer ${tokenWithEmail('u-attacker', USERS.admin.email, false)}`);

      expect(res.status).toBe(401);
      expect(db.rebindAppUserByEmail).not.toHaveBeenCalled();
    });

    test('token without an email claim never re-binds', async () => {
      db.getAppUserById.mockResolvedValue(null);
      const res = await asUser(request(app).get('/api/policies'), USERS.admin);
      expect(res.status).toBe(401);
      expect(db.rebindAppUserByEmail).not.toHaveBeenCalled();
    });

    test('verified email with no matching row stays unauthenticated', async () => {
      db.getAppUserById.mockResolvedValue(null);
      db.rebindAppUserByEmail.mockResolvedValue(null);

      const res = await request(app)
        .get('/api/policies')
        .set('Authorization', `Bearer ${tokenWithEmail('u-stranger', 'stranger@nowhere.example', true)}`);

      expect(res.status).toBe(401);
    });
  });

  describe('ES256 tokens (Supabase asymmetric signing keys)', () => {
    const crypto = require('node:crypto');
    const { resetJwksCache } = require('../src/middleware/auth');
    const KID = 'test-key-1';

    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
      namedCurve: 'P-256',
    });

    function es256TokenFor(user, { kid = KID } = {}) {
      return jwt.sign({ sub: user.id }, privateKey, {
        algorithm: 'ES256',
        audience:  'authenticated',
        expiresIn: '1h',
        keyid:     kid,
      });
    }

    beforeEach(() => {
      process.env.SUPABASE_URL = 'https://test-project.supabase.co';
      resetJwksCache();
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          keys: [{ ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'ES256' }],
        }),
      });
    });

    afterEach(() => {
      delete global.fetch;
      resetJwksCache();
    });

    test('accepts a valid ES256 token via JWKS', async () => {
      const res = await request(app)
        .get('/api/policies')
        .set('Authorization', `Bearer ${es256TokenFor(USERS.admin)}`);
      expect(res.status).toBe(200);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://test-project.supabase.co/auth/v1/.well-known/jwks.json',
      );
    });

    test('rejects an ES256 token signed by an unknown key', async () => {
      const { privateKey: rogue } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
      const bad = jwt.sign({ sub: USERS.admin.id }, rogue, {
        algorithm: 'ES256', audience: 'authenticated', keyid: KID,
      });
      const res = await request(app)
        .get('/api/policies')
        .set('Authorization', `Bearer ${bad}`);
      expect(res.status).toBe(401);
    });

    test('rejects a token whose kid is not in the JWKS', async () => {
      const res = await request(app)
        .get('/api/policies')
        .set('Authorization', `Bearer ${es256TokenFor(USERS.admin, { kid: 'unknown-kid' })}`);
      expect(res.status).toBe(401);
    });
  });
});

// ─── Who am I ─────────────────────────────────────────────────────────────────

describe('GET /api/me', () => {
  test('rejects anonymous requests', async () => {
    const res = await request(app).get('/api/me');
    expect(res.status).toBe(401);
  });

  test('returns user identity, role, and tenant', async () => {
    db.getTenantById.mockResolvedValue(TENANT);
    const res = await asUser(request(app).get('/api/me'), USERS.owner);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id:           USERS.owner.id,
      email:        USERS.owner.email,
      role:         'owner',
      tenant:       { slug: TENANT.slug, name: TENANT.name, theme: 'howldr', themeAccent: null, logo: null },
      entitlements: ['policy_hub'],
    });
    expect(db.getTenantById).toHaveBeenCalledWith(USERS.owner.tenant_id);
  });

  test('howldr_support has no tenant and sees every module', async () => {
    const res = await asUser(request(app).get('/api/me'), USERS.support);
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('howldr_support');
    expect(res.body.tenant).toBeNull();
    expect(res.body.entitlements).toEqual(
      expect.arrayContaining(['policy_hub', 'evidence_locker', 'risk_register']),
    );
    expect(db.getTenantById).not.toHaveBeenCalled();
  });
});

// ─── Module entitlements ──────────────────────────────────────────────────────

describe('module entitlements', () => {
  test('a workspace without the Policy Hub module is blocked from its routes', async () => {
    TENANT.entitlements = []; // gate reads the cached fixture by reference
    const res = await asUser(request(app).get('/api/policies'), USERS.owner);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'module_not_enabled', module: 'policy_hub' });
    expect(db.listPolicies).not.toHaveBeenCalled();
  });

  test('howldr_support bypasses the module gate', async () => {
    TENANT.entitlements = [];
    // support acts within a tenant via the /t/{slug}/ path prefix.
    db.getTenantBySlug.mockResolvedValue(TENANT);
    const res = await asUser(request(app).get('/t/default/api/policies'), USERS.support);
    expect(res.status).toBe(200);
  });
});

// ─── Listing & role filters ───────────────────────────────────────────────────

describe('GET /api/policies', () => {
  test('admin sees the unfiltered tenant list', async () => {
    const res = await asUser(request(app).get('/api/policies'), USERS.admin);
    expect(res.status).toBe(200);
    const filter = db.listPolicies.mock.calls[0][0];
    expect(filter.tenantId).toBe(TENANT.id);
    expect(filter.owner).toBeUndefined();
    expect(filter.authoriserEmail).toBeUndefined();
  });

  test('owner list is filtered to their own policies', async () => {
    await asUser(request(app).get('/api/policies'), USERS.owner);
    expect(db.listPolicies.mock.calls[0][0].owner).toBe(USERS.owner.email);
  });

  test('authoriser list is filtered to assigned policies', async () => {
    await asUser(request(app).get('/api/policies'), USERS.authoriser);
    expect(db.listPolicies.mock.calls[0][0].authoriserEmail).toBe(USERS.authoriser.email);
  });
});

// ─── Creation ─────────────────────────────────────────────────────────────────

describe('POST /api/policies', () => {
  const body = { title: 'New Policy', category: 'HR', owner: USERS.owner.email, authorisers: ['ciso@acme.example'] };

  test('viewer cannot create', async () => {
    const res = await asUser(request(app).post('/api/policies').send(body), USERS.viewer);
    expect(res.status).toBe(403);
  });

  test('missing fields → 400', async () => {
    const res = await asUser(request(app).post('/api/policies').send({ title: 'x' }), USERS.admin);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing required fields: category, owner/);
  });

  test('admin creates a DRAFT v0.1 policy with audit log and LF folders', async () => {
    db.allocatePolicyId.mockResolvedValue('POL-2026-009');
    db.createPolicy.mockImplementation(async (data) => data);

    const res = await asUser(request(app).post('/api/policies').send(body), USERS.admin);
    expect(res.status).toBe(201);
    expect(res.body.policy_id).toBe('POL-2026-009');
    expect(res.body.status).toBe('DRAFT');
    expect(res.body.current_version).toBe('v0.1');
    expect(res.body.storage).toBe('ready');
    expect(res.body.lf_folder_ids).toEqual(LF_FOLDERS);
    expect(lf.createPolicyFolders).toHaveBeenCalledWith(TENANT.lf_share_name, 'POL-2026-009');
    // A flat `authorisers` list becomes a single all-must-approve stage.
    expect(db.setAuthorisationRoute).toHaveBeenCalledWith(TENANT.id, 'POL-2026-009', [
      { threshold: null, members: ['ciso@acme.example'] },
    ]);
    expect(db.logChange).toHaveBeenCalledWith(expect.objectContaining({
      event: 'Policy initiated', actorEmail: USERS.admin.email,
    }));
  });

  test('create with an executive assigns exec_email (lowercased)', async () => {
    db.allocatePolicyId.mockResolvedValue('POL-2026-012');
    db.createPolicy.mockImplementation(async (data) => data);
    const res = await asUser(
      request(app).post('/api/policies').send({ ...body, exec: 'CEO@acme.example' }),
      USERS.admin,
    );
    expect(res.status).toBe(201);
    expect(db.createPolicy).toHaveBeenCalledWith(expect.objectContaining({
      exec_email: 'ceo@acme.example',
    }));
  });

  test('create rejects an invalid exec email', async () => {
    const res = await asUser(
      request(app).post('/api/policies').send({ ...body, exec: 'not-an-email' }),
      USERS.admin,
    );
    expect(res.status).toBe(400);
    expect(db.createPolicy).not.toHaveBeenCalled();
  });

  test('appliance failure does not block creation — storage pending', async () => {
    db.allocatePolicyId.mockResolvedValue('POL-2026-010');
    db.createPolicy.mockImplementation(async (data) => data);
    lf.createPolicyFolders.mockRejectedValue(new Error('appliance unreachable'));

    const res = await asUser(request(app).post('/api/policies').send(body), USERS.admin);
    expect(res.status).toBe(201);
    expect(res.body.storage).toBe('pending');
    expect(res.body.lf_folder_ids).toEqual({
      root: null, current: null, training: null, drafts: null, archive: null, acks: null,
    });
  });
});

// ─── Document upload ──────────────────────────────────────────────────────────

describe('POST /api/policies/:id/document', () => {
  const DOC_BYTES = Buffer.from('fake docx bytes');

  function uploadAs(user, { filename = 'My Policy.docx', policy = {} } = {}) {
    db.getPolicyById.mockResolvedValue({ ...BASE_POLICY, lf_folder_ids: { ...LF_FOLDERS }, ...policy });
    return asUser(
      request(app)
        .post(`/api/policies/POL-2026-001/document?filename=${encodeURIComponent(filename)}`)
        .set('Content-Type', 'application/octet-stream')
        .send(DOC_BYTES),
      user
    );
  }

  test('owner uploads → stored in /drafts/ under versioned name + changelog', async () => {
    const res = await uploadAs(USERS.owner);
    expect(res.status).toBe(201);
    expect(lf.uploadFileToFolder).toHaveBeenCalledWith(
      TENANT.lf_share_name,
      LF_FOLDERS.drafts,
      'POL-2026-001-v1.3.docx',
      expect.any(Buffer),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(db.logChange).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.stringContaining('POL-2026-001-v1.3.docx'),
      actorEmail: USERS.owner.email,
    }));
    expect(res.body.file.id).toBe('lf-file-1');
  });

  test('admin can upload too', async () => {
    const res = await uploadAs(USERS.admin, { filename: 'policy.pdf' });
    expect(res.status).toBe(201);
    expect(lf.uploadFileToFolder).toHaveBeenCalledWith(
      TENANT.lf_share_name, LF_FOLDERS.drafts, 'POL-2026-001-v1.3.pdf',
      expect.any(Buffer), 'application/pdf',
    );
  });

  test('viewer (non-owner) is rejected', async () => {
    const res = await uploadAs(USERS.viewer);
    expect(res.status).toBe(403);
    expect(lf.uploadFileToFolder).not.toHaveBeenCalled();
  });

  test('unsupported extension → 400', async () => {
    const res = await uploadAs(USERS.owner, { filename: 'malware.exe' });
    expect(res.status).toBe(400);
    expect(lf.uploadFileToFolder).not.toHaveBeenCalled();
  });

  test('missing storage self-heals by creating folders first', async () => {
    const res = await uploadAs(USERS.owner, { policy: { lf_folder_ids: null } });
    expect(res.status).toBe(201);
    expect(lf.createPolicyFolders).toHaveBeenCalledWith(TENANT.lf_share_name, 'POL-2026-001');
    expect(db.updatePolicy).toHaveBeenCalledWith(
      TENANT.id, 'POL-2026-001', { lf_folder_ids: LF_FOLDERS },
    );
  });

  test('self-heal failure → 503, register untouched', async () => {
    lf.createPolicyFolders.mockRejectedValue(new Error('appliance down'));
    const res = await uploadAs(USERS.owner, { policy: { lf_folder_ids: null } });
    expect(res.status).toBe(503);
    expect(lf.uploadFileToFolder).not.toHaveBeenCalled();
  });
});

// ─── Lifecycle: submit / approve / return ─────────────────────────────────────

describe('POST /api/policies/:id/submit', () => {
  test('non-owner is rejected', async () => {
    const res = await asUser(
      request(app).post('/api/policies/POL-2026-001/submit').send({ expiresAt: '2026-07-01' }),
      USERS.viewer
    );
    expect(res.status).toBe(403);
  });

  test('missing expiresAt → 400', async () => {
    const res = await asUser(request(app).post('/api/policies/POL-2026-001/submit').send({}), USERS.owner);
    expect(res.status).toBe(400);
  });

  test('owner submits → UNDER_REVIEW and authorisers are notified', async () => {
    db.getPolicyById.mockResolvedValue({ ...BASE_POLICY, status: 'DRAFT', lf_folder_ids: { ...LF_FOLDERS } });
    lf.listFiles.mockResolvedValue([
      { id: 'old', name: 'POL-2026-001-v0.1.docx', created_at: '2026-06-01T00:00:00Z', content_type: 'application/x-docx' },
      { id: 'new', name: 'POL-2026-001-v0.2.docx', created_at: '2026-06-10T00:00:00Z', content_type: 'application/x-docx' },
    ]);
    const res = await asUser(
      request(app).post('/api/policies/POL-2026-001/submit').send({ expiresAt: '2026-07-01' }),
      USERS.owner
    );
    expect(res.status).toBe(200);
    expect(db.updatePolicy).toHaveBeenCalledWith(TENANT.id, 'POL-2026-001', {
      status: 'UNDER_REVIEW', review_expires_at: '2026-07-01',
    });
    // newest draft attached to the request
    expect(lf.downloadFile).toHaveBeenCalledWith(TENANT.lf_share_name, LF_FOLDERS.drafts, 'new');
    expect(msg.sendAuthorisationRequest).toHaveBeenCalledWith(expect.objectContaining({
      authoriserEmail: USERS.authoriser.email,
      policyId:        'POL-2026-001',
      expiresAt:       '2026-07-01',
      documentName:    'POL-2026-001-v0.2.docx',
    }));
    expect(res.body.notifications).toEqual({ notified: [USERS.authoriser.email], failed: [] });
  });

  test('submission without authorisers → 400', async () => {
    db.getPolicyById.mockResolvedValue({ ...BASE_POLICY, status: 'DRAFT' });
    db.getRouteState.mockResolvedValue(routeState([]));
    const res = await asUser(
      request(app).post('/api/policies/POL-2026-001/submit').send({ expiresAt: '2026-07-01' }),
      USERS.owner
    );
    expect(res.status).toBe(400);
    expect(db.updatePolicy).not.toHaveBeenCalled();
  });

  test('notification failure does not roll back the submission', async () => {
    db.getPolicyById.mockResolvedValue({ ...BASE_POLICY, status: 'DRAFT' });
    msg.sendAuthorisationRequest.mockRejectedValue(new Error('appliance down'));
    const res = await asUser(
      request(app).post('/api/policies/POL-2026-001/submit').send({ expiresAt: '2026-07-01' }),
      USERS.owner
    );
    expect(res.status).toBe(200);
    expect(db.updatePolicy).toHaveBeenCalledWith(TENANT.id, 'POL-2026-001', {
      status: 'UNDER_REVIEW', review_expires_at: '2026-07-01',
    });
    expect(res.body.notifications).toEqual({ notified: [], failed: [USERS.authoriser.email] });
  });
});

describe('POST /api/policies/:id/approve', () => {
  test('only assigned authorisers may approve', async () => {
    db.getAuthorisers.mockResolvedValue([{ email: 'someone-else@acme.example' }]);
    const res = await asUser(request(app).post('/api/policies/POL-2026-001/approve'), USERS.authoriser);
    expect(res.status).toBe(403);
  });

  test('approving a policy not under review → 400', async () => {
    db.getPolicyById.mockResolvedValue({ ...BASE_POLICY, status: 'ACTIVE' });
    const res = await asUser(request(app).post('/api/policies/POL-2026-001/approve'), USERS.authoriser);
    expect(res.status).toBe(400);
  });

  test('a later-stage member cannot approve while an earlier stage is open', async () => {
    // ciso sits in stage 2; stage 1 (someone else) is still open.
    db.getAuthorisers.mockResolvedValue([
      { email: 'lead@acme.example', stage_position: 1 },
      { email: USERS.authoriser.email, stage_position: 2 },
    ]);
    db.getRouteState.mockResolvedValue(routeState([
      { threshold: null, members: ['lead@acme.example'] },
      { threshold: null, members: [USERS.authoriser.email] },
    ]));
    const res = await asUser(request(app).post('/api/policies/POL-2026-001/approve'), USERS.authoriser);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not yet your turn/);
    expect(db.recordApproval).not.toHaveBeenCalled();
  });

  test('partial consensus within a quorum stage records and waits', async () => {
    // Quorum 2 of 3 — ciso's approval is only the first.
    const members = [USERS.authoriser.email, 'a@acme.example', 'b@acme.example'];
    db.getRouteState
      .mockResolvedValueOnce(routeState([{ threshold: 2, members }]))
      .mockResolvedValueOnce(routeState([{ threshold: 2, members, approvedBy: [USERS.authoriser.email] }]));
    const res = await asUser(request(app).post('/api/policies/POL-2026-001/approve'), USERS.authoriser);
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/Waiting for remaining approvers/);
    expect(db.recordApproval).toHaveBeenCalledWith(TENANT.id, expect.objectContaining({
      policyId: 'POL-2026-001', email: USERS.authoriser.email, version: 'v1.3',
    }));
    expect(db.updatePolicy).not.toHaveBeenCalled();
    expect(msg.sendAuthorisationConfirmation).not.toHaveBeenCalled();
  });

  test('clearing a stage requests authorisation from the next stage', async () => {
    const stage2 = 'legal@acme.example';
    db.getAuthorisers.mockResolvedValue([
      { email: USERS.authoriser.email, stage_position: 1 },
      { email: stage2, stage_position: 2 },
    ]);
    db.getPolicyById.mockResolvedValue({
      ...BASE_POLICY, review_expires_at: '2026-07-01', lf_folder_ids: { ...LF_FOLDERS },
    });
    db.getRouteState
      // before: stage 1 open, ciso a member
      .mockResolvedValueOnce(routeState([
        { threshold: null, members: [USERS.authoriser.email] },
        { threshold: null, members: [stage2] },
      ]))
      // after: stage 1 satisfied, stage 2 now active
      .mockResolvedValueOnce(routeState([
        { threshold: null, members: [USERS.authoriser.email], approvedBy: [USERS.authoriser.email] },
        { threshold: null, members: [stage2] },
      ]));
    const res = await asUser(request(app).post('/api/policies/POL-2026-001/approve'), USERS.authoriser);
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/Requesting approval from stage 2/);
    expect(db.updatePolicy).not.toHaveBeenCalled();
    expect(msg.sendAuthorisationRequest).toHaveBeenCalledWith(expect.objectContaining({
      authoriserEmail: stage2, expiresAt: '2026-07-01',
    }));
    expect(msg.sendAuthorisationConfirmation).not.toHaveBeenCalled();
  });

  test('final stage approval promotes v1.3 → v2.0 and advances status', async () => {
    db.getRouteState
      .mockResolvedValueOnce(routeState([{ threshold: null, members: [USERS.authoriser.email] }]))
      .mockResolvedValueOnce(routeState([
        { threshold: null, members: [USERS.authoriser.email], approvedBy: [USERS.authoriser.email] },
      ]));
    const res = await asUser(request(app).post('/api/policies/POL-2026-001/approve'), USERS.authoriser);
    expect(res.status).toBe(200);
    expect(db.updatePolicy).toHaveBeenCalledWith(TENANT.id, 'POL-2026-001', expect.objectContaining({
      status: 'PENDING_ACCEPTANCE',
      current_version: 'v2.0',
    }));
    expect(msg.sendAuthorisationConfirmation).toHaveBeenCalledWith(expect.objectContaining({
      ownerEmail: USERS.owner.email,
      policyId:   'POL-2026-001',
      version:    'v2.0',
    }));
  });
});

describe('POST /api/policies/:id/return', () => {
  test('feedback is required', async () => {
    const res = await asUser(request(app).post('/api/policies/POL-2026-001/return').send({}), USERS.authoriser);
    expect(res.status).toBe(400);
  });

  test('return bumps the minor version and goes back to DRAFT', async () => {
    const res = await asUser(
      request(app).post('/api/policies/POL-2026-001/return').send({ feedback: 'Needs a data-retention section' }),
      USERS.authoriser
    );
    expect(res.status).toBe(200);
    expect(db.updatePolicy).toHaveBeenCalledWith(TENANT.id, 'POL-2026-001', {
      status: 'DRAFT', current_version: 'v1.4',
    });
    expect(db.recordReturn).toHaveBeenCalledWith(TENANT.id, {
      policyId: 'POL-2026-001',
      email:    USERS.authoriser.email,
      version:  'v1.3',
      feedback: 'Needs a data-retention section',
    });
    expect(msg.sendReturnNotice).toHaveBeenCalledWith(expect.objectContaining({
      ownerEmail:      USERS.owner.email,
      authoriserEmail: USERS.authoriser.email,
      feedback:        'Needs a data-retention section',
    }));
  });
});

// ─── Lifecycle: owner-acceptance gate ─────────────────────────────────────────

describe('owner-acceptance gate', () => {
  test('with the gate on, final authoriser approval holds for owner acceptance', async () => {
    TENANT.owner_acceptance_required = true;
    db.getRouteState
      .mockResolvedValueOnce(routeState([{ threshold: null, members: [USERS.authoriser.email] }]))
      .mockResolvedValueOnce(routeState([
        { threshold: null, members: [USERS.authoriser.email], approvedBy: [USERS.authoriser.email] },
      ]));
    const res = await asUser(request(app).post('/api/policies/POL-2026-001/approve'), USERS.authoriser);
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/owner acceptance/i);
    expect(db.updatePolicy).toHaveBeenCalledWith(TENANT.id, 'POL-2026-001', { status: 'OWNER_ACCEPTANCE' });
    expect(db.updatePolicy).not.toHaveBeenCalledWith(
      TENANT.id, 'POL-2026-001', expect.objectContaining({ status: 'PENDING_ACCEPTANCE' }),
    );
    expect(msg.sendOwnerAcceptanceRequest).toHaveBeenCalledWith(expect.objectContaining({
      ownerEmail: USERS.owner.email, policyId: 'POL-2026-001', version: 'v1.3',
    }));
  });

  test('with the gate off, approval advances straight to distribution', async () => {
    // Default TENANT.owner_acceptance_required = false (reset in beforeEach).
    db.getRouteState
      .mockResolvedValueOnce(routeState([{ threshold: null, members: [USERS.authoriser.email] }]))
      .mockResolvedValueOnce(routeState([
        { threshold: null, members: [USERS.authoriser.email], approvedBy: [USERS.authoriser.email] },
      ]));
    const res = await asUser(request(app).post('/api/policies/POL-2026-001/approve'), USERS.authoriser);
    expect(res.status).toBe(200);
    expect(db.updatePolicy).toHaveBeenCalledWith(TENANT.id, 'POL-2026-001', expect.objectContaining({
      status: 'PENDING_ACCEPTANCE', current_version: 'v2.0',
    }));
    expect(msg.sendOwnerAcceptanceRequest).not.toHaveBeenCalled();
  });

  test('owner accept promotes v1.3 → v2.0 and advances to distribution', async () => {
    db.getPolicyById.mockResolvedValue({ ...BASE_POLICY, status: 'OWNER_ACCEPTANCE' });
    const res = await asUser(request(app).post('/api/policies/POL-2026-001/accept'), USERS.owner);
    expect(res.status).toBe(200);
    expect(db.recordOwnerDecision).toHaveBeenCalledWith(TENANT.id, expect.objectContaining({
      policyId: 'POL-2026-001', email: USERS.owner.email, version: 'v1.3', decision: 'approved',
    }));
    expect(db.updatePolicy).toHaveBeenCalledWith(TENANT.id, 'POL-2026-001', expect.objectContaining({
      status: 'PENDING_ACCEPTANCE', current_version: 'v2.0',
    }));
  });

  test('owner accept on an exec-gated policy advances to the exec gate', async () => {
    db.getPolicyById.mockResolvedValue({
      ...BASE_POLICY, status: 'OWNER_ACCEPTANCE', category: 'Security', exec_email: USERS.exec.email,
    });
    const res = await asUser(request(app).post('/api/policies/POL-2026-001/accept'), USERS.owner);
    expect(res.status).toBe(200);
    expect(db.updatePolicy).toHaveBeenCalledWith(TENANT.id, 'POL-2026-001', { status: 'EXEC_REVIEW' });
    expect(msg.sendExecAuthorisationRequest).toHaveBeenCalledWith(expect.objectContaining({
      execEmail: USERS.exec.email,
    }));
    // Not promoted yet — still gated by the exec.
    expect(db.updatePolicy).not.toHaveBeenCalledWith(
      TENANT.id, 'POL-2026-001', expect.objectContaining({ status: 'PENDING_ACCEPTANCE' }),
    );
  });

  test('only the owner may accept', async () => {
    db.getPolicyById.mockResolvedValue({ ...BASE_POLICY, status: 'OWNER_ACCEPTANCE' });
    const res = await asUser(request(app).post('/api/policies/POL-2026-001/accept'), USERS.authoriser);
    expect(res.status).toBe(403);
    expect(db.recordOwnerDecision).not.toHaveBeenCalled();
  });

  test('accept rejects a policy not awaiting owner acceptance', async () => {
    db.getPolicyById.mockResolvedValue({ ...BASE_POLICY, status: 'UNDER_REVIEW' });
    const res = await asUser(request(app).post('/api/policies/POL-2026-001/accept'), USERS.owner);
    expect(res.status).toBe(400);
    expect(db.recordOwnerDecision).not.toHaveBeenCalled();
  });

  test('accept-return bumps the minor version and goes back to DRAFT', async () => {
    db.getPolicyById.mockResolvedValue({ ...BASE_POLICY, status: 'OWNER_ACCEPTANCE' });
    const res = await asUser(
      request(app).post('/api/policies/POL-2026-001/accept-return').send({ feedback: 'Reword clause 4 before this goes out' }),
      USERS.owner,
    );
    expect(res.status).toBe(200);
    expect(db.recordOwnerDecision).toHaveBeenCalledWith(TENANT.id, expect.objectContaining({
      decision: 'returned', feedback: 'Reword clause 4 before this goes out',
    }));
    expect(db.updatePolicy).toHaveBeenCalledWith(TENANT.id, 'POL-2026-001', {
      status: 'DRAFT', current_version: 'v1.4',
    });
  });

  test('accept-return requires feedback', async () => {
    db.getPolicyById.mockResolvedValue({ ...BASE_POLICY, status: 'OWNER_ACCEPTANCE' });
    const res = await asUser(request(app).post('/api/policies/POL-2026-001/accept-return').send({}), USERS.owner);
    expect(res.status).toBe(400);
  });
});

// ─── Lifecycle: executive authorisation gate ──────────────────────────────────

describe('executive authorisation gate', () => {
  // A 'Security' policy is in the tenant's exec_required_categories, with a
  // named exec. BASE_POLICY ('IT') is unaffected.
  const EXEC_POLICY = {
    ...BASE_POLICY, category: 'Security', exec_email: USERS.exec.email,
  };

  test('submit is blocked when the category requires an exec but none is assigned', async () => {
    db.getPolicyById.mockResolvedValue({ ...EXEC_POLICY, exec_email: null, status: 'DRAFT' });
    const res = await asUser(
      request(app).post('/api/policies/POL-2026-001/submit').send({ expiresAt: '2026-07-01' }),
      USERS.owner,
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/require an executive authoriser/i);
    expect(db.updatePolicy).not.toHaveBeenCalled();
  });

  test('final authoriser approval holds at the exec gate and notifies the exec', async () => {
    db.getPolicyById.mockResolvedValue({ ...EXEC_POLICY });
    db.getRouteState
      .mockResolvedValueOnce(routeState([{ threshold: null, members: [USERS.authoriser.email] }]))
      .mockResolvedValueOnce(routeState([
        { threshold: null, members: [USERS.authoriser.email], approvedBy: [USERS.authoriser.email] },
      ]));
    const res = await asUser(request(app).post('/api/policies/POL-2026-001/approve'), USERS.authoriser);
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/executive sign-off/i);
    // Held at the gate: status flips to EXEC_REVIEW, version NOT promoted yet.
    expect(db.updatePolicy).toHaveBeenCalledWith(TENANT.id, 'POL-2026-001', { status: 'EXEC_REVIEW' });
    expect(db.updatePolicy).not.toHaveBeenCalledWith(
      TENANT.id, 'POL-2026-001', expect.objectContaining({ status: 'PENDING_ACCEPTANCE' }),
    );
    expect(msg.sendExecAuthorisationRequest).toHaveBeenCalledWith(expect.objectContaining({
      execEmail: USERS.exec.email, policyId: 'POL-2026-001', version: 'v1.3',
    }));
    expect(msg.sendAuthorisationConfirmation).not.toHaveBeenCalled();
  });

  test('exec-authorise promotes v1.3 → v2.0 and advances to distribution', async () => {
    db.getPolicyById.mockResolvedValue({ ...EXEC_POLICY, status: 'EXEC_REVIEW' });
    const res = await asUser(request(app).post('/api/policies/POL-2026-001/exec-authorise'), USERS.exec);
    expect(res.status).toBe(200);
    expect(db.recordExecDecision).toHaveBeenCalledWith(TENANT.id, expect.objectContaining({
      policyId: 'POL-2026-001', email: USERS.exec.email, version: 'v1.3', decision: 'approved',
    }));
    expect(db.updatePolicy).toHaveBeenCalledWith(TENANT.id, 'POL-2026-001', expect.objectContaining({
      status: 'PENDING_ACCEPTANCE', current_version: 'v2.0',
    }));
    expect(msg.sendAuthorisationConfirmation).toHaveBeenCalledWith(expect.objectContaining({
      ownerEmail: USERS.owner.email, version: 'v2.0',
    }));
  });

  test('only the assigned exec may exec-authorise', async () => {
    db.getPolicyById.mockResolvedValue({ ...EXEC_POLICY, status: 'EXEC_REVIEW' });
    const res = await asUser(request(app).post('/api/policies/POL-2026-001/exec-authorise'), USERS.authoriser);
    expect(res.status).toBe(403);
    expect(db.recordExecDecision).not.toHaveBeenCalled();
  });

  test('exec-authorise rejects a policy not at the exec gate', async () => {
    db.getPolicyById.mockResolvedValue({ ...EXEC_POLICY, status: 'UNDER_REVIEW' });
    const res = await asUser(request(app).post('/api/policies/POL-2026-001/exec-authorise'), USERS.exec);
    expect(res.status).toBe(400);
    expect(db.recordExecDecision).not.toHaveBeenCalled();
  });

  test('exec-return bumps the minor version, goes back to DRAFT, and notifies the owner', async () => {
    db.getPolicyById.mockResolvedValue({ ...EXEC_POLICY, status: 'EXEC_REVIEW' });
    const res = await asUser(
      request(app).post('/api/policies/POL-2026-001/exec-return').send({ feedback: 'Board wants a data-residency clause' }),
      USERS.exec,
    );
    expect(res.status).toBe(200);
    expect(db.recordExecDecision).toHaveBeenCalledWith(TENANT.id, expect.objectContaining({
      decision: 'returned', feedback: 'Board wants a data-residency clause',
    }));
    expect(db.updatePolicy).toHaveBeenCalledWith(TENANT.id, 'POL-2026-001', {
      status: 'DRAFT', current_version: 'v1.4',
    });
    expect(msg.sendReturnNotice).toHaveBeenCalledWith(expect.objectContaining({
      ownerEmail: USERS.owner.email, authoriserEmail: USERS.exec.email,
    }));
  });

  test('exec-return requires feedback', async () => {
    db.getPolicyById.mockResolvedValue({ ...EXEC_POLICY, status: 'EXEC_REVIEW' });
    const res = await asUser(request(app).post('/api/policies/POL-2026-001/exec-return').send({}), USERS.exec);
    expect(res.status).toBe(400);
  });

  test('a non-exec IT policy still authorises straight through to distribution', async () => {
    // BASE_POLICY category 'IT' is not in exec_required_categories.
    db.getRouteState
      .mockResolvedValueOnce(routeState([{ threshold: null, members: [USERS.authoriser.email] }]))
      .mockResolvedValueOnce(routeState([
        { threshold: null, members: [USERS.authoriser.email], approvedBy: [USERS.authoriser.email] },
      ]));
    const res = await asUser(request(app).post('/api/policies/POL-2026-001/approve'), USERS.authoriser);
    expect(res.status).toBe(200);
    expect(db.updatePolicy).toHaveBeenCalledWith(TENANT.id, 'POL-2026-001', expect.objectContaining({
      status: 'PENDING_ACCEPTANCE', current_version: 'v2.0',
    }));
    expect(msg.sendExecAuthorisationRequest).not.toHaveBeenCalled();
  });
});

// ─── Lifecycle: distribute / retire / review ──────────────────────────────────

describe('POST /api/policies/:id/distribute', () => {
  const recipients = [{ email: 'a@acme.example' }, { email: 'b@acme.example', manager_email: 'm@acme.example' }];

  const DISTRIBUTABLE = {
    ...BASE_POLICY,
    status: 'PENDING_ACCEPTANCE',
    current_version: 'v2.0',
    lf_folder_ids: { ...LF_FOLDERS },
  };

  function mockStoredDraft({ currentFiles = [] } = {}) {
    // Folder-aware: /drafts/ holds the working versions; /current/ holds
    // whatever a test says (the archive sweep lists it after publishing).
    lf.listFiles.mockImplementation(async (_share, folderId) => {
      if (folderId === LF_FOLDERS.drafts) {
        return [
          { id: 'lf-old', name: 'POL-2026-001-v1.2.docx', created_at: '2026-06-01T10:00:00Z', deleted: false },
          { id: 'lf-new', name: 'POL-2026-001-v1.3.docx', created_at: '2026-06-10T10:00:00Z', deleted: false },
        ];
      }
      if (folderId === LF_FOLDERS.current) return currentFiles;
      return [];
    });
    lf.downloadFile.mockResolvedValue({
      buffer: Buffer.from('authorised-doc'),
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  }

  test('requires PENDING_ACCEPTANCE status', async () => {
    db.getPolicyById.mockResolvedValue({ ...BASE_POLICY, status: 'DRAFT' });
    const res = await asUser(
      request(app).post('/api/policies/POL-2026-001/distribute').send({ recipients, expiresAt: '2026-07-01' }),
      USERS.owner
    );
    expect(res.status).toBe(400);
  });

  test('rejects an empty recipients array', async () => {
    db.getPolicyById.mockResolvedValue({ ...DISTRIBUTABLE });
    const res = await asUser(
      request(app).post('/api/policies/POL-2026-001/distribute').send({ recipients: [], expiresAt: '2026-07-01' }),
      USERS.owner
    );
    expect(res.status).toBe(400);
  });

  test('rejects an unknown distribution group', async () => {
    db.getPolicyById.mockResolvedValue({ ...DISTRIBUTABLE });
    db.getGroupWithMembers.mockResolvedValue(null);
    const res = await asUser(
      request(app).post('/api/policies/POL-2026-001/distribute')
        .send({ groupIds: [99], expiresAt: '2026-07-01' }),
      USERS.owner
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unknown distribution group/i);
    expect(msg.sendAcceptanceRequest).not.toHaveBeenCalled();
  });

  test('expands groups server-side and dedupes against explicit recipients', async () => {
    db.getPolicyById.mockResolvedValue({ ...DISTRIBUTABLE });
    db.getGroupWithMembers.mockResolvedValue({
      id: 7, name: 'All staff',
      members: [
        { email: 'a@acme.example', manager_email: 'boss@acme.example' }, // duplicate of explicit
        { email: 'c@acme.example', manager_email: 'boss@acme.example' },
      ],
    });
    db.createAcknowledgements.mockResolvedValue();
    db.getAcknowledgements.mockResolvedValue([
      { recipient_email: 'a@acme.example', acknowledged_at: null },
      { recipient_email: 'c@acme.example', acknowledged_at: null },
    ]);
    db.recordNotification.mockResolvedValue({});
    mockStoredDraft();
    msg.sendAcceptanceRequest.mockResolvedValue({ id: 'lf-msg-x' });

    const res = await asUser(
      request(app).post('/api/policies/POL-2026-001/distribute')
        .send({ recipients: [{ email: 'a@acme.example' }], groupIds: [7], expiresAt: '2026-07-01' }),
      USERS.owner
    );

    expect(res.status).toBe(200);
    expect(db.getGroupWithMembers).toHaveBeenCalledWith(TENANT.id, 7);
    // a@ appears once (explicit entry wins, so no manager escalation),
    // c@ comes from the group with its manager attached.
    expect(msg.sendAcceptanceRequest).toHaveBeenCalledTimes(2);
    expect(db.createAcknowledgements).toHaveBeenCalledWith(
      TENANT.id, 'POL-2026-001', 'v2.0',
      [
        expect.objectContaining({ email: 'a@acme.example', manager_email: null }),
        expect.objectContaining({ email: 'c@acme.example', manager_email: 'boss@acme.example' }),
      ]
    );
    // Changelog names the group used.
    expect(db.logChange).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.stringContaining('All staff'),
    }));
  });

  test('role audiences expand from the staff directory, minus exclusions; explicit recipients are never excluded', async () => {
    db.getPolicyById.mockResolvedValue({ ...DISTRIBUTABLE });
    db.getGroupWithMembers.mockResolvedValue({
      id: 9, name: 'Everyone with a seat',
      roles: ['staff', 'authoriser'],
      excluded_emails: ['ciso@acme.example', 'left@acme.example'],
      members: [
        { email: 'extern@partner.example', manager_email: null },
        { email: 'left@acme.example', manager_email: null }, // excluded, even as an explicit member
      ],
    });
    db.listAppUsersByTenant.mockResolvedValue([
      { email: 'staff@acme.example', role: 'staff' },
      { email: 'ciso@acme.example',  role: 'authoriser' }, // excluded by the group
      { email: 'legal@acme.example', role: 'authoriser' },
      { email: 'admin@acme.example', role: 'admin' },      // role not targeted
    ]);
    db.createAcknowledgements.mockResolvedValue();
    db.getAcknowledgements.mockResolvedValue([
      { recipient_email: 'ciso@acme.example',   acknowledged_at: null },
      { recipient_email: 'extern@partner.example', acknowledged_at: null },
      { recipient_email: 'staff@acme.example',  acknowledged_at: null },
      { recipient_email: 'legal@acme.example',  acknowledged_at: null },
    ]);
    db.recordNotification.mockResolvedValue({});
    mockStoredDraft();
    msg.sendAcceptanceRequest.mockResolvedValue({ id: 'lf-msg-y' });

    const res = await asUser(
      request(app).post('/api/policies/POL-2026-001/distribute')
        // ciso@ pasted explicitly — a group's exclusion must not strip them.
        .send({ recipients: [{ email: 'ciso@acme.example' }], groupIds: [9], expiresAt: '2026-07-01' }),
      USERS.owner
    );

    expect(res.status).toBe(200);
    expect(db.listAppUsersByTenant).toHaveBeenCalledWith(TENANT.id);
    expect(db.createAcknowledgements).toHaveBeenCalledWith(
      TENANT.id, 'POL-2026-001', 'v2.0',
      [
        expect.objectContaining({ email: 'ciso@acme.example' }),      // explicit — kept
        expect.objectContaining({ email: 'extern@partner.example' }), // group member
        expect.objectContaining({ email: 'staff@acme.example' }),     // via role: staff
        expect.objectContaining({ email: 'legal@acme.example' }),     // via role: authoriser
      ]
    );
  });

  test('a group id alone with no members and no explicit recipients → 400', async () => {
    db.getPolicyById.mockResolvedValue({ ...DISTRIBUTABLE });
    db.getGroupWithMembers.mockResolvedValue({ id: 8, name: 'Empty', members: [] });
    const res = await asUser(
      request(app).post('/api/policies/POL-2026-001/distribute')
        .send({ groupIds: [8], expiresAt: '2026-07-01' }),
      USERS.owner
    );
    expect(res.status).toBe(400);
    expect(msg.sendAcceptanceRequest).not.toHaveBeenCalled();
  });

  test('rejects distribution when no document is stored', async () => {
    db.getPolicyById.mockResolvedValue({ ...DISTRIBUTABLE });
    lf.listFiles.mockResolvedValue([]);
    const res = await asUser(
      request(app).post('/api/policies/POL-2026-001/distribute').send({ recipients, expiresAt: '2026-07-01' }),
      USERS.owner
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/document/i);
    expect(msg.sendAcceptanceRequest).not.toHaveBeenCalled();
  });

  test('returns 503 and sends nothing when storage is unreachable', async () => {
    db.getPolicyById.mockResolvedValue({ ...DISTRIBUTABLE });
    lf.listFiles.mockRejectedValue(new Error('appliance down'));
    const res = await asUser(
      request(app).post('/api/policies/POL-2026-001/distribute').send({ recipients, expiresAt: '2026-07-01' }),
      USERS.owner
    );
    expect(res.status).toBe(503);
    expect(msg.sendAcceptanceRequest).not.toHaveBeenCalled();
    expect(db.createAcknowledgements).not.toHaveBeenCalled();
  });

  test('publishes to /current/, sends acceptance messages, records message ids', async () => {
    db.getPolicyById.mockResolvedValue({ ...DISTRIBUTABLE });
    db.createAcknowledgements.mockResolvedValue();
    db.getAcknowledgements.mockResolvedValue([
      { recipient_email: 'a@acme.example', acknowledged_at: null },
      { recipient_email: 'b@acme.example', acknowledged_at: null },
    ]);
    db.recordNotification.mockResolvedValue({});
    mockStoredDraft();
    msg.sendAcceptanceRequest
      .mockResolvedValueOnce({ id: 'lf-msg-a' })
      .mockResolvedValueOnce({ id: 'lf-msg-b' });

    const res = await asUser(
      request(app).post('/api/policies/POL-2026-001/distribute').send({ recipients, expiresAt: '2026-07-01' }),
      USERS.owner
    );

    expect(res.status).toBe(200);
    expect(res.body.notifications).toEqual({
      notified: ['a@acme.example', 'b@acme.example'],
      failed: [],
    });

    // Published the newest draft into /current/ under the authorised version name.
    expect(lf.downloadFile).toHaveBeenCalledWith(TENANT.lf_share_name, LF_FOLDERS.drafts, 'lf-new');
    expect(lf.uploadFileToFolder).toHaveBeenCalledWith(
      TENANT.lf_share_name, LF_FOLDERS.current, 'POL-2026-001-v2.0.docx',
      expect.any(Buffer), expect.any(String),
    );

    expect(msg.sendAcceptanceRequest).toHaveBeenCalledTimes(2);
    expect(msg.sendAcceptanceRequest).toHaveBeenCalledWith(expect.objectContaining({
      recipientEmail: 'a@acme.example',
      policyId:       'POL-2026-001',
      version:        'v2.0',
      expiresAt:      '2026-07-01',
      documentName:   'POL-2026-001-v2.0.docx',
    }));
    // Every message carries a personal read-and-accept link.
    expect(msg.attestationUrl).toHaveBeenCalledTimes(2);

    expect(db.updatePolicy).toHaveBeenCalledWith(TENANT.id, 'POL-2026-001', {
      acknowledgement_total: 2, acknowledgement_count: 0,
    });
    // Receipts are hash-pinned: each row records the exact published file.
    expect(db.createAcknowledgements).toHaveBeenCalledWith(
      TENANT.id, 'POL-2026-001', 'v2.0',
      [
        expect.objectContaining({
          email: 'a@acme.example', lf_message_id: 'lf-msg-a',
          lf_file_id: 'lf-file-1', document_checksum: 'sha256-test',
          accept_token: expect.any(String),
        }),
        expect.objectContaining({
          email: 'b@acme.example', manager_email: 'm@acme.example', lf_message_id: 'lf-msg-b',
          lf_file_id: 'lf-file-1', document_checksum: 'sha256-test',
        }),
      ]
    );
    expect(db.recordNotification).toHaveBeenCalledTimes(2);
    expect(db.recordNotification).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'acceptance', recipientEmail: 'a@acme.example', lfMessageId: 'lf-msg-a', version: 'v2.0',
    }));
  });

  test('reports per-recipient send failures without failing the distribution', async () => {
    db.getPolicyById.mockResolvedValue({ ...DISTRIBUTABLE });
    db.createAcknowledgements.mockResolvedValue();
    db.getAcknowledgements.mockResolvedValue([
      { recipient_email: 'a@acme.example', acknowledged_at: null },
      { recipient_email: 'b@acme.example', acknowledged_at: null },
    ]);
    db.recordNotification.mockResolvedValue({});
    mockStoredDraft();
    msg.sendAcceptanceRequest
      .mockResolvedValueOnce({ id: 'lf-msg-a' })
      .mockRejectedValueOnce(new Error('smtp down'));

    const res = await asUser(
      request(app).post('/api/policies/POL-2026-001/distribute').send({ recipients, expiresAt: '2026-07-01' }),
      USERS.owner
    );

    expect(res.status).toBe(200);
    expect(res.body.notifications).toEqual({
      notified: ['a@acme.example'],
      failed:   ['b@acme.example'],
    });
    // The failed send still gets an ack row (so it shows as outstanding) —
    // just with no message id to poll.
    expect(db.createAcknowledgements).toHaveBeenCalledWith(
      TENANT.id, 'POL-2026-001', 'v2.0',
      [
        expect.objectContaining({ email: 'a@acme.example', lf_message_id: 'lf-msg-a' }),
        expect.objectContaining({ email: 'b@acme.example', lf_message_id: null }),
      ]
    );
    expect(db.recordNotification).toHaveBeenCalledTimes(1);
  });

  test('re-distribution keeps earlier acknowledgements counted', async () => {
    db.getPolicyById.mockResolvedValue({ ...DISTRIBUTABLE });
    db.createAcknowledgements.mockResolvedValue();
    // After the upsert this version has three rows, one already acknowledged.
    db.getAcknowledgements.mockResolvedValue([
      { recipient_email: 'a@acme.example', acknowledged_at: '2026-06-11T10:00:00Z' },
      { recipient_email: 'b@acme.example', acknowledged_at: null },
      { recipient_email: 'c@acme.example', acknowledged_at: null },
    ]);
    db.recordNotification.mockResolvedValue({});
    mockStoredDraft();
    msg.sendAcceptanceRequest.mockResolvedValue({ id: 'lf-msg-c' });

    const res = await asUser(
      request(app).post('/api/policies/POL-2026-001/distribute')
        .send({ recipients: [{ email: 'c@acme.example' }], expiresAt: '2026-07-01' }),
      USERS.owner
    );

    expect(res.status).toBe(200);
    expect(db.updatePolicy).toHaveBeenCalledWith(TENANT.id, 'POL-2026-001', {
      acknowledgement_total: 3, acknowledgement_count: 1,
    });
  });

  test('sweeps superseded files from /current/ into /archive/ on publish', async () => {
    db.getPolicyById.mockResolvedValue({ ...DISTRIBUTABLE });
    db.createAcknowledgements.mockResolvedValue();
    db.getAcknowledgements.mockResolvedValue([
      { recipient_email: 'a@acme.example', acknowledged_at: null },
    ]);
    db.recordNotification.mockResolvedValue({});
    mockStoredDraft({
      currentFiles: [
        // The just-published file (excluded by id/name) plus a superseded one.
        { id: 'lf-file-1', name: 'POL-2026-001-v2.0.docx', created_at: '2026-06-11T10:00:00Z', deleted: false },
        { id: 'lf-prev', name: 'POL-2026-001-v1.0.pdf', created_at: '2026-01-05T10:00:00Z', deleted: false },
      ],
    });
    msg.sendAcceptanceRequest.mockResolvedValue({ id: 'lf-msg-a' });

    const res = await asUser(
      request(app).post('/api/policies/POL-2026-001/distribute')
        .send({ recipients: [{ email: 'a@acme.example' }], expiresAt: '2026-07-01' }),
      USERS.owner
    );

    expect(res.status).toBe(200);
    expect(lf.downloadFile).toHaveBeenCalledWith(TENANT.lf_share_name, LF_FOLDERS.current, 'lf-prev');
    expect(lf.uploadFileToFolder).toHaveBeenCalledWith(
      TENANT.lf_share_name, LF_FOLDERS.archive, 'POL-2026-001-v1.0.pdf',
      expect.any(Buffer), expect.any(String),
    );
    expect(lf.deleteFile).toHaveBeenCalledWith(TENANT.lf_share_name, LF_FOLDERS.current, 'lf-prev');
    expect(db.logChange).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.stringContaining('Archived superseded'),
    }));
  });

  test('a failed archive delete leaves the original without failing the distribution', async () => {
    db.getPolicyById.mockResolvedValue({ ...DISTRIBUTABLE });
    db.createAcknowledgements.mockResolvedValue();
    db.getAcknowledgements.mockResolvedValue([
      { recipient_email: 'a@acme.example', acknowledged_at: null },
    ]);
    db.recordNotification.mockResolvedValue({});
    mockStoredDraft({
      currentFiles: [
        { id: 'lf-prev', name: 'POL-2026-001-v1.0.pdf', created_at: '2026-01-05T10:00:00Z', deleted: false },
      ],
    });
    lf.deleteFile.mockRejectedValue(new Error('endpoint not supported'));
    msg.sendAcceptanceRequest.mockResolvedValue({ id: 'lf-msg-a' });

    const res = await asUser(
      request(app).post('/api/policies/POL-2026-001/distribute')
        .send({ recipients: [{ email: 'a@acme.example' }], expiresAt: '2026-07-01' }),
      USERS.owner
    );

    expect(res.status).toBe(200);
    // The archive copy still landed and was logged.
    expect(lf.uploadFileToFolder).toHaveBeenCalledWith(
      TENANT.lf_share_name, LF_FOLDERS.archive, 'POL-2026-001-v1.0.pdf',
      expect.any(Buffer), expect.any(String),
    );
    expect(db.logChange).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.stringContaining('Archived superseded'),
    }));
  });
});

// ─── Distribution groups ──────────────────────────────────────────────────────

describe('Distribution groups', () => {
  const GOV = { id: 'u-gov', email: 'gov@acme.example', role: 'governance_lead', tenant_id: 1 };
  const GROUP = {
    id: 7, tenant_id: 1, name: 'All staff', created_at: '2026-07-01',
    members: [{ email: 'a@acme.example', manager_email: null }],
  };

  test('any tenant member can list groups', async () => {
    db.listGroups.mockResolvedValue([{ id: 7, name: 'All staff', member_count: 12 }]);
    const res = await asUser(request(app).get('/api/groups'), USERS.viewer);
    expect(res.status).toBe(200);
    expect(res.body.groups).toEqual([{ id: 7, name: 'All staff', member_count: 12 }]);
    expect(db.listGroups).toHaveBeenCalledWith(TENANT.id);
  });

  test('reads a group with members', async () => {
    db.getGroupWithMembers.mockResolvedValue({ ...GROUP });
    const res = await asUser(request(app).get('/api/groups/7'), USERS.owner);
    expect(res.status).toBe(200);
    expect(res.body.group.members).toHaveLength(1);
  });

  test('unknown or non-numeric group id → 404', async () => {
    db.getGroupWithMembers.mockResolvedValue(null);
    expect((await asUser(request(app).get('/api/groups/99'), USERS.owner)).status).toBe(404);
    expect((await asUser(request(app).get('/api/groups/abc'), USERS.owner)).status).toBe(404);
  });

  test('viewer cannot create a group', async () => {
    const res = await asUser(
      request(app).post('/api/groups').send({ name: 'X', members: [] }),
      USERS.viewer
    );
    expect(res.status).toBe(403);
    expect(db.createGroup).not.toHaveBeenCalled();
  });

  test('governance_lead creates a group; emails normalised + deduped', async () => {
    db.getAppUserById.mockResolvedValue(GOV);
    db.createGroup.mockResolvedValue({ ...GROUP });
    const res = await asUser(
      request(app).post('/api/groups').send({
        name: '  All staff  ',
        members: [
          { email: ' A@Acme.example ', manager_email: 'Boss@Acme.example' },
          { email: 'a@acme.example' }, // dupe — dropped
        ],
      }),
      GOV
    );
    expect(res.status).toBe(201);
    expect(db.createGroup).toHaveBeenCalledWith(TENANT.id, 'All staff', [
      { email: 'a@acme.example', manager_email: 'boss@acme.example' },
    ], [], []);
  });

  test('role audiences: roles validated, exclusions normalised + deduped', async () => {
    const badRole = await asUser(
      request(app).post('/api/groups').send({ name: 'X', roles: ['superuser'] }),
      USERS.admin,
    );
    expect(badRole.status).toBe(400);
    expect(badRole.body.error).toMatch(/roles must be from/i);

    const badExcl = await asUser(
      request(app).post('/api/groups').send({ name: 'X', excludedEmails: ['not-an-email'] }),
      USERS.admin,
    );
    expect(badExcl.status).toBe(400);
    expect(db.createGroup).not.toHaveBeenCalled();

    db.createGroup.mockResolvedValue({
      ...GROUP, name: 'Workforce', roles: ['staff'], excluded_emails: ['x@acme.example'],
    });
    const ok = await asUser(
      request(app).post('/api/groups').send({
        name: 'Workforce',
        roles: ['staff', 'staff', 'authoriser'],
        excludedEmails: [' X@Acme.example ', 'x@acme.example'],
      }),
      USERS.admin,
    );
    expect(ok.status).toBe(201);
    expect(db.createGroup).toHaveBeenCalledWith(
      TENANT.id, 'Workforce', [], ['staff', 'authoriser'], ['x@acme.example'],
    );
  });

  test('rejects a bad member email', async () => {
    const res = await asUser(
      request(app).post('/api/groups').send({ name: 'X', members: [{ email: 'not-an-email' }] }),
      USERS.admin
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid member email/i);
  });

  test('duplicate name → 409', async () => {
    const dup = new Error('duplicate key value violates unique constraint');
    dup.code = '23505';
    db.createGroup.mockRejectedValue(dup);
    const res = await asUser(
      request(app).post('/api/groups').send({ name: 'All staff' }),
      USERS.admin
    );
    expect(res.status).toBe(409);
  });

  test('update replaces name and members', async () => {
    db.updateGroup.mockResolvedValue({ ...GROUP, name: 'Engineering' });
    const res = await asUser(
      request(app).put('/api/groups/7').send({
        name: 'Engineering',
        members: [{ email: 'e@acme.example' }],
      }),
      USERS.admin
    );
    expect(res.status).toBe(200);
    expect(db.updateGroup).toHaveBeenCalledWith(TENANT.id, '7', {
      name: 'Engineering',
      members: [{ email: 'e@acme.example', manager_email: null }],
    });
  });

  test('update with an empty body → 400', async () => {
    const res = await asUser(request(app).put('/api/groups/7').send({}), USERS.admin);
    expect(res.status).toBe(400);
  });

  test('update of an unknown group → 404', async () => {
    db.updateGroup.mockResolvedValue(null);
    const res = await asUser(
      request(app).put('/api/groups/99').send({ name: 'X' }),
      USERS.admin
    );
    expect(res.status).toBe(404);
  });

  test('admin deletes a group', async () => {
    db.getGroupWithMembers.mockResolvedValue({ ...GROUP });
    db.deleteGroup.mockResolvedValue(true);
    const res = await asUser(request(app).delete('/api/groups/7'), USERS.admin);
    expect(res.status).toBe(200);
    expect(db.deleteGroup).toHaveBeenCalledWith(TENANT.id, '7');
  });

  test('owner cannot delete a group', async () => {
    const res = await asUser(request(app).delete('/api/groups/7'), USERS.owner);
    expect(res.status).toBe(403);
    expect(db.deleteGroup).not.toHaveBeenCalled();
  });
});

// ─── Public attestation (read-and-accept) ─────────────────────────────────────

describe('public attestation endpoints', () => {
  const TOKEN = 'x'.repeat(32);
  const ACK_ROW = {
    id: 41, tenant_id: 1, policy_id: 'POL-2026-001', version: 'v2.0',
    recipient_email: 'a@acme.example', expires_at: '2026-07-18',
    acknowledged_at: null, attested_at: null, download_count: null,
    document_checksum: 'sha256-test', lf_file_id: 'lf-file-1',
    title: 'Acceptable Use Policy', policy_status: 'PENDING_ACCEPTANCE',
    tenant_name: 'Acme Corporation',
  };

  test('GET with a malformed token → 404 without touching the db', async () => {
    const res = await request(app).get('/api/attest/short');
    expect(res.status).toBe(404);
    expect(db.getAcknowledgementByToken).not.toHaveBeenCalled();
  });

  test('GET with an unknown token → 404', async () => {
    db.getAcknowledgementByToken.mockResolvedValue(null);
    const res = await request(app).get(`/api/attest/${TOKEN}`);
    expect(res.status).toBe(404);
  });

  test('GET returns the policy summary without auth', async () => {
    db.getAcknowledgementByToken.mockResolvedValue({ ...ACK_ROW });
    const res = await request(app).get(`/api/attest/${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      organisation: 'Acme Corporation',
      policy: { id: 'POL-2026-001', title: 'Acceptable Use Policy', version: 'v2.0' },
      recipient: 'a@acme.example',
      document_checksum: 'sha256-test',
      attested_at: null,
    }));
  });

  test('POST records the attestation and counts it as the acknowledgement', async () => {
    db.getAcknowledgementByToken.mockResolvedValue({ ...ACK_ROW });
    db.recordAttestation.mockResolvedValue({ ...ACK_ROW, attested_at: '2026-07-04T12:00:00Z', acknowledged_at: '2026-07-04T12:00:00Z' });
    db.incrementAcknowledgementCount.mockResolvedValue({ acknowledgement_count: 1, acknowledgement_total: 3 });

    const res = await request(app).post(`/api/attest/${TOKEN}`);
    expect(res.status).toBe(200);
    expect(db.recordAttestation).toHaveBeenCalledWith(1, 41, expect.anything());
    expect(db.logChange).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.stringContaining('Attestation recorded'),
      actorEmail: 'a@acme.example',
    }));
    expect(db.incrementAcknowledgementCount).toHaveBeenCalledWith(1, 'POL-2026-001');
    // 1 of 3 — not activated.
    expect(db.updatePolicy).not.toHaveBeenCalled();
  });

  test('POST that lands the last acceptance activates the policy', async () => {
    db.getAcknowledgementByToken.mockResolvedValue({ ...ACK_ROW });
    db.recordAttestation.mockResolvedValue({ ...ACK_ROW, attested_at: '2026-07-04T12:00:00Z' });
    db.incrementAcknowledgementCount.mockResolvedValue({ acknowledgement_count: 3, acknowledgement_total: 3 });
    db.getPolicyById.mockResolvedValue({ ...BASE_POLICY, status: 'PENDING_ACCEPTANCE', current_version: 'v2.0' });

    const res = await request(app).post(`/api/attest/${TOKEN}`);
    expect(res.status).toBe(200);
    expect(db.updatePolicy).toHaveBeenCalledWith(1, 'POL-2026-001', { status: 'ACTIVE' });
  });

  test('POST is idempotent once attested', async () => {
    db.getAcknowledgementByToken.mockResolvedValue({ ...ACK_ROW, attested_at: '2026-07-01T09:00:00Z' });
    const res = await request(app).post(`/api/attest/${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/already recorded/i);
    expect(db.recordAttestation).not.toHaveBeenCalled();
    expect(db.incrementAcknowledgementCount).not.toHaveBeenCalled();
  });

  test('POST after a download receipt does not double-count', async () => {
    db.getAcknowledgementByToken.mockResolvedValue({ ...ACK_ROW, acknowledged_at: '2026-07-02T10:00:00Z', download_count: 1 });
    db.recordAttestation.mockResolvedValue({ ...ACK_ROW, acknowledged_at: '2026-07-02T10:00:00Z', attested_at: '2026-07-04T12:00:00Z' });
    const res = await request(app).post(`/api/attest/${TOKEN}`);
    expect(res.status).toBe(200);
    expect(db.recordAttestation).toHaveBeenCalled();
    expect(db.incrementAcknowledgementCount).not.toHaveBeenCalled();
  });
});

// ─── Receipt polling ──────────────────────────────────────────────────────────

describe('POST /api/policies/:id/receipts/poll', () => {
  const PENDING = { ...BASE_POLICY, status: 'PENDING_ACCEPTANCE', current_version: 'v2.0' };

  const OUTSTANDING = [
    { policy_id: 'POL-2026-001', version: 'v2.0', recipient_email: 'a@acme.example', lf_message_id: 'lf-msg-a', tenant_id: 1 },
    { policy_id: 'POL-2026-001', version: 'v2.0', recipient_email: 'b@acme.example', lf_message_id: 'lf-msg-b', tenant_id: 1 },
  ];

  test('viewer cannot poll receipts (owner/admin only)', async () => {
    db.getPolicyById.mockResolvedValue({ ...PENDING });
    const res = await asUser(
      request(app).post('/api/policies/POL-2026-001/receipts/poll').send({}),
      USERS.viewer
    );
    expect(res.status).toBe(403);
  });

  test('records acknowledgements from recipient downloads', async () => {
    db.getPolicyById.mockResolvedValue({ ...PENDING, acknowledgement_total: 2 });
    db.getOutstandingRecipients.mockResolvedValue(OUTSTANDING);
    db.recordAcknowledgement.mockResolvedValue();
    db.incrementAcknowledgementCount.mockResolvedValue({ acknowledgement_count: 1, acknowledgement_total: 2 });
    // a@ downloaded; b@'s message has only an admin download — not a receipt.
    msg.getMessageDownloads.mockImplementation(async (id) =>
      id === 'lf-msg-a'
        ? [{ recipient: 'A@acme.example', downloaded_at: '2026-06-12T09:00:00Z', remote_ip: '203.0.113.9', filename: 'POL-2026-001-v2.0.docx' }]
        : [{ recipient: 'admin@acme.example', downloaded_at: '2026-06-12T09:05:00Z', filename: 'POL-2026-001-v2.0.docx' }]
    );

    const res = await asUser(
      request(app).post('/api/policies/POL-2026-001/receipts/poll').send({}),
      USERS.owner
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ checked: 2, recorded: 1, activated: false });
    expect(db.recordAcknowledgement).toHaveBeenCalledTimes(1);
    expect(db.recordAcknowledgement).toHaveBeenCalledWith(expect.objectContaining({
      recipientEmail: 'a@acme.example',
      acknowledgedAt: '2026-06-12T09:00:00Z',
      ipAddress:      '203.0.113.9',
      messageId:      'lf-msg-a',
    }));
  });

  test('activates the policy when the last acknowledgement lands', async () => {
    db.getPolicyById.mockResolvedValue({ ...PENDING, acknowledgement_total: 1 });
    db.getOutstandingRecipients.mockResolvedValue([OUTSTANDING[0]]);
    db.recordAcknowledgement.mockResolvedValue();
    db.incrementAcknowledgementCount.mockResolvedValue({ acknowledgement_count: 1, acknowledgement_total: 1 });
    msg.getMessageDownloads.mockResolvedValue([
      { recipient: 'a@acme.example', downloaded_at: '2026-06-12T09:00:00Z', filename: 'POL-2026-001-v2.0.docx' },
    ]);
    msg.sendActivationNotice.mockResolvedValue({ id: 'lf-msg-act' });

    const res = await asUser(
      request(app).post('/api/policies/POL-2026-001/receipts/poll').send({}),
      USERS.owner
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ checked: 1, recorded: 1, activated: true });
    expect(db.updatePolicy).toHaveBeenCalledWith(TENANT.id, 'POL-2026-001', { status: 'ACTIVE' });
    expect(msg.sendActivationNotice).toHaveBeenCalled();
  });

  test('a failed download-log fetch skips the recipient without failing the poll', async () => {
    db.getPolicyById.mockResolvedValue({ ...PENDING, acknowledgement_total: 2 });
    db.getOutstandingRecipients.mockResolvedValue(OUTSTANDING);
    msg.getMessageDownloads.mockRejectedValue(new Error('appliance down'));

    const res = await asUser(
      request(app).post('/api/policies/POL-2026-001/receipts/poll').send({}),
      USERS.owner
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ checked: 2, recorded: 0, activated: false });
    expect(db.recordAcknowledgement).not.toHaveBeenCalled();
  });
});

describe('POST /api/policies/:id/retire', () => {
  test('owner cannot retire (admin only)', async () => {
    const res = await asUser(request(app).post('/api/policies/POL-2026-001/retire'), USERS.owner);
    expect(res.status).toBe(403);
  });

  test('unknown policy → 404', async () => {
    db.getPolicyById.mockResolvedValue(null);
    const res = await asUser(request(app).post('/api/policies/POL-9999-999/retire'), USERS.admin);
    expect(res.status).toBe(404);
  });

  test('admin retires the policy', async () => {
    const res = await asUser(request(app).post('/api/policies/POL-2026-001/retire'), USERS.admin);
    expect(res.status).toBe(200);
    expect(db.updatePolicy).toHaveBeenCalledWith(TENANT.id, 'POL-2026-001', { status: 'RETIRED' });
  });
});

describe('POST /api/policies/:id/review', () => {
  test('only ACTIVE policies can enter review', async () => {
    db.getPolicyById.mockResolvedValue({ ...BASE_POLICY, status: 'DRAFT' });
    const res = await asUser(request(app).post('/api/policies/POL-2026-001/review'), USERS.owner);
    expect(res.status).toBe(400);
  });

  test('owner triggers ad-hoc review', async () => {
    db.getPolicyById.mockResolvedValue({ ...BASE_POLICY, status: 'ACTIVE' });
    const res = await asUser(request(app).post('/api/policies/POL-2026-001/review'), USERS.owner);
    expect(res.status).toBe(200);
    expect(db.updatePolicy).toHaveBeenCalledWith(TENANT.id, 'POL-2026-001', {
      status: 'UNDER_REVIEW', advance_notice_sent: false, escalation_sent: false,
    });
  });

  test('seeds the working copy from /current/ into /drafts/', async () => {
    db.getPolicyById.mockResolvedValue({
      ...BASE_POLICY, status: 'ACTIVE', lf_folder_ids: { ...LF_FOLDERS },
    });
    lf.copyNewestFile.mockResolvedValue({
      name: 'POL-2026-001-v1.3.docx',
      file: { id: 'lf-copy', checksum: 'sha256-copy' },
    });
    const res = await asUser(request(app).post('/api/policies/POL-2026-001/review'), USERS.owner);
    expect(res.status).toBe(200);
    expect(lf.copyNewestFile).toHaveBeenCalledWith(
      TENANT.lf_share_name, LF_FOLDERS.current, LF_FOLDERS.drafts,
    );
    expect(db.logChange).toHaveBeenCalledWith(expect.objectContaining({
      event:    expect.stringContaining('Working copy seeded'),
      metadata: { lf_file_id: 'lf-copy', checksum: 'sha256-copy' },
    }));
  });

  test('a storage failure does not block the review trigger', async () => {
    db.getPolicyById.mockResolvedValue({
      ...BASE_POLICY, status: 'ACTIVE', lf_folder_ids: { ...LF_FOLDERS },
    });
    lf.copyNewestFile.mockRejectedValue(new Error('appliance down'));
    const res = await asUser(request(app).post('/api/policies/POL-2026-001/review'), USERS.owner);
    expect(res.status).toBe(200);
    expect(db.updatePolicy).toHaveBeenCalledWith(TENANT.id, 'POL-2026-001', {
      status: 'UNDER_REVIEW', advance_notice_sent: false, escalation_sent: false,
    });
  });
});

// ─── Edit metadata ─────────────────────────────────────────────────────────────

describe('PUT /api/policies/:id (edit metadata)', () => {
  test('authoriser (not owner/admin) cannot edit', async () => {
    const res = await asUser(
      request(app).put('/api/policies/POL-2026-001').send({ title: 'X' }),
      USERS.authoriser,
    );
    expect(res.status).toBe(403);
  });

  test('owner edits metadata; fields are trimmed and mapped to columns', async () => {
    const res = await asUser(
      request(app).put('/api/policies/POL-2026-001').send({
        title: '  New Title  ',
        category: 'Security',
        owner: 'newowner@acme.example',
        reviewFrequencyMonths: 24,
        applicableRoles: [' engineering ', 'product', ''],
      }),
      USERS.owner,
    );
    expect(res.status).toBe(200);
    expect(db.updatePolicy).toHaveBeenCalledWith(TENANT.id, 'POL-2026-001', {
      title: 'New Title',
      category: 'Security',
      owner_email: 'newowner@acme.example',
      review_frequency_months: 24,
      applicable_roles: ['engineering', 'product'],
    });
    expect(db.logChange).toHaveBeenCalled();
  });

  test('admin reassigns authorisers (lowercased + deduped) as a single stage', async () => {
    const res = await asUser(
      request(app).put('/api/policies/POL-2026-001').send({
        authorisers: ['Ciso@acme.example', 'legal@acme.example', 'ciso@acme.example'],
      }),
      USERS.admin,
    );
    expect(res.status).toBe(200);
    expect(db.setAuthorisationRoute).toHaveBeenCalledWith(
      TENANT.id, 'POL-2026-001', [{ threshold: null, members: ['ciso@acme.example', 'legal@acme.example'] }],
    );
  });

  test('admin sets a multi-stage authorisation route', async () => {
    const res = await asUser(
      request(app).put('/api/policies/POL-2026-001').send({
        authorisationRoute: [
          { threshold: 'all', members: ['Lead@acme.example'] },
          { threshold: 2,     members: ['a@acme.example', 'b@acme.example', 'c@acme.example'] },
        ],
      }),
      USERS.admin,
    );
    expect(res.status).toBe(200);
    expect(db.setAuthorisationRoute).toHaveBeenCalledWith(TENANT.id, 'POL-2026-001', [
      { threshold: null, members: ['lead@acme.example'] },
      { threshold: 2,    members: ['a@acme.example', 'b@acme.example', 'c@acme.example'] },
    ]);
  });

  test('rejects a stage quorum larger than its membership', async () => {
    const res = await asUser(
      request(app).put('/api/policies/POL-2026-001').send({
        authorisationRoute: [{ threshold: 3, members: ['a@acme.example', 'b@acme.example'] }],
      }),
      USERS.admin,
    );
    expect(res.status).toBe(400);
    expect(db.setAuthorisationRoute).not.toHaveBeenCalled();
  });

  test('rejects an empty title', async () => {
    const res = await asUser(
      request(app).put('/api/policies/POL-2026-001').send({ title: '   ' }),
      USERS.owner,
    );
    expect(res.status).toBe(400);
    expect(db.updatePolicy).not.toHaveBeenCalled();
  });

  test('rejects a bad owner email', async () => {
    const res = await asUser(
      request(app).put('/api/policies/POL-2026-001').send({ owner: 'not-an-email' }),
      USERS.owner,
    );
    expect(res.status).toBe(400);
  });

  test('rejects out-of-range review frequency', async () => {
    const res = await asUser(
      request(app).put('/api/policies/POL-2026-001').send({ reviewFrequencyMonths: 0 }),
      USERS.owner,
    );
    expect(res.status).toBe(400);
  });

  test('empty body → 400 (nothing to change)', async () => {
    const res = await asUser(
      request(app).put('/api/policies/POL-2026-001').send({}),
      USERS.owner,
    );
    expect(res.status).toBe(400);
  });
});

// ─── Review activity: comments & reads ──────────────────────────────────────

describe('Review activity — comments & reads', () => {
  test('viewer can post a comment against the current version', async () => {
    db.addComment.mockResolvedValue({
      id: 1, version: 'v1.3', author_email: USERS.viewer.email, kind: 'comment',
      body: 'Looks good', created_at: '2026-06-24T00:00:00Z',
    });
    const res = await asUser(
      request(app).post('/api/policies/POL-2026-001/comments').send({ body: 'Looks good' }),
      USERS.viewer,
    );
    expect(res.status).toBe(201);
    expect(db.addComment).toHaveBeenCalledWith(TENANT.id, 'POL-2026-001', expect.objectContaining({
      version: 'v1.3', authorEmail: USERS.viewer.email, kind: 'comment', body: 'Looks good',
    }));
  });

  test('rejects an empty comment body', async () => {
    const res = await asUser(
      request(app).post('/api/policies/POL-2026-001/comments').send({ body: '   ' }),
      USERS.viewer,
    );
    expect(res.status).toBe(400);
    expect(db.addComment).not.toHaveBeenCalled();
  });

  test('rejects an unknown comment kind', async () => {
    const res = await asUser(
      request(app).post('/api/policies/POL-2026-001/comments').send({ body: 'x', kind: 'rant' }),
      USERS.viewer,
    );
    expect(res.status).toBe(400);
  });

  test('lists comments', async () => {
    db.getComments.mockResolvedValue([{ id: 1, body: 'hi' }]);
    const res = await asUser(request(app).get('/api/policies/POL-2026-001/comments'), USERS.viewer);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  test('records a read and returns the count', async () => {
    db.recordRead.mockResolvedValue({ version: 'v1.3', read_count: 2 });
    const res = await asUser(
      request(app).post('/api/policies/POL-2026-001/read').send({}),
      USERS.authoriser,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ version: 'v1.3', readCount: 2 });
    expect(db.recordRead).toHaveBeenCalledWith(TENANT.id, 'POL-2026-001', expect.objectContaining({
      version: 'v1.3', readerEmail: USERS.authoriser.email,
    }));
  });

  test('lists reads', async () => {
    db.getReads.mockResolvedValue([{ version: 'v1.3', reader_email: 'x@acme.example', read_count: 1 }]);
    const res = await asUser(request(app).get('/api/policies/POL-2026-001/reads'), USERS.admin);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  test('a user with no read access cannot comment', async () => {
    db.getPolicyById.mockResolvedValue({ ...BASE_POLICY, owner_email: 'someone-else@acme.example' });
    db.getAuthorisers.mockResolvedValue([]);
    const res = await asUser(
      request(app).post('/api/policies/POL-2026-001/comments').send({ body: 'x' }),
      USERS.owner,
    );
    expect(res.status).toBe(403);
  });
});

// ─── Document versions ───────────────────────────────────────────────────────

describe('Document versions', () => {
  test('lists stored versions across folders, newest first, deleted excluded', async () => {
    db.getPolicyById.mockResolvedValue({ ...BASE_POLICY, lf_folder_ids: { ...LF_FOLDERS } });
    lf.listFiles.mockImplementation(async (_share, folderId) => {
      if (folderId === LF_FOLDERS.current) {
        return [{ id: 'f1', name: 'POL-2026-001-v2.0.pdf', size: 100, checksum: 'abc', content_type: 'application/pdf', created_at: '2026-06-10T00:00:00Z', deleted: false }];
      }
      if (folderId === LF_FOLDERS.drafts) {
        return [
          { id: 'f2', name: 'POL-2026-001-v2.1.docx', size: 200, checksum: 'def', created_at: '2026-06-11T00:00:00Z', deleted: false },
          { id: 'del', name: 'gone', created_at: '2026-01-01T00:00:00Z', deleted: true },
        ];
      }
      return [];
    });
    const res = await asUser(request(app).get('/api/policies/POL-2026-001/documents'), USERS.viewer);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].id).toBe('f2'); // newest
    expect(res.body.find(d => d.id === 'f1').area).toBe('current');
  });

  test('a folder that fails to list is skipped, not fatal', async () => {
    db.getPolicyById.mockResolvedValue({ ...BASE_POLICY, lf_folder_ids: { ...LF_FOLDERS } });
    lf.listFiles.mockRejectedValue(new Error('appliance down'));
    const res = await asUser(request(app).get('/api/policies/POL-2026-001/documents'), USERS.viewer);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('downloads a specific version', async () => {
    db.getPolicyById.mockResolvedValue({ ...BASE_POLICY, lf_folder_ids: { ...LF_FOLDERS } });
    lf.downloadFile.mockResolvedValue({ buffer: Buffer.from('PDF-BYTES'), contentType: 'application/pdf' });
    const res = await asUser(
      request(app).get('/api/policies/POL-2026-001/documents/download?area=current&file=f1&name=POL-2026-001-v2.0.pdf'),
      USERS.viewer,
    );
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/POL-2026-001-v2\.0\.pdf/);
    expect(lf.downloadFile).toHaveBeenCalledWith(TENANT.lf_share_name, LF_FOLDERS.current, 'f1');
  });

  test('download rejects an unknown area', async () => {
    db.getPolicyById.mockResolvedValue({ ...BASE_POLICY, lf_folder_ids: { ...LF_FOLDERS } });
    const res = await asUser(
      request(app).get('/api/policies/POL-2026-001/documents/download?area=secret&file=f1'),
      USERS.viewer,
    );
    expect(res.status).toBe(400);
  });
});

// ─── Read endpoints ───────────────────────────────────────────────────────────

describe('GET /api/policies/:id', () => {
  test('viewer can read and gets authorisers attached', async () => {
    const res = await asUser(request(app).get('/api/policies/POL-2026-001'), USERS.viewer);
    expect(res.status).toBe(200);
    expect(res.body.policy_id).toBe('POL-2026-001');
    expect(res.body.authorisers).toEqual([{ email: USERS.authoriser.email, stage_position: 1 }]);
    // Structured route (with per-stage progress) is attached too.
    expect(res.body.authorisationRoute).toHaveLength(1);
    expect(res.body.authorisationRoute[0]).toMatchObject({ position: 1, threshold: null });
    // Exec-gate summary is attached; BASE_POLICY (IT) doesn't require exec.
    expect(res.body.exec).toMatchObject({ required: false, email: null, decision: null });
    // Owner-acceptance summary is attached; default tenant has the gate off.
    expect(res.body.ownerAcceptance).toMatchObject({ required: false, decision: null });
  });

  test('exec summary reflects the assigned exec and their decision', async () => {
    db.getPolicyById.mockResolvedValue({ ...BASE_POLICY, category: 'Security', exec_email: USERS.exec.email });
    db.getExecDecision.mockResolvedValue({
      email: USERS.exec.email, decision: 'approved', created_at: '2026-07-05T00:00:00Z', feedback: null,
    });
    const res = await asUser(request(app).get('/api/policies/POL-2026-001'), USERS.viewer);
    expect(res.status).toBe(200);
    expect(res.body.exec).toMatchObject({
      required: true, email: USERS.exec.email, decision: 'approved',
    });
  });

  test('owner of a different policy is rejected', async () => {
    db.getPolicyById.mockResolvedValue({ ...BASE_POLICY, owner_email: 'someone-else@acme.example' });
    const res = await asUser(request(app).get('/api/policies/POL-2026-001'), USERS.owner);
    expect(res.status).toBe(403);
  });

  test('unknown policy → 404', async () => {
    db.getPolicyById.mockResolvedValue(null);
    const res = await asUser(request(app).get('/api/policies/POL-0000-000'), USERS.admin);
    expect(res.status).toBe(404);
  });
});

// ─── Staff role (workforce ≠ observers) ───────────────────────────────────────
// Staff are the people policies are distributed TO — a separate category from
// viewer (auditors / SIEM observers). They see the ACTIVE register only, and
// none of the workflow, receipts, audiences, or governance surfaces.

describe('staff role (workforce, active register only)', () => {
  const ACTIVE_POLICY = { ...BASE_POLICY, status: 'ACTIVE', lf_folder_ids: { ...LF_FOLDERS } };

  test('list is forced to ACTIVE regardless of the status query', async () => {
    const res = await asUser(request(app).get('/api/policies?status=DRAFT'), USERS.staff);
    expect(res.status).toBe(200);
    expect(db.listPolicies.mock.calls[0][0].status).toBe('ACTIVE');
  });

  test('reads an ACTIVE policy trimmed of workflow internals', async () => {
    db.getPolicyById.mockResolvedValue({ ...ACTIVE_POLICY });
    const res = await asUser(request(app).get('/api/policies/POL-2026-001'), USERS.staff);
    expect(res.status).toBe(200);
    expect(res.body.policy_id).toBe('POL-2026-001');
    expect(res.body.authorisers).toBeUndefined();
    expect(res.body.authorisationRoute).toBeUndefined();
    expect(res.body.exec).toBeUndefined();
    expect(res.body.ownerAcceptance).toBeUndefined();
    expect(res.body.linkedRisks).toBeUndefined();
  });

  test('a policy that is not ACTIVE is invisible to staff', async () => {
    const res = await asUser(request(app).get('/api/policies/POL-2026-001'), USERS.staff); // BASE_POLICY is UNDER_REVIEW
    expect(res.status).toBe(403);
  });

  test('workflow sub-resources stay closed even on an ACTIVE policy', async () => {
    db.getPolicyById.mockResolvedValue({ ...ACTIVE_POLICY });
    for (const path of ['changelog', 'comments', 'reads', 'acknowledgements']) {
      const res = await asUser(request(app).get(`/api/policies/POL-2026-001/${path}`), USERS.staff);
      expect(res.status).toBe(403);
    }
    const post = await asUser(
      request(app).post('/api/policies/POL-2026-001/comments').send({ body: 'hi' }),
      USERS.staff,
    );
    expect(post.status).toBe(403);
  });

  test('documents list only the published (current) area', async () => {
    db.getPolicyById.mockResolvedValue({ ...ACTIVE_POLICY });
    lf.listFiles.mockImplementation(async (_share, folderId) =>
      folderId === LF_FOLDERS.current
        ? [{ id: 'f1', name: 'POL-2026-001-v2.0.pdf', size: 100, checksum: 'abc', created_at: '2026-06-10T00:00:00Z', deleted: false }]
        : [{ id: 'f2', name: 'draft.docx', size: 200, checksum: 'def', created_at: '2026-06-11T00:00:00Z', deleted: false }],
    );
    const res = await asUser(request(app).get('/api/policies/POL-2026-001/documents'), USERS.staff);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: 'f1', area: 'current' });
  });

  test('can download the published document, not drafts', async () => {
    db.getPolicyById.mockResolvedValue({ ...ACTIVE_POLICY });
    lf.downloadFile.mockResolvedValue({ buffer: Buffer.from('PDF-BYTES'), contentType: 'application/pdf' });
    const ok = await asUser(
      request(app).get('/api/policies/POL-2026-001/documents/download?area=current&file=f1'),
      USERS.staff,
    );
    expect(ok.status).toBe(200);
    const drafts = await asUser(
      request(app).get('/api/policies/POL-2026-001/documents/download?area=drafts&file=f2'),
      USERS.staff,
    );
    expect(drafts.status).toBe(403);
  });

  test('observer/governance surfaces are all denied', async () => {
    const paths = [
      '/api/register', '/api/audit', '/api/groups', '/api/users', '/api/settings',
      '/api/evidence', '/api/risks', '/api/access-reviews', '/api/vendors',
    ];
    for (const path of paths) {
      const res = await asUser(request(app).get(path), USERS.staff);
      expect(res.status).toBe(403);
    }
  });

  test('dashboard returns an empty aggregate (no governance sections)', async () => {
    const res = await asUser(request(app).get('/api/dashboard'), USERS.staff);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  test('admin can assign the staff role', async () => {
    const target = { id: 'u-member', email: 'member@acme.example', role: 'viewer', tenant_id: 1 };
    db.getAppUserById.mockImplementation(async (id) =>
      id === target.id ? target : Object.values(USERS).find(u => u.id === id) || null,
    );
    db.updateAppUserRole.mockResolvedValue({ ...target, role: 'staff' });
    const res = await asUser(
      request(app).patch('/api/users/u-member').send({ role: 'staff' }),
      USERS.admin,
    );
    expect(res.status).toBe(200);
    expect(db.updateAppUserRole).toHaveBeenCalledWith(TENANT.id, 'u-member', 'staff');
    expect(res.body.user.role).toBe('staff');
  });
});

// ─── Acceptor role (the named signer) ─────────────────────────────────────────
// A dedicated role for people whose only duty is signing: risk acceptance,
// executive policy sign-off, access-review attestation. They reach the Risk
// Register and Access Reviews plus only the policies naming them as exec —
// never the Evidence Locker, Vendor Assessments, or admin surfaces.

describe('acceptor role (named signer)', () => {
  test('policy list is scoped to policies naming them as exec', async () => {
    const res = await asUser(request(app).get('/api/policies'), USERS.acceptor);
    expect(res.status).toBe(200);
    expect(db.listPolicies.mock.calls[0][0].execEmail).toBe(USERS.acceptor.email);
  });

  test('reads a policy that names them as exec; others are invisible', async () => {
    db.getPolicyById.mockResolvedValue({ ...BASE_POLICY, exec_email: USERS.acceptor.email });
    const ok = await asUser(request(app).get('/api/policies/POL-2026-001'), USERS.acceptor);
    expect(ok.status).toBe(200);
    expect(ok.body.authorisers).toBeDefined(); // full detail — they sign what they can see

    db.getPolicyById.mockResolvedValue({ ...BASE_POLICY, exec_email: 'someone-else@acme.example' });
    const no = await asUser(request(app).get('/api/policies/POL-2026-001'), USERS.acceptor);
    expect(no.status).toBe(403);
  });

  test('gives executive sign-off on a policy naming them', async () => {
    db.getPolicyById.mockResolvedValue({
      ...BASE_POLICY, status: 'EXEC_REVIEW', category: 'Security', exec_email: USERS.acceptor.email,
    });
    const res = await asUser(
      request(app).post('/api/policies/POL-2026-001/exec-authorise'),
      USERS.acceptor,
    );
    expect(res.status).toBe(200);
    expect(db.recordExecDecision).toHaveBeenCalledWith(TENANT.id, expect.objectContaining({
      email: USERS.acceptor.email, decision: 'approved',
    }));
  });

  test('accepts a risk where they are the named acceptor', async () => {
    TENANT.entitlements = ['policy_hub', 'risk_register'];
    db.getRiskById.mockResolvedValue({
      id: 1, tenant_id: 1, risk_id: 'RSK-2026-001', title: 'Unpatched servers', status: 'OPEN',
      owner_email: USERS.owner.email, acceptor_email: USERS.acceptor.email,
      policy_ids: [], evidence_ids: [],
    });
    db.getRiskAssessments.mockResolvedValue([{
      id: 1, round: 1, inherent_likelihood: 4, inherent_impact: 4,
      residual_likelihood: 2, residual_impact: 4, treatment: 'mitigate',
    }]);
    db.getRiskAcceptances.mockResolvedValue([]);
    db.addRiskAcceptance.mockResolvedValue({ id: 1, round: 1, acceptor_email: USERS.acceptor.email });
    db.logRiskEvent.mockResolvedValue();
    const res = await asUser(
      request(app).post('/api/risks/RSK-2026-001/accept').send({ notes: 'Accepted for FY26' }),
      USERS.acceptor,
    );
    expect(res.status).toBe(201);
    expect(db.addRiskAcceptance).toHaveBeenCalledWith(TENANT.id, expect.objectContaining({
      riskId: 'RSK-2026-001', round: 1, acceptorEmail: USERS.acceptor.email,
    }));
  });

  test('reaches risks and access reviews, never evidence or vendors', async () => {
    TENANT.entitlements = ['policy_hub', 'evidence_locker', 'risk_register', 'access_reviews', 'vendor_assessments'];
    db.listRisks.mockResolvedValue([]);
    db.listAccessReviews.mockResolvedValue([]);
    expect((await asUser(request(app).get('/api/risks'), USERS.acceptor)).status).toBe(200);
    expect((await asUser(request(app).get('/api/access-reviews'), USERS.acceptor)).status).toBe(200);
    expect((await asUser(request(app).get('/api/evidence'), USERS.acceptor)).status).toBe(403);
    expect((await asUser(request(app).get('/api/vendors'), USERS.acceptor)).status).toBe(403);
    for (const path of ['/api/register', '/api/audit', '/api/groups', '/api/users', '/api/settings']) {
      expect((await asUser(request(app).get(path), USERS.acceptor)).status).toBe(403);
    }
  });

  test('my tasks: exec sign-off and risk acceptance waiting on them', async () => {
    TENANT.entitlements = ['policy_hub', 'risk_register'];
    db.listPolicies.mockImplementation(async (f) =>
      f.execEmail === USERS.acceptor.email
        ? [{ ...BASE_POLICY, status: 'EXEC_REVIEW', exec_email: USERS.acceptor.email }]
        : [],
    );
    db.listRisks.mockResolvedValue([
      { risk_id: 'RSK-2026-001', title: 'Unpatched servers', status: 'OPEN',
        owner_email: USERS.owner.email, acceptor_email: USERS.acceptor.email, round: 1, accepted: false },
      { risk_id: 'RSK-2026-002', title: 'Already accepted', status: 'OPEN',
        owner_email: USERS.owner.email, acceptor_email: USERS.acceptor.email, round: 1, accepted: true },
      { risk_id: 'RSK-2026-003', title: 'Someone else signs', status: 'OPEN',
        owner_email: USERS.owner.email, acceptor_email: 'other@acme.example', round: 1, accepted: false },
    ]);
    const res = await asUser(request(app).get('/api/tasks'), USERS.acceptor);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.tasks.map(t => t.kind)).toEqual(['sign-off', 'accept']);
    expect(res.body.tasks[1]).toMatchObject({ risk_id: 'RSK-2026-001', kind: 'accept' });
  });

  test('admin can assign the acceptor role', async () => {
    const target = { id: 'u-member', email: 'member@acme.example', role: 'viewer', tenant_id: 1 };
    db.getAppUserById.mockImplementation(async (id) =>
      id === target.id ? target : Object.values(USERS).find(u => u.id === id) || null,
    );
    db.updateAppUserRole.mockResolvedValue({ ...target, role: 'acceptor' });
    const res = await asUser(
      request(app).patch('/api/users/u-member').send({ role: 'acceptor' }),
      USERS.admin,
    );
    expect(res.status).toBe(200);
    expect(db.updateAppUserRole).toHaveBeenCalledWith(TENANT.id, 'u-member', 'acceptor');
    expect(res.body.user.role).toBe('acceptor');
  });
});

// ─── Register export ──────────────────────────────────────────────────────────

describe('GET /api/register', () => {
  test('owner role cannot export the register', async () => {
    const res = await asUser(request(app).get('/api/register'), USERS.owner);
    expect(res.status).toBe(403);
  });

  test('viewer gets the JSON register', async () => {
    const res = await asUser(request(app).get('/api/register'), USERS.viewer);
    expect(res.status).toBe(200);
    expect(res.body.tenant).toBe('default');
    expect(res.body.count).toBe(1);
    expect(res.body.policies[0].policy_id).toBe('POL-2026-001');
    // internal columns must not leak
    expect(res.body.policies[0].lf_folder_id_root).toBeUndefined();
  });

  test('?format=csv downloads a CSV', async () => {
    const res = await asUser(request(app).get('/api/register?format=csv'), USERS.admin);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/policy-register-default-\d{4}-\d{2}-\d{2}\.csv/);
    const [header, row] = res.text.split('\r\n');
    expect(header.split(',')[0]).toBe('policy_id');
    expect(row).toContain('POL-2026-001');
  });

  test('status filter is passed through', async () => {
    await asUser(request(app).get('/api/register?status=ACTIVE'), USERS.admin);
    expect(db.listPolicies.mock.calls[0][0].status).toBe('ACTIVE');
  });
});

// ─── Staff directory (users) ──────────────────────────────────────────────────

describe('GET /api/users', () => {
  test('owner role cannot list users', async () => {
    const res = await asUser(request(app).get('/api/users'), USERS.owner);
    expect(res.status).toBe(403);
  });

  test('admin lists tenant members without leaking internal columns', async () => {
    db.listAppUsersByTenant.mockResolvedValue([
      { id: 'u1', email: 'a@acme.example', role: 'owner', tenant_id: 1, created_at: '2026-01-01' },
    ]);
    const res = await asUser(request(app).get('/api/users'), USERS.admin);
    expect(res.status).toBe(200);
    expect(db.listAppUsersByTenant).toHaveBeenCalledWith(TENANT.id);
    expect(res.body).toEqual([
      { id: 'u1', email: 'a@acme.example', role: 'owner', created_at: '2026-01-01' },
    ]);
    expect(res.body[0].tenant_id).toBeUndefined();
  });

  test('governance_lead may read the directory', async () => {
    db.listAppUsersByTenant.mockResolvedValue([]);
    const gov = { id: 'u-gov', email: 'gov@acme.example', role: 'governance_lead', tenant_id: 1 };
    db.getAppUserById.mockResolvedValue(gov);
    const res = await asUser(request(app).get('/api/users'), gov);
    expect(res.status).toBe(200);
  });
});

describe('POST /api/users (invite)', () => {
  test('owner cannot invite', async () => {
    const res = await asUser(
      request(app).post('/api/users').send({ email: 'x@acme.example', role: 'owner' }),
      USERS.owner
    );
    expect(res.status).toBe(403);
  });

  test('rejects an invalid email', async () => {
    const res = await asUser(
      request(app).post('/api/users').send({ email: 'not-an-email', role: 'owner' }),
      USERS.admin
    );
    expect(res.status).toBe(400);
  });

  test('rejects howldr_support (cross-tenant, not assignable here)', async () => {
    const res = await asUser(
      request(app).post('/api/users').send({ email: 'x@acme.example', role: 'howldr_support' }),
      USERS.admin
    );
    expect(res.status).toBe(400);
  });

  test('503 when invites are not configured', async () => {
    admin.isInviteConfigured.mockReturnValue(false);
    const res = await asUser(
      request(app).post('/api/users').send({ email: 'x@acme.example', role: 'owner' }),
      USERS.admin
    );
    expect(res.status).toBe(503);
    expect(admin.generateInviteOrReuse).not.toHaveBeenCalled();
  });

  test('admin invites a new user and gets an action link back', async () => {
    admin.generateInviteOrReuse.mockResolvedValue({
      user: { id: 'auth-123', email: 'newbie@acme.example' },
      actionLink: 'https://auth.example/invite#tok',
      reused: false,
    });
    db.upsertAppUser.mockResolvedValue({
      id: 'auth-123', email: 'newbie@acme.example', role: 'authoriser', tenant_id: 1, created_at: '2026-06-13',
    });

    const res = await asUser(
      request(app).post('/api/users').send({ email: 'Newbie@acme.example', role: 'authoriser' }),
      USERS.admin
    );

    expect(res.status).toBe(201);
    // email normalised to lower-case before invite + persist
    expect(admin.generateInviteOrReuse).toHaveBeenCalledWith({}, 'newbie@acme.example', expect.objectContaining({
      tenant_id: TENANT.id, role: 'authoriser',
    }));
    expect(db.upsertAppUser).toHaveBeenCalledWith({
      id: 'auth-123', email: 'newbie@acme.example', tenantId: TENANT.id, role: 'authoriser',
    });
    expect(res.body).toEqual({
      user: { id: 'auth-123', email: 'newbie@acme.example', role: 'authoriser', created_at: '2026-06-13' },
      actionLink: 'https://auth.example/invite#tok',
      reused: false,
    });
  });

  test('reused existing auth user returns no action link', async () => {
    admin.generateInviteOrReuse.mockResolvedValue({
      user: { id: 'auth-existing', email: 'back@acme.example' },
      actionLink: null,
      reused: true,
    });
    db.upsertAppUser.mockResolvedValue({
      id: 'auth-existing', email: 'back@acme.example', role: 'viewer', tenant_id: 1, created_at: '2026-06-13',
    });
    const res = await asUser(
      request(app).post('/api/users').send({ email: 'back@acme.example', role: 'viewer' }),
      USERS.admin
    );
    expect(res.status).toBe(201);
    expect(res.body.reused).toBe(true);
    expect(res.body.actionLink).toBeNull();
  });
});

describe('PATCH /api/users/:id (role)', () => {
  const member = { id: 'u-member', email: 'member@acme.example', role: 'owner', tenant_id: 1 };

  // getAppUserById resolves both the caller (from the JWT sub) and the target,
  // so the mock must key off the id — return the target for u-member, and fall
  // back to the USERS fixtures (so the admin caller stays the admin).
  function withTarget(target) {
    db.getAppUserById.mockImplementation(async (id) =>
      id === target.id ? target : (Object.values(USERS).find(u => u.id === id) || null)
    );
  }

  test('rejects an unknown role', async () => {
    withTarget(member);
    const res = await asUser(
      request(app).patch('/api/users/u-member').send({ role: 'wizard' }),
      USERS.admin
    );
    expect(res.status).toBe(400);
  });

  test('404 when the target is in another tenant', async () => {
    withTarget({ ...member, tenant_id: 2 });
    const res = await asUser(
      request(app).patch('/api/users/u-member').send({ role: 'authoriser' }),
      USERS.admin
    );
    expect(res.status).toBe(404);
  });

  test('admin cannot change their own role', async () => {
    withTarget(member);
    const res = await asUser(
      request(app).patch(`/api/users/${USERS.admin.id}`).send({ role: 'viewer' }),
      USERS.admin
    );
    expect(res.status).toBe(400);
    expect(db.updateAppUserRole).not.toHaveBeenCalled();
  });

  test('cannot demote the last admin', async () => {
    withTarget({ ...member, role: 'admin' });
    db.countTenantAdmins.mockResolvedValue(1);
    const res = await asUser(
      request(app).patch('/api/users/u-member').send({ role: 'viewer' }),
      USERS.admin
    );
    expect(res.status).toBe(400);
    expect(db.updateAppUserRole).not.toHaveBeenCalled();
  });

  test('admin changes a member role', async () => {
    withTarget(member);
    db.updateAppUserRole.mockResolvedValue({ ...member, role: 'authoriser', created_at: '2026-06-13' });
    const res = await asUser(
      request(app).patch('/api/users/u-member').send({ role: 'authoriser' }),
      USERS.admin
    );
    expect(res.status).toBe(200);
    expect(db.updateAppUserRole).toHaveBeenCalledWith(TENANT.id, 'u-member', 'authoriser');
    expect(res.body.user.role).toBe('authoriser');
  });
});

describe('DELETE /api/users/:id', () => {
  const member = { id: 'u-member', email: 'member@acme.example', role: 'owner', tenant_id: 1 };

  function withTarget(target) {
    db.getAppUserById.mockImplementation(async (id) =>
      id === target.id ? target : (Object.values(USERS).find(u => u.id === id) || null)
    );
  }

  test('admin cannot remove themselves', async () => {
    const res = await asUser(request(app).delete(`/api/users/${USERS.admin.id}`), USERS.admin);
    expect(res.status).toBe(400);
    expect(db.deleteAppUserInTenant).not.toHaveBeenCalled();
  });

  test('cannot remove the last admin', async () => {
    withTarget({ ...member, role: 'admin' });
    db.countTenantAdmins.mockResolvedValue(1);
    const res = await asUser(request(app).delete('/api/users/u-member'), USERS.admin);
    expect(res.status).toBe(400);
    expect(db.deleteAppUserInTenant).not.toHaveBeenCalled();
  });

  test('admin removes a member', async () => {
    withTarget(member);
    db.deleteAppUserInTenant.mockResolvedValue(true);
    const res = await asUser(request(app).delete('/api/users/u-member'), USERS.admin);
    expect(res.status).toBe(200);
    expect(db.deleteAppUserInTenant).toHaveBeenCalledWith(TENANT.id, 'u-member');
  });
});

// ─── Settings ─────────────────────────────────────────────────────────────────

describe('GET /api/settings', () => {
  test('owner cannot read settings', async () => {
    const res = await asUser(request(app).get('/api/settings'), USERS.owner);
    expect(res.status).toBe(403);
  });

  test('admin gets tenant + cadence + integration status, no secrets', async () => {
    process.env.LIQUIDFILES_BASE_URL = 'https://sft.howldr.com';
    process.env.LIQUIDFILES_API_KEY  = 'secret-key';
    process.env.APP_BASE_URL         = 'https://policyhub.howldr.com';
    admin.isInviteConfigured.mockReturnValue(true);
    try {
      const res = await asUser(request(app).get('/api/settings'), USERS.admin);
      expect(res.status).toBe(200);
      expect(res.body.tenant).toMatchObject({ slug: 'default', lf_share_name: 'policies' });
      expect(res.body.cadence.acceptanceReminderDays).toEqual([3, 7, 14]);
      expect(res.body.integrations.liquidFiles).toEqual({ configured: true, host: 'sft.howldr.com' });
      expect(res.body.integrations.invites.configured).toBe(true);
      // the API key itself must never appear
      expect(JSON.stringify(res.body)).not.toContain('secret-key');
    } finally {
      delete process.env.LIQUIDFILES_BASE_URL;
      delete process.env.LIQUIDFILES_API_KEY;
      delete process.env.APP_BASE_URL;
    }
  });
});

describe('PUT /api/settings (cadence)', () => {
  beforeEach(() => {
    db.updateTenantCadence.mockResolvedValue({
      ...TENANT,
      review_advance_notice_days: 20,
      review_grace_period_days:   15,
      acceptance_reminder_days:   [2, 4, 8],
      governance_lead_email:      'g@acme.example',
    });
  });

  test('admin updates cadence; reminders are deduped + sorted', async () => {
    const res = await asUser(
      request(app).put('/api/settings').send({
        reviewAdvanceNoticeDays: 20,
        reviewGracePeriodDays:   15,
        acceptanceReminderDays:  [8, 2, 4, 4],
        governanceLeadEmail:     'g@acme.example',
        execRequiredCategories:  ['Security', ' Legal ', 'Security', ''],
        ownerAcceptanceRequired: true,
      }),
      USERS.admin,
    );
    expect(res.status).toBe(200);
    expect(db.updateTenantCadence).toHaveBeenCalledWith(TENANT.id, expect.objectContaining({
      reviewAdvanceNoticeDays: 20,
      reviewGracePeriodDays:   15,
      acceptanceReminderDays:  [2, 4, 8],
      execRequiredCategories:  ['Security', 'Legal'],
      ownerAcceptanceRequired: true,
    }));
    expect(res.body.cadence.scope).toBe('workspace');
  });

  test('governance lead can read settings but not edit cadence', async () => {
    const gov = { id: 'u-gov', email: 'gov@acme.example', role: 'governance_lead', tenant_id: 1 };
    db.getAppUserById.mockImplementation(async (id) =>
      id === gov.id ? gov : Object.values(USERS).find(u => u.id === id) || null,
    );
    const res = await asUser(
      request(app).put('/api/settings').send({ reviewAdvanceNoticeDays: 20 }),
      gov,
    );
    expect(res.status).toBe(403);
    expect(db.updateTenantCadence).not.toHaveBeenCalled();
  });

  test('rejects an out-of-range advance notice', async () => {
    const res = await asUser(
      request(app).put('/api/settings').send({ reviewAdvanceNoticeDays: 999 }),
      USERS.admin,
    );
    expect(res.status).toBe(400);
    expect(db.updateTenantCadence).not.toHaveBeenCalled();
  });

  test('rejects reminder days below 1', async () => {
    const res = await asUser(
      request(app).put('/api/settings').send({ acceptanceReminderDays: [0, 7] }),
      USERS.admin,
    );
    expect(res.status).toBe(400);
  });
});

describe('workspace theme (presentation preset)', () => {
  test('GET /api/settings surfaces the theme and the preset list', async () => {
    const res = await asUser(request(app).get('/api/settings'), USERS.admin);
    expect(res.status).toBe(200);
    expect(res.body.theme).toBe('howldr'); // fixture has no theme → default
    expect(res.body.themes).toEqual(
      expect.arrayContaining(['howldr', 'slate', 'forest', 'ocean', 'burgundy']),
    );
  });

  test('GET /api/me carries the tenant theme for the app to apply at load', async () => {
    db.getTenantById.mockResolvedValue({ ...TENANT, theme: 'forest' });
    const res = await asUser(request(app).get('/api/me'), USERS.admin);
    expect(res.status).toBe(200);
    expect(res.body.tenant).toMatchObject({ slug: 'default', theme: 'forest' });
  });

  test('admin sets a preset theme; free-form values are rejected', async () => {
    db.updateTenantCadence.mockResolvedValue({ ...TENANT });
    db.updateTenantAppearance.mockResolvedValue({ ...TENANT, theme: 'ocean' });

    const bad = await asUser(
      request(app).put('/api/settings').send({ theme: 'body{background:red}' }),
      USERS.admin,
    );
    expect(bad.status).toBe(400);
    expect(db.updateTenantAppearance).not.toHaveBeenCalled();

    const res = await asUser(
      request(app).put('/api/settings').send({ theme: 'ocean' }),
      USERS.admin,
    );
    expect(res.status).toBe(200);
    expect(db.updateTenantAppearance).toHaveBeenCalledWith(
      TENANT.id,
      expect.objectContaining({ theme: 'ocean' }),
    );
    expect(res.body.theme).toBe('ocean');
  });

  test('governance lead cannot change the theme', async () => {
    const gov = { id: 'u-gov', email: 'gov@acme.example', role: 'governance_lead', tenant_id: 1 };
    db.getAppUserById.mockImplementation(async (id) =>
      id === gov.id ? gov : Object.values(USERS).find(u => u.id === id) || null,
    );
    const res = await asUser(
      request(app).put('/api/settings').send({ theme: 'slate' }),
      gov,
    );
    expect(res.status).toBe(403);
    expect(db.updateTenantAppearance).not.toHaveBeenCalled();
  });

  test('custom theme: needs an accent, accent must be #rrggbb', async () => {
    db.updateTenantCadence.mockResolvedValue({ ...TENANT });

    const noAccent = await asUser(
      request(app).put('/api/settings').send({ theme: 'custom' }),
      USERS.admin,
    );
    expect(noAccent.status).toBe(400);

    const badAccent = await asUser(
      request(app).put('/api/settings').send({ theme: 'custom', themeAccent: 'red; } body{' }),
      USERS.admin,
    );
    expect(badAccent.status).toBe(400);
    expect(db.updateTenantAppearance).not.toHaveBeenCalled();

    db.updateTenantAppearance.mockResolvedValue({ ...TENANT, theme: 'custom', theme_accent: '#2E6FA3' });
    const ok = await asUser(
      request(app).put('/api/settings').send({ theme: 'custom', themeAccent: '#2E6FA3' }),
      USERS.admin,
    );
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ theme: 'custom', themeAccent: '#2E6FA3' });
  });

  test('workspace logo: image data URLs only, size-capped, clearable', async () => {
    db.updateTenantCadence.mockResolvedValue({ ...TENANT });

    // Not a data URL / wrong type / oversized — all rejected.
    for (const bad of [
      'https://evil.example/logo.png',
      'data:text/html;base64,PHNjcmlwdD4=',
      `data:image/png;base64,${'A'.repeat(95_000)}`,
    ]) {
      const res = await asUser(
        request(app).put('/api/settings').send({ logo: bad }),
        USERS.admin,
      );
      expect(res.status).toBe(400);
    }
    expect(db.updateTenantAppearance).not.toHaveBeenCalled();

    const logo = 'data:image/png;base64,iVBORw0KGgo=';
    db.updateTenantAppearance.mockResolvedValue({ ...TENANT, logo_data_url: logo });
    const set = await asUser(
      request(app).put('/api/settings').send({ logo }),
      USERS.admin,
    );
    expect(set.status).toBe(200);
    expect(set.body.logo).toBe(logo);

    db.updateTenantAppearance.mockResolvedValue({ ...TENANT, logo_data_url: null });
    const cleared = await asUser(
      request(app).put('/api/settings').send({ logo: null }),
      USERS.admin,
    );
    expect(cleared.status).toBe(200);
    expect(cleared.body.logo).toBeNull();
    expect(db.updateTenantAppearance).toHaveBeenLastCalledWith(
      TENANT.id,
      expect.objectContaining({ logoDataUrl: null }),
    );
  });

  test('GET /api/me carries the logo and accent for the app header', async () => {
    db.getTenantById.mockResolvedValue({
      ...TENANT, theme: 'custom', theme_accent: '#2E6FA3', logo_data_url: 'data:image/png;base64,iVBORw0KGgo=',
    });
    const res = await asUser(request(app).get('/api/me'), USERS.admin);
    expect(res.status).toBe(200);
    expect(res.body.tenant).toMatchObject({
      theme: 'custom', themeAccent: '#2E6FA3', logo: 'data:image/png;base64,iVBORw0KGgo=',
    });
  });
});

describe('GET /api/tasks (my action queue)', () => {
  test('authoriser sees an approval task for an unapproved policy under review', async () => {
    db.listPolicies.mockImplementation(async (f) =>
      f.authoriserEmail ? [{ ...BASE_POLICY, status: 'UNDER_REVIEW' }] : [],
    );
    db.getAuthorisers.mockResolvedValue([
      { email: USERS.authoriser.email, approved_at: null },
    ]);
    const res = await asUser(request(app).get('/api/tasks'), USERS.authoriser);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.tasks[0]).toMatchObject({ kind: 'approve', policy_id: 'POL-2026-001' });
  });

  test('an already-approved authoriser has no approval task', async () => {
    db.listPolicies.mockImplementation(async (f) =>
      f.authoriserEmail ? [{ ...BASE_POLICY, status: 'UNDER_REVIEW' }] : [],
    );
    db.getAuthorisers.mockResolvedValue([
      { email: USERS.authoriser.email, approved_at: '2026-06-01T00:00:00Z' },
    ]);
    const res = await asUser(request(app).get('/api/tasks'), USERS.authoriser);
    expect(res.body.count).toBe(0);
  });

  test('owner tasks are sorted by urgency (distribute, review, draft)', async () => {
    const owned = [
      { ...BASE_POLICY, policy_id: 'POL-A', status: 'PENDING_ACCEPTANCE' },
      { ...BASE_POLICY, policy_id: 'POL-B', status: 'ACTIVE', next_review_date: '2000-01-01' },
      { ...BASE_POLICY, policy_id: 'POL-C', status: 'DRAFT' },
    ];
    db.listPolicies.mockImplementation(async (f) => (f.owner ? owned : []));
    db.getAuthorisers.mockResolvedValue([]);
    const res = await asUser(request(app).get('/api/tasks'), USERS.owner);
    expect(res.status).toBe(200);
    expect(res.body.tasks.map(t => t.kind)).toEqual(['distribute', 'review', 'draft']);
  });

  test('a returned draft becomes a revise task', async () => {
    db.listPolicies.mockImplementation(async (f) =>
      f.owner ? [{ ...BASE_POLICY, status: 'DRAFT' }] : [],
    );
    db.getAuthorisers.mockResolvedValue([
      { email: USERS.authoriser.email, returned_at: '2026-06-01T00:00:00Z' },
    ]);
    const res = await asUser(request(app).get('/api/tasks'), USERS.owner);
    expect(res.body.tasks[0].kind).toBe('revise');
  });
});

// ─── Evidence Locker ──────────────────────────────────────────────────────────

describe('Evidence Locker', () => {
  const crypto = require('crypto');
  const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

  // supertest doesn't buffer application/zip — collect it manually.
  const asBinary = (req) => req.buffer(true).parse((res2, cb) => {
    const chunks = [];
    res2.on('data', (c) => chunks.push(c));
    res2.on('end', () => cb(null, Buffer.concat(chunks)));
  });

  const BASE_ITEM = {
    tenant_id: 1,
    evidence_id: 'EVD-2026-001',
    title: 'Q2 access review',
    description: null,
    category: 'Access Control',
    tags: ['quarterly'],
    control_label: 'ISO 27001 A.9.2',
    owner_email: USERS.owner.email,
    collected_at: '2026-06-30',
    expires_at: '2026-09-30',
    locator: null,
    lf_file_id: null,
    lf_folder_id: null,
    file_name: null,
    file_size: null,
    checksum: null,
    status: 'ACTIVE',
    superseded_by: null,
    created_by: USERS.admin.email,
    created_at: '2026-07-06T00:00:00Z',
  };

  beforeEach(() => {
    TENANT.entitlements = ['policy_hub', 'evidence_locker'];
    db.allocateEvidenceId.mockResolvedValue('EVD-2026-002');
    db.createEvidenceItem.mockImplementation(async (data) => ({ ...BASE_ITEM, ...data }));
    db.getEvidenceById.mockResolvedValue({ ...BASE_ITEM });
    db.listEvidence.mockResolvedValue([{ ...BASE_ITEM }]);
    db.updateEvidenceItem.mockImplementation(async (_t, id, updates) => ({ ...BASE_ITEM, evidence_id: id, ...updates }));
    db.logEvidenceEvent.mockResolvedValue();
    db.getEvidenceEvents.mockResolvedValue([]);
    db.listApprovalReceipts.mockResolvedValue([]);
    lf.getRootFolderId.mockResolvedValue('share-root');
    lf.createFolder.mockImplementation(async (_s, name) => ({ id: `f-${name}` }));
  });

  test('module gate: a workspace without evidence_locker is blocked', async () => {
    TENANT.entitlements = ['policy_hub'];
    const res = await asUser(request(app).get('/api/evidence'), USERS.admin);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'module_not_enabled', module: 'evidence_locker' });
  });

  test('any tenant member can list; strength is derived', async () => {
    const res = await asUser(request(app).get('/api/evidence'), USERS.viewer);
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ evidence_id: 'EVD-2026-001', strength: 'declared' });
  });

  test('viewer cannot register evidence', async () => {
    const res = await asUser(
      request(app).post('/api/evidence').send({ title: 'x' }), USERS.viewer);
    expect(res.status).toBe(403);
    expect(db.createEvidenceItem).not.toHaveBeenCalled();
  });

  test('governance lead registers a declared item; event logged', async () => {
    const gov = { id: 'u-gov2', email: 'gov2@acme.example', role: 'governance_lead', tenant_id: 1 };
    db.getAppUserById.mockImplementation(async (id) =>
      id === gov.id ? gov : Object.values(USERS).find(u => u.id === id) || null);
    const res = await asUser(
      request(app).post('/api/evidence').send({
        title: '  Pen test 2026  ',
        category: 'Security Testing',
        tags: ['annual', 'annual', ' external '],
        locator: 'Vendor portal > reports > 2026',
        expiresAt: '2027-06-01',
      }),
      gov,
    );
    expect(res.status).toBe(201);
    expect(db.createEvidenceItem).toHaveBeenCalledWith(expect.objectContaining({
      evidence_id: 'EVD-2026-002',
      title: 'Pen test 2026',
      tags: ['annual', 'external'],
      owner_email: gov.email,           // defaults to the creator
      created_by: gov.email,
    }));
    expect(res.body.strength).toBe('declared');
    expect(db.logEvidenceEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: 'Evidence registered', actorEmail: gov.email,
    }));
  });

  test('registering with an externally computed checksum → fingerprinted', async () => {
    const hex = 'a'.repeat(64);
    const res = await asUser(
      request(app).post('/api/evidence').send({ title: 'SOC 2', checksum: hex.toUpperCase() }),
      USERS.admin,
    );
    expect(res.status).toBe(201);
    expect(db.createEvidenceItem).toHaveBeenCalledWith(expect.objectContaining({ checksum: hex }));
    expect(res.body.strength).toBe('fingerprinted');
  });

  test('a malformed checksum is rejected', async () => {
    const res = await asUser(
      request(app).post('/api/evidence').send({ title: 'SOC 2', checksum: 'not-a-hash' }),
      USERS.admin,
    );
    expect(res.status).toBe(400);
  });

  test('an owner-role user cannot edit an item they do not own', async () => {
    db.getEvidenceById.mockResolvedValue({ ...BASE_ITEM, owner_email: 'someone-else@acme.example' });
    const res = await asUser(
      request(app).put('/api/evidence/EVD-2026-001').send({ title: 'New title' }),
      USERS.owner,
    );
    expect(res.status).toBe(403);
    expect(db.updateEvidenceItem).not.toHaveBeenCalled();
  });

  test('an owner-role user edits their own item', async () => {
    const res = await asUser(
      request(app).put('/api/evidence/EVD-2026-001').send({ title: 'Q2 access review (final)' }),
      USERS.owner,
    );
    expect(res.status).toBe(200);
    expect(db.updateEvidenceItem).toHaveBeenCalledWith(TENANT.id, 'EVD-2026-001',
      expect.objectContaining({ title: 'Q2 access review (final)' }));
  });

  test('file upload stores to the share, pins the SHA-256, and becomes held', async () => {
    const bytes = Buffer.from('evidence document bytes');
    const res = await asUser(
      request(app)
        .post('/api/evidence/EVD-2026-001/file?filename=review.pdf')
        .set('Content-Type', 'application/octet-stream')
        .send(bytes),
      USERS.admin,
    );
    expect(res.status).toBe(201);
    // evidence/<id>/ folder chain created idempotently
    expect(lf.createFolder).toHaveBeenCalledWith(TENANT.lf_share_name, 'evidence', 'share-root');
    expect(lf.createFolder).toHaveBeenCalledWith(TENANT.lf_share_name, 'EVD-2026-001', 'f-evidence');
    expect(lf.uploadFileToFolder).toHaveBeenCalledWith(
      TENANT.lf_share_name, 'f-EVD-2026-001', 'review.pdf', expect.any(Buffer), 'application/pdf');
    expect(db.updateEvidenceItem).toHaveBeenCalledWith(TENANT.id, 'EVD-2026-001',
      expect.objectContaining({ checksum: sha256(bytes), file_name: 'review.pdf' }));
    expect(res.body.strength).toBe('held');
  });

  test('unsupported file extension → 400', async () => {
    const res = await asUser(
      request(app)
        .post('/api/evidence/EVD-2026-001/file?filename=malware.exe')
        .set('Content-Type', 'application/octet-stream')
        .send(Buffer.from('x')),
      USERS.admin,
    );
    expect(res.status).toBe(400);
    expect(lf.uploadFileToFolder).not.toHaveBeenCalled();
  });

  test('fingerprint hashes and discards — nothing touches the share', async () => {
    const bytes = Buffer.from('vendor soc2 report');
    const res = await asUser(
      request(app)
        .post('/api/evidence/EVD-2026-001/fingerprint?filename=soc2.pdf')
        .set('Content-Type', 'application/octet-stream')
        .send(bytes),
      USERS.admin,
    );
    expect(res.status).toBe(200);
    expect(lf.uploadFileToFolder).not.toHaveBeenCalled();
    expect(lf.createFolder).not.toHaveBeenCalled();
    expect(db.updateEvidenceItem).toHaveBeenCalledWith(TENANT.id, 'EVD-2026-001',
      expect.objectContaining({ checksum: sha256(bytes), file_name: 'soc2.pdf' }));
    expect(res.body.strength).toBe('fingerprinted');
  });

  test('fingerprinting a held item is rejected', async () => {
    db.getEvidenceById.mockResolvedValue({ ...BASE_ITEM, lf_file_id: 'lf-1', checksum: 'c'.repeat(64) });
    const res = await asUser(
      request(app)
        .post('/api/evidence/EVD-2026-001/fingerprint')
        .set('Content-Type', 'application/octet-stream')
        .send(Buffer.from('x')),
      USERS.admin,
    );
    expect(res.status).toBe(400);
  });

  test('verify: matching bytes append a match event', async () => {
    const bytes = Buffer.from('the attested artifact');
    db.getEvidenceById.mockResolvedValue({ ...BASE_ITEM, checksum: sha256(bytes) });
    const res = await asUser(
      request(app)
        .post('/api/evidence/EVD-2026-001/verify')
        .set('Content-Type', 'application/octet-stream')
        .send(bytes),
      USERS.admin,
    );
    expect(res.status).toBe(200);
    expect(res.body.match).toBe(true);
    expect(db.logEvidenceEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.stringContaining('Verified'),
    }));
  });

  test('verify: different bytes append a FAILED event and report both hashes', async () => {
    const recorded = sha256(Buffer.from('original'));
    db.getEvidenceById.mockResolvedValue({ ...BASE_ITEM, checksum: recorded });
    const res = await asUser(
      request(app)
        .post('/api/evidence/EVD-2026-001/verify')
        .set('Content-Type', 'application/octet-stream')
        .send(Buffer.from('tampered')),
      USERS.admin,
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ match: false, expected: recorded });
    expect(db.logEvidenceEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.stringContaining('FAILED'),
    }));
  });

  test('verify by digest: an externally computed hash matches without sending bytes', async () => {
    const recorded = sha256(Buffer.from('table extract'));
    db.getEvidenceById.mockResolvedValue({ ...BASE_ITEM, checksum: recorded });
    const res = await asUser(
      request(app)
        .post('/api/evidence/EVD-2026-001/verify')
        .set('Content-Type', 'application/json')
        .send({ digest: recorded.toUpperCase() }),   // case-insensitive
      USERS.admin,
    );
    expect(res.status).toBe(200);
    expect(res.body.match).toBe(true);
    expect(db.logEvidenceEvent).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ method: 'digest' }),
    }));
  });

  test('verify by digest: a differing hash appends a FAILED event', async () => {
    db.getEvidenceById.mockResolvedValue({ ...BASE_ITEM, checksum: 'a'.repeat(64) });
    const res = await asUser(
      request(app)
        .post('/api/evidence/EVD-2026-001/verify')
        .set('Content-Type', 'application/json')
        .send({ digest: 'b'.repeat(64) }),
      USERS.admin,
    );
    expect(res.status).toBe(200);
    expect(res.body.match).toBe(false);
    expect(db.logEvidenceEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.stringContaining('FAILED'),
    }));
  });

  test('verify by digest: a malformed digest is rejected without a receipt', async () => {
    db.getEvidenceById.mockResolvedValue({ ...BASE_ITEM, checksum: 'a'.repeat(64) });
    const res = await asUser(
      request(app)
        .post('/api/evidence/EVD-2026-001/verify')
        .set('Content-Type', 'application/json')
        .send({ digest: 'not-a-hash' }),
      USERS.admin,
    );
    expect(res.status).toBe(400);
    expect(db.logEvidenceEvent).not.toHaveBeenCalled();
  });

  test('retire validates the superseding item and records it', async () => {
    db.getEvidenceById
      .mockResolvedValueOnce({ ...BASE_ITEM })                                  // the item
      .mockResolvedValueOnce({ ...BASE_ITEM, evidence_id: 'EVD-2026-009' });    // the successor
    const res = await asUser(
      request(app).post('/api/evidence/EVD-2026-001/retire').send({ supersededBy: 'EVD-2026-009' }),
      USERS.admin,
    );
    expect(res.status).toBe(200);
    expect(db.updateEvidenceItem).toHaveBeenCalledWith(TENANT.id, 'EVD-2026-001', {
      status: 'RETIRED', superseded_by: 'EVD-2026-009',
    });
  });

  test('evidence pack: zip with manifest, register, receipts, and verified files', async () => {
    const bytes = Buffer.from('held evidence file bytes');
    db.listEvidence.mockResolvedValue([
      { ...BASE_ITEM, lf_file_id: 'lf-9', lf_folder_id: 'f-1', file_name: 'review.pdf', checksum: sha256(bytes) },
      { ...BASE_ITEM, evidence_id: 'EVD-2026-003', title: 'SOC 2 attestation', checksum: 'b'.repeat(64) },
    ]);
    lf.downloadFile.mockResolvedValue({ buffer: bytes, contentType: 'application/pdf' });
    db.listApprovalReceipts.mockResolvedValue([{
      policy_id: 'POL-2026-001', title: 'AUP', tier: 'authoriser', stage_position: 1,
      authoriser_email: USERS.authoriser.email, decision: 'approved', version: 'v1.3',
      content_hash: 'e'.repeat(64), created_at: '2026-07-01T00:00:00Z',
    }]);

    const res = await asBinary(asUser(request(app).get('/api/evidence/pack'), USERS.viewer));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toMatch(/audit-pack-default-\d{4}-\d{2}-\d{2}\.zip/);

    const body = res.body;
    // store-only zip → entry contents are literally present in the buffer
    expect(body.subarray(0, 4).toString('latin1')).toBe('PK\x03\x04');
    const text = body.toString('latin1');
    expect(text).toContain('manifest.json');
    expect(text).toContain('evidence.csv');
    expect(text).toContain('policy-register.csv');
    expect(text).toContain('policy-receipts.csv');
    expect(text).toContain('audit-events.csv');
    expect(text).toContain('files/EVD-2026-001-review.pdf');
    expect(text).toContain('"pack_note": "verified"');
    expect(text).toContain('SOC 2 attestation');
    expect(text).toContain('held evidence file bytes');
    // risk_register is NOT entitled in this block → no risk files in the pack
    expect(text).not.toContain('risk-register.csv');
    expect(db.listRisks).not.toHaveBeenCalled();
  });

  test('evidence pack: a failed file fetch is noted, not fatal', async () => {
    db.listEvidence.mockResolvedValue([
      { ...BASE_ITEM, lf_file_id: 'lf-9', lf_folder_id: 'f-1', file_name: 'review.pdf', checksum: 'a'.repeat(64) },
    ]);
    lf.downloadFile.mockRejectedValue(new Error('appliance down'));
    const res = await asBinary(asUser(request(app).get('/api/evidence/pack'), USERS.admin));
    expect(res.status).toBe(200);
    expect(res.body.toString('latin1')).toContain('file unavailable');
  });

  test('the pack requires a read-oversight role', async () => {
    const res = await asUser(request(app).get('/api/evidence/pack'), USERS.authoriser);
    expect(res.status).toBe(403);
  });
});

// ─── Risk Register ────────────────────────────────────────────────────────────

describe('Risk Register', () => {
  const BASE_RISK = {
    tenant_id: 1,
    risk_id: 'RSK-2026-001',
    title: 'Unpatched public-facing servers',
    description: null,
    category: 'Technology',
    tags: [],
    owner_email: USERS.owner.email,
    acceptor_email: null,
    next_review_date: '2026-12-31',
    policy_ids: [],
    evidence_ids: [],
    status: 'OPEN',
    created_by: USERS.admin.email,
    created_at: '2026-07-06T00:00:00Z',
  };

  const ASSESSMENT = {
    id: 1, tenant_id: 1, risk_id: 'RSK-2026-001', round: 1,
    inherent_likelihood: 4, inherent_impact: 5,
    residual_likelihood: 2, residual_impact: 4,
    treatment: 'mitigate', treatment_notes: 'Monthly patch cycle + WAF',
    assessed_by: USERS.owner.email, created_at: '2026-07-06T01:00:00Z',
  };

  beforeEach(() => {
    TENANT.entitlements = ['policy_hub', 'risk_register'];
    db.allocateRiskId.mockResolvedValue('RSK-2026-002');
    db.createRisk.mockImplementation(async (data) => ({ ...BASE_RISK, ...data }));
    db.getRiskById.mockResolvedValue({ ...BASE_RISK });
    db.listRisks.mockResolvedValue([]);
    db.updateRisk.mockImplementation(async (_t, id, updates) => ({ ...BASE_RISK, risk_id: id, ...updates }));
    db.addRiskAssessment.mockImplementation(async (_t, a) => ({ ...ASSESSMENT, ...a, round: 1 }));
    db.getRiskAssessments.mockResolvedValue([]);
    db.addRiskAcceptance.mockImplementation(async (_t, a) => ({ id: 9, ...a, created_at: '2026-07-06T02:00:00Z' }));
    db.getRiskAcceptances.mockResolvedValue([]);
    db.logRiskEvent.mockResolvedValue();
    db.getRiskEvents.mockResolvedValue([]);
  });

  test('module gate: a workspace without risk_register is blocked', async () => {
    TENANT.entitlements = ['policy_hub', 'evidence_locker'];
    const res = await asUser(request(app).get('/api/risks'), USERS.admin);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'module_not_enabled', module: 'risk_register' });
  });

  test('list derives scores, bands, and acceptance state', async () => {
    db.listRisks.mockResolvedValue([
      { ...BASE_RISK, round: 1, inherent_likelihood: 4, inherent_impact: 5,
        residual_likelihood: 2, residual_impact: 4, treatment: 'mitigate', accepted: false },
      { ...BASE_RISK, risk_id: 'RSK-2026-002', round: 2, inherent_likelihood: 3, inherent_impact: 3,
        residual_likelihood: 1, residual_impact: 3, treatment: 'accept', accepted: true },
      { ...BASE_RISK, risk_id: 'RSK-2026-003', round: null, accepted: false },
    ]);
    const res = await asUser(request(app).get('/api/risks'), USERS.viewer);
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({
      inherent_score: 20, inherent_band: 'Critical',
      residual_score: 8,  residual_band: 'Medium',
      acceptance_state: 'awaiting_acceptance',
    });
    expect(res.body[1]).toMatchObject({ residual_score: 3, residual_band: 'Low', acceptance_state: 'accepted' });
    expect(res.body[2]).toMatchObject({ acceptance_state: 'not_assessed', residual_score: null });
  });

  test('viewer cannot register a risk', async () => {
    const res = await asUser(request(app).post('/api/risks').send({ title: 'x' }), USERS.viewer);
    expect(res.status).toBe(403);
    expect(db.createRisk).not.toHaveBeenCalled();
  });

  test('create defaults the owner to the creator and logs the event', async () => {
    const res = await asUser(
      request(app).post('/api/risks').send({
        title: '  Supplier concentration  ',
        category: 'Third Party',
        acceptor: 'MD@acme.example',
        nextReviewDate: '2026-12-01',
        policyIds: ['POL-2026-001', 'POL-2026-001'],
      }),
      USERS.admin,
    );
    expect(res.status).toBe(201);
    expect(db.createRisk).toHaveBeenCalledWith(expect.objectContaining({
      risk_id: 'RSK-2026-002',
      title: 'Supplier concentration',
      owner_email: USERS.admin.email,
      acceptor_email: 'md@acme.example',
      policy_ids: ['POL-2026-001'],           // deduped
    }));
    expect(db.logRiskEvent).toHaveBeenCalledWith(expect.objectContaining({ event: 'Risk registered' }));
    expect(res.body.acceptance_state).toBe('not_assessed');
  });

  test('an owner-role user cannot edit a risk they do not own', async () => {
    db.getRiskById.mockResolvedValue({ ...BASE_RISK, owner_email: 'someone-else@acme.example' });
    const res = await asUser(
      request(app).put('/api/risks/RSK-2026-001').send({ title: 'New' }), USERS.owner);
    expect(res.status).toBe(403);
  });

  test('assessment validates the 5×5 bounds and treatment', async () => {
    const bad1 = await asUser(
      request(app).post('/api/risks/RSK-2026-001/assess').send({
        inherentLikelihood: 6, inherentImpact: 5, residualLikelihood: 2, residualImpact: 4, treatment: 'mitigate',
      }),
      USERS.owner,
    );
    expect(bad1.status).toBe(400);
    const bad2 = await asUser(
      request(app).post('/api/risks/RSK-2026-001/assess').send({
        inherentLikelihood: 4, inherentImpact: 5, residualLikelihood: 2, residualImpact: 4, treatment: 'ignore',
      }),
      USERS.owner,
    );
    expect(bad2.status).toBe(400);
    expect(db.addRiskAssessment).not.toHaveBeenCalled();
  });

  test('the owner assesses: a new append-only round with derived bands', async () => {
    const res = await asUser(
      request(app).post('/api/risks/RSK-2026-001/assess').send({
        inherentLikelihood: 4, inherentImpact: 5,
        residualLikelihood: 2, residualImpact: 4,
        treatment: 'mitigate', treatmentNotes: 'Monthly patch cycle + WAF',
      }),
      USERS.owner,
    );
    expect(res.status).toBe(201);
    expect(db.addRiskAssessment).toHaveBeenCalledWith(TENANT.id, expect.objectContaining({
      riskId: 'RSK-2026-001', treatment: 'mitigate', assessedBy: USERS.owner.email,
    }));
    expect(res.body).toMatchObject({
      inherent_score: 20, inherent_band: 'Critical',
      residual_score: 8,  residual_band: 'Medium',
      acceptance_state: 'awaiting_acceptance',
    });
  });

  test('accept requires an assessment first', async () => {
    const res = await asUser(request(app).post('/api/risks/RSK-2026-001/accept'), USERS.owner);
    expect(res.status).toBe(400);
    expect(db.addRiskAcceptance).not.toHaveBeenCalled();
  });

  test('only the effective acceptor may accept (acceptor falls back to owner)', async () => {
    db.getRiskAssessments.mockResolvedValue([ASSESSMENT]);
    // authoriser is neither manager, owner, nor named acceptor
    const res = await asUser(request(app).post('/api/risks/RSK-2026-001/accept'), USERS.authoriser);
    expect(res.status).toBe(403);
  });

  test('the acceptor accepts the latest round — receipt pinned to it', async () => {
    db.getRiskById.mockResolvedValue({ ...BASE_RISK, acceptor_email: USERS.exec.email });
    db.getRiskAssessments.mockResolvedValue([ASSESSMENT]);
    const res = await asUser(
      request(app).post('/api/risks/RSK-2026-001/accept').send({ notes: 'Accepted for FY26' }),
      USERS.exec,
    );
    expect(res.status).toBe(201);
    expect(db.addRiskAcceptance).toHaveBeenCalledWith(TENANT.id, expect.objectContaining({
      riskId: 'RSK-2026-001', round: 1, acceptorEmail: USERS.exec.email, notes: 'Accepted for FY26',
    }));
    expect(res.body).toMatchObject({ residual_score: 8, residual_band: 'Medium' });
    expect(db.logRiskEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.stringContaining('Residual risk accepted'),
    }));
  });

  test('a round cannot be accepted twice', async () => {
    db.getRiskAssessments.mockResolvedValue([ASSESSMENT]);
    db.getRiskAcceptances.mockResolvedValue([{ id: 1, round: 1, acceptor_email: USERS.owner.email }]);
    const res = await asUser(request(app).post('/api/risks/RSK-2026-001/accept'), USERS.owner);
    expect(res.status).toBe(400);
    expect(db.addRiskAcceptance).not.toHaveBeenCalled();
  });

  test('a re-assessment strips acceptance: detail derives awaiting_acceptance', async () => {
    db.getRiskAssessments.mockResolvedValue([
      ASSESSMENT,
      { ...ASSESSMENT, id: 2, round: 2, residual_likelihood: 3 },
    ]);
    // acceptance covers round 1 only
    db.getRiskAcceptances.mockResolvedValue([{ id: 1, round: 1, acceptor_email: USERS.owner.email }]);
    const res = await asUser(request(app).get('/api/risks/RSK-2026-001'), USERS.viewer);
    expect(res.status).toBe(200);
    expect(res.body.round).toBe(2);
    expect(res.body.acceptance_state).toBe('awaiting_acceptance');
    expect(res.body.assessments).toHaveLength(2);
    expect(res.body.effective_acceptor).toBe(USERS.owner.email);
  });

  test('close and reopen append events; assessing a closed risk is rejected', async () => {
    const closed = await asUser(request(app).post('/api/risks/RSK-2026-001/close').send({ reason: 'Decommissioned' }), USERS.admin);
    expect(closed.status).toBe(200);
    expect(db.updateRisk).toHaveBeenCalledWith(TENANT.id, 'RSK-2026-001', { status: 'CLOSED' });

    db.getRiskById.mockResolvedValue({ ...BASE_RISK, status: 'CLOSED' });
    const assess = await asUser(
      request(app).post('/api/risks/RSK-2026-001/assess').send({
        inherentLikelihood: 1, inherentImpact: 1, residualLikelihood: 1, residualImpact: 1, treatment: 'accept',
      }),
      USERS.admin,
    );
    expect(assess.status).toBe(400);

    const reopened = await asUser(request(app).post('/api/risks/RSK-2026-001/reopen'), USERS.admin);
    expect(reopened.status).toBe(200);
    expect(db.updateRisk).toHaveBeenCalledWith(TENANT.id, 'RSK-2026-001', { status: 'OPEN' });
  });
});

// ─── CORS ─────────────────────────────────────────────────────────────────────

describe('CORS', () => {
  test('reflects the origin and answers preflight when no allowlist is set', async () => {
    const res = await request(app)
      .options('/api/policies')
      .set('Origin', 'https://app.example.com')
      .set('Access-Control-Request-Method', 'GET');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('https://app.example.com');
    expect(res.headers['access-control-allow-headers']).toMatch(/Authorization/);
  });

  test('honours a CORS_ORIGINS allowlist', async () => {
    process.env.CORS_ORIGINS = 'https://app.example.com';
    const restricted = createApp();
    try {
      const ok = await request(restricted).get('/health').set('Origin', 'https://app.example.com');
      expect(ok.headers['access-control-allow-origin']).toBe('https://app.example.com');

      const blocked = await request(restricted).get('/health').set('Origin', 'https://evil.example.com');
      expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      delete process.env.CORS_ORIGINS;
    }
  });
});

// ─── Risk ↔ policy ↔ evidence links ───────────────────────────────────────────

describe('risk/policy/evidence links', () => {
  const LINKED_RISK = {
    risk_id: 'RSK-2026-001', title: 'Unpatched servers', status: 'OPEN',
    category: 'Technology', owner_email: USERS.owner.email,
    round: 1, residual_likelihood: 2, residual_impact: 3, accepted: false,
  };

  beforeEach(() => {
    TENANT.entitlements = ['policy_hub', 'evidence_locker', 'risk_register'];
    db.allocateRiskId.mockResolvedValue('RSK-2026-009');
    db.createRisk.mockImplementation(async (data) => ({ ...data, id: 1, status: 'OPEN' }));
    db.getRiskById.mockResolvedValue({
      id: 1, tenant_id: 1, risk_id: 'RSK-2026-001', title: 'Unpatched servers',
      owner_email: USERS.owner.email, acceptor_email: null, status: 'OPEN',
      policy_ids: [], evidence_ids: [],
    });
    db.updateRisk.mockImplementation(async (_t, id, updates) => ({ risk_id: id, ...updates }));
    db.logRiskEvent.mockResolvedValue();
  });

  test('creating a risk with an unknown policy id is rejected and names it', async () => {
    db.filterExistingPolicyIds.mockResolvedValue(['POL-2026-001']);
    const res = await asUser(
      request(app).post('/api/risks').send({
        title: 'Supplier risk',
        policyIds: ['POL-2026-001', 'POL-2026-999'],
      }),
      USERS.admin,
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unknown policy id\(s\): POL-2026-999/);
    expect(db.createRisk).not.toHaveBeenCalled();
  });

  test('editing a risk with an unknown evidence id is rejected', async () => {
    db.filterExistingEvidenceIds.mockResolvedValue([]);
    const res = await asUser(
      request(app).put('/api/risks/RSK-2026-001').send({ evidenceIds: ['EVD-2026-404'] }),
      USERS.admin,
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unknown evidence id\(s\): EVD-2026-404/);
    expect(db.updateRisk).not.toHaveBeenCalled();
  });

  test('valid links pass validation and are stored', async () => {
    db.filterExistingPolicyIds.mockResolvedValue(['POL-2026-001']);
    db.filterExistingEvidenceIds.mockResolvedValue(['EVD-2026-002']);
    const res = await asUser(
      request(app).put('/api/risks/RSK-2026-001').send({
        policyIds: ['POL-2026-001'], evidenceIds: ['EVD-2026-002'],
      }),
      USERS.admin,
    );
    expect(res.status).toBe(200);
    expect(db.updateRisk).toHaveBeenCalledWith(1, 'RSK-2026-001', expect.objectContaining({
      policy_ids: ['POL-2026-001'], evidence_ids: ['EVD-2026-002'],
    }));
  });

  test('policy detail includes the risks that cite it', async () => {
    db.getRisksLinkedToPolicy.mockResolvedValue([LINKED_RISK]);
    const res = await asUser(request(app).get('/api/policies/POL-2026-001'), USERS.admin);
    expect(res.status).toBe(200);
    expect(db.getRisksLinkedToPolicy).toHaveBeenCalledWith(1, 'POL-2026-001');
    expect(res.body.linkedRisks).toEqual([LINKED_RISK]);
  });

  test('evidence detail includes the risks that cite it', async () => {
    db.getEvidenceById.mockResolvedValue({
      id: 1, tenant_id: 1, evidence_id: 'EVD-2026-002', title: 'Patch report',
      owner_email: USERS.owner.email, status: 'ACTIVE', checksum: null, lf_file_id: null,
    });
    db.getEvidenceEvents.mockResolvedValue([]);
    db.getRisksLinkedToEvidence.mockResolvedValue([LINKED_RISK]);
    const res = await asUser(request(app).get('/api/evidence/EVD-2026-002'), USERS.admin);
    expect(res.status).toBe(200);
    expect(db.getRisksLinkedToEvidence).toHaveBeenCalledWith(1, 'EVD-2026-002');
    expect(res.body.linked_risks).toEqual([LINKED_RISK]);
  });
});

// ─── Suite dashboard ──────────────────────────────────────────────────────────

describe('GET /api/dashboard', () => {
  const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

  beforeEach(() => {
    db.countOutstandingAcceptances.mockResolvedValue(3);
    db.listEvidence.mockResolvedValue([]);
    db.listRisks.mockResolvedValue([]);
    db.getAuditEvents.mockResolvedValue([]);
  });

  test('sections follow the workspace entitlements', async () => {
    TENANT.entitlements = ['policy_hub'];
    const res = await asUser(request(app).get('/api/dashboard'), USERS.admin);
    expect(res.status).toBe(200);
    expect(res.body.policies).toBeDefined();
    expect(res.body.evidence).toBeUndefined();
    expect(res.body.risks).toBeUndefined();
    expect(db.listEvidence).not.toHaveBeenCalled();
    expect(db.listRisks).not.toHaveBeenCalled();
  });

  test('aggregates policy, evidence, and risk attention when fully entitled', async () => {
    TENANT.entitlements = ['policy_hub', 'evidence_locker', 'risk_register'];
    db.listPolicies.mockResolvedValue([
      { ...BASE_POLICY, status: 'ACTIVE', next_review_date: day(-2) },     // overdue
      { ...BASE_POLICY, policy_id: 'POL-2026-002', status: 'UNDER_REVIEW', next_review_date: day(10) },
      { ...BASE_POLICY, policy_id: 'POL-2026-003', status: 'RETIRED' },    // excluded
    ]);
    db.listEvidence.mockResolvedValue([
      { evidence_id: 'EVD-2026-001', title: 'Expired cert', status: 'ACTIVE', expires_at: day(-1) },
      { evidence_id: 'EVD-2026-002', title: 'Fresh report', status: 'ACTIVE', expires_at: day(10) },
      { evidence_id: 'EVD-2026-003', title: 'No expiry',   status: 'ACTIVE', expires_at: null },
    ]);
    db.listRisks.mockResolvedValue([
      { risk_id: 'RSK-2026-001', title: 'Unaccepted', status: 'OPEN',
        round: 1, residual_likelihood: 3, residual_impact: 4, accepted: false, next_review_date: null },
      { risk_id: 'RSK-2026-002', title: 'Accepted', status: 'OPEN',
        round: 2, residual_likelihood: 1, residual_impact: 2, accepted: true, next_review_date: day(-5) },
      { risk_id: 'RSK-2026-003', title: 'Never assessed', status: 'OPEN',
        round: null, accepted: false, next_review_date: null },
    ]);
    const res = await asUser(request(app).get('/api/dashboard'), USERS.admin);
    expect(res.status).toBe(200);
    expect(res.body.policies).toMatchObject({
      total: 2, active: 1, in_authorisation: 1,
      review_overdue: 1, review_due_30d: 1,
      outstanding_acknowledgements: 3,
    });
    expect(res.body.evidence).toMatchObject({ active: 3, expired: 1, expiring_30d: 1 });
    expect(res.body.evidence.attention[0]).toMatchObject({ evidence_id: 'EVD-2026-001', expired: true });
    expect(res.body.risks).toMatchObject({
      open: 3, awaiting_acceptance: 1, not_assessed: 1, review_overdue: 1,
    });
    expect(res.body.risks.attention[0]).toMatchObject({
      risk_id: 'RSK-2026-001', residual_score: 12, residual_band: 'High',
    });
  });

  test('recent_events is present for audit-grade roles and absent otherwise', async () => {
    TENANT.entitlements = ['policy_hub'];
    db.getAuditEvents.mockResolvedValue([{ id: 1, action: 'created', object_type: 'policy', object_id: 'POL-2026-001' }]);
    const admin = await asUser(request(app).get('/api/dashboard'), USERS.admin);
    expect(admin.body.recent_events).toHaveLength(1);
    const owner = await asUser(request(app).get('/api/dashboard'), USERS.owner);
    expect(owner.status).toBe(200);
    expect(owner.body.recent_events).toBeUndefined();
  });
});

// ─── Audit pack (risk + spine extensions) ─────────────────────────────────────

describe('audit pack extensions', () => {
  const spine = require('../src/audit/spine');

  const asBinary = (req) => req.buffer(true).parse((res2, cb) => {
    const chunks = [];
    res2.on('data', (c) => chunks.push(c));
    res2.on('end', () => cb(null, Buffer.concat(chunks)));
  });

  function chainRows(events) {
    const rows = [];
    let prev = spine.GENESIS;
    events.forEach((e, i) => {
      const ev = {
        tenantId: 1, occurredAt: `2026-07-08T10:0${i}:00.000Z`, actorEmail: e.actor ?? null,
        action: e.action, objectType: e.type, objectId: e.id, metadata: e.metadata ?? null,
      };
      const hash = spine.computeEventHash(prev, ev);
      rows.push({
        id: i + 1, tenant_id: 1, occurred_at: ev.occurredAt, actor_email: ev.actorEmail,
        action: ev.action, object_type: ev.objectType, object_id: ev.objectId,
        metadata: ev.metadata, prev_hash: prev, event_hash: hash,
      });
      prev = hash;
    });
    return rows;
  }

  beforeEach(() => {
    TENANT.entitlements = ['policy_hub', 'evidence_locker', 'risk_register'];
    db.listEvidence.mockResolvedValue([]);
    db.listApprovalReceipts.mockResolvedValue([]);
  });

  test('with risk_register enabled, the pack carries the register, rounds, and receipts', async () => {
    db.listRisks.mockResolvedValue([{
      risk_id: 'RSK-2026-001', title: 'Unpatched servers', category: 'Technology',
      owner_email: USERS.owner.email, acceptor_email: 'ceo@acme.example', status: 'OPEN',
      round: 1, inherent_likelihood: 4, inherent_impact: 5,
      residual_likelihood: 2, residual_impact: 3, treatment: 'mitigate', accepted: true,
      next_review_date: '2026-12-31', policy_ids: ['POL-2026-001'], evidence_ids: [],
      created_by: USERS.admin.email, created_at: '2026-07-01T00:00:00Z',
    }]);
    db.listRiskAssessments.mockResolvedValue([{
      risk_id: 'RSK-2026-001', title: 'Unpatched servers', round: 1,
      inherent_likelihood: 4, inherent_impact: 5, residual_likelihood: 2, residual_impact: 3,
      treatment: 'mitigate', treatment_notes: 'Patch cycle', assessed_by: USERS.owner.email,
      created_at: '2026-07-01T01:00:00Z',
    }]);
    db.listRiskAcceptances.mockResolvedValue([{
      risk_id: 'RSK-2026-001', title: 'Unpatched servers', round: 1,
      acceptor_email: 'ceo@acme.example', notes: 'Accepted with patch plan',
      created_at: '2026-07-02T00:00:00Z',
    }]);
    db.getAuditChain.mockResolvedValue(chainRows([
      { action: 'Risk registered', type: 'risk', id: 'RSK-2026-001', actor: USERS.admin.email },
      { action: 'Risk accepted',   type: 'risk', id: 'RSK-2026-001', actor: 'ceo@acme.example' },
    ]));

    const res = await asBinary(asUser(request(app).get('/api/evidence/pack'), USERS.admin));
    expect(res.status).toBe(200);
    const text = res.body.toString('latin1');
    expect(text).toContain('risk-register.csv');
    expect(text).toContain('risk-assessments.csv');
    expect(text).toContain('risk-acceptances.csv');
    expect(text).toContain('Accepted with patch plan');
    expect(text).toContain('audit-events.csv');
    expect(text).toContain('"intact": true');
    expect(text).toContain('"events_checked": 2');
    expect(text).toContain('"risk_acceptances": 1');
  });

  test('a tampered ledger is reported in the manifest, not hidden', async () => {
    const rows = chainRows([
      { action: 'Risk registered', type: 'risk', id: 'RSK-2026-001' },
      { action: 'Risk accepted',   type: 'risk', id: 'RSK-2026-001' },
    ]);
    rows[0].action = 'Risk quietly rewritten';
    db.getAuditChain.mockResolvedValue(rows);
    db.listRisks.mockResolvedValue([]);

    const res = await asBinary(asUser(request(app).get('/api/evidence/pack'), USERS.admin));
    expect(res.status).toBe(200);
    const text = res.body.toString('latin1');
    expect(text).toContain('"intact": false');
    expect(text).toContain('"break_at": 1');
  });
});

// ─── Access Reviews ───────────────────────────────────────────────────────────

describe('Access Reviews', () => {
  const BASE_REVIEW = {
    id: 1, tenant_id: 1, review_id: 'ARV-2026-001', title: 'M365 quarterly',
    system: 'Microsoft 365', description: null,
    reviewer_email: USERS.owner.email, due_date: '2026-09-30', next_review_date: null,
    status: 'OPEN', created_by: USERS.admin.email, created_at: '2026-07-08T00:00:00Z',
  };
  const LINE = (id, decision = null) => ({
    id, tenant_id: 1, review_id: 'ARV-2026-001',
    subject: `user${id}@acme.example`, resource: 'Global Admins', access_detail: 'member',
    decision, decision_note: null, decided_by: decision ? USERS.owner.email : null,
    decided_at: decision ? '2026-07-08T01:00:00Z' : null, created_at: '2026-07-08T00:00:00Z',
  });

  beforeEach(() => {
    TENANT.entitlements = ['policy_hub', 'access_reviews'];
    db.allocateAccessReviewId.mockResolvedValue('ARV-2026-002');
    db.createAccessReview.mockImplementation(async (data) => ({ ...BASE_REVIEW, ...data }));
    db.getAccessReviewById.mockResolvedValue({ ...BASE_REVIEW });
    db.listAccessReviews.mockResolvedValue([]);
    db.listAccessReviewLines.mockResolvedValue([]);
    db.getAccessReviewAttestations.mockResolvedValue([]);
    db.addAccessReviewLines.mockImplementation(async (_t, _r, lines) => lines.map((l, i) => LINE(i + 10)));
    db.getAccessReviewLine.mockResolvedValue(LINE(1));
    db.decideAccessReviewLine.mockImplementation(async (_t, _r, id, d) => ({ ...LINE(id), ...d, decision: d.decision }));
    db.updateAccessReview.mockImplementation(async (_t, id, u) => ({ ...BASE_REVIEW, review_id: id, ...u }));
    db.addAccessReviewAttestation.mockImplementation(async (_t, d) => ({ id: 5, ...d, created_at: '2026-07-08T02:00:00Z' }));
    db.appendAuditEvent.mockResolvedValue({});
  });

  test('module gate: a workspace without access_reviews is blocked', async () => {
    TENANT.entitlements = ['policy_hub'];
    const res = await asUser(request(app).get('/api/access-reviews'), USERS.admin);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'module_not_enabled', module: 'access_reviews' });
  });

  test('create requires lines and records a spine event', async () => {
    const res = await asUser(
      request(app).post('/api/access-reviews').send({
        title: 'M365 quarterly', system: 'Microsoft 365', reviewer: 'Owner@acme.example',
        lines: [
          { subject: 'a@acme.example', resource: 'Global Admins', access_detail: 'member' },
          { subject: 'b@acme.example', resource: 'Global Admins' },
        ],
      }),
      USERS.admin,
    );
    expect(res.status).toBe(201);
    expect(res.body.review_id).toBe('ARV-2026-002');
    expect(res.body.progress_state).toBe('in_review');
    expect(db.createAccessReview).toHaveBeenCalledWith(
      expect.objectContaining({ reviewer_email: 'owner@acme.example', system: 'Microsoft 365' }),
      expect.arrayContaining([expect.objectContaining({ subject: 'a@acme.example' })]),
    );
    expect(db.appendAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'Access review opened', objectType: 'access_review', objectId: 'ARV-2026-002',
    }));
  });

  test('create with no lines is a 400', async () => {
    const res = await asUser(
      request(app).post('/api/access-reviews').send({ title: 'x', system: 'y', lines: [] }),
      USERS.admin,
    );
    expect(res.status).toBe(400);
    expect(db.createAccessReview).not.toHaveBeenCalled();
  });

  test('viewer cannot open a review', async () => {
    const res = await asUser(
      request(app).post('/api/access-reviews').send({ title: 'x', system: 'y', lines: [{ subject: 'a', resource: 'b' }] }),
      USERS.viewer,
    );
    expect(res.status).toBe(403);
  });

  test('the named reviewer can decide a line; an unrelated owner cannot', async () => {
    const ok = await asUser(
      request(app).post('/api/access-reviews/ARV-2026-001/lines/1/decide').send({ decision: 'remove', note: 'left company' }),
      USERS.owner,
    );
    expect(ok.status).toBe(200);
    expect(ok.body.decision).toBe('remove');

    db.getAccessReviewById.mockResolvedValue({ ...BASE_REVIEW, reviewer_email: 'someone@acme.example' });
    const denied = await asUser(
      request(app).post('/api/access-reviews/ARV-2026-001/lines/1/decide').send({ decision: 'keep' }),
      USERS.owner,
    );
    expect(denied.status).toBe(403);
  });

  test('an invalid decision is rejected', async () => {
    const res = await asUser(
      request(app).post('/api/access-reviews/ARV-2026-001/lines/1/decide').send({ decision: 'maybe' }),
      USERS.owner,
    );
    expect(res.status).toBe(400);
  });

  test('attest is blocked until every line is decided, then succeeds with counts', async () => {
    db.listAccessReviewLines.mockResolvedValue([LINE(1, 'keep'), LINE(2)]); // one undecided
    const blocked = await asUser(
      request(app).post('/api/access-reviews/ARV-2026-001/attest').send({}),
      USERS.owner,
    );
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toMatch(/still undecided/);
    expect(db.addAccessReviewAttestation).not.toHaveBeenCalled();

    db.listAccessReviewLines.mockResolvedValue([LINE(1, 'keep'), LINE(2, 'remove'), LINE(3, 'flag')]);
    const done = await asUser(
      request(app).post('/api/access-reviews/ARV-2026-001/attest').send({ notes: 'reviewed with HR' }),
      USERS.owner,
    );
    expect(done.status).toBe(201);
    expect(db.addAccessReviewAttestation).toHaveBeenCalledWith(1, expect.objectContaining({
      lines_total: 3, lines_keep: 1, lines_remove: 1, lines_flag: 1, reviewer_email: USERS.owner.email,
    }));
    expect(db.updateAccessReview).toHaveBeenCalledWith(1, 'ARV-2026-001', { status: 'ATTESTED' });
    expect(db.appendAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'Access review attested' }));
  });

  test('deciding a line on an attested review is refused', async () => {
    db.getAccessReviewById.mockResolvedValue({ ...BASE_REVIEW, status: 'ATTESTED' });
    const res = await asUser(
      request(app).post('/api/access-reviews/ARV-2026-001/lines/1/decide').send({ decision: 'keep' }),
      USERS.owner,
    );
    expect(res.status).toBe(400);
  });

  test('only a manager can reopen an attested review', async () => {
    db.getAccessReviewById.mockResolvedValue({ ...BASE_REVIEW, status: 'ATTESTED' });
    const owner = await asUser(request(app).post('/api/access-reviews/ARV-2026-001/reopen'), USERS.owner);
    expect(owner.status).toBe(403);
    const admin = await asUser(request(app).post('/api/access-reviews/ARV-2026-001/reopen'), USERS.admin);
    expect(admin.status).toBe(200);
    expect(admin.body.status).toBe('OPEN');
  });

  test('detail returns lines, attestations, and a derived progress state', async () => {
    db.listAccessReviewLines.mockResolvedValue([LINE(1, 'keep'), LINE(2, 'flag')]);
    db.getAccessReviewAttestations.mockResolvedValue([]);
    const res = await asUser(request(app).get('/api/access-reviews/ARV-2026-001'), USERS.viewer);
    expect(res.status).toBe(200);
    expect(res.body.lines).toHaveLength(2);
    expect(res.body.progress_state).toBe('ready_to_attest');
  });
});

// ─── Vendor Assessments ───────────────────────────────────────────────────────

describe('Vendor Assessments', () => {
  const BASE_VENDOR = {
    tenant_id: 1,
    vendor_id: 'VEN-2026-001',
    name: 'CloudCRM Ltd',
    description: 'Hosted CRM platform',
    category: 'SaaS',
    tags: [],
    tier: 'medium',
    data_scope: 'Customer contact records',
    owner_email: USERS.owner.email,
    approver_email: null,
    next_review_date: '2026-12-31',
    policy_ids: [],
    evidence_ids: [],
    risk_ids: [],
    status: 'OPEN',
    created_by: USERS.admin.email,
    created_at: '2026-07-10T00:00:00Z',
  };

  const V_ASSESSMENT = {
    id: 1, tenant_id: 1, vendor_id: 'VEN-2026-001', round: 1,
    inherent_likelihood: 4, inherent_impact: 5,
    residual_likelihood: 2, residual_impact: 4,
    treatment: 'mitigate', treatment_notes: 'DPA + SSO enforced',
    assessed_by: USERS.owner.email, created_at: '2026-07-10T01:00:00Z',
  };

  beforeEach(() => {
    TENANT.entitlements = ['policy_hub', 'vendor_assessments'];
    db.allocateVendorId.mockResolvedValue('VEN-2026-002');
    db.createVendor.mockImplementation(async (data) => ({ ...BASE_VENDOR, ...data }));
    db.getVendorById.mockResolvedValue({ ...BASE_VENDOR });
    db.listVendors.mockResolvedValue([]);
    db.updateVendor.mockImplementation(async (_t, id, updates) => ({ ...BASE_VENDOR, vendor_id: id, ...updates }));
    db.addVendorAssessment.mockImplementation(async (_t, a) => ({ ...V_ASSESSMENT, ...a, round: 1 }));
    db.getVendorAssessments.mockResolvedValue([]);
    db.addVendorDecision.mockImplementation(async (_t, d) => ({ id: 9, ...d, created_at: '2026-07-10T02:00:00Z' }));
    db.getVendorDecisions.mockResolvedValue([]);
    db.logVendorEvent.mockResolvedValue();
    db.getVendorEvents.mockResolvedValue([]);
    db.filterExistingRiskIds.mockImplementation(async (_t, ids) => ids);
  });

  test('module gate: a workspace without vendor_assessments is blocked', async () => {
    TENANT.entitlements = ['policy_hub', 'risk_register'];
    const res = await asUser(request(app).get('/api/vendors'), USERS.admin);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'module_not_enabled', module: 'vendor_assessments' });
  });

  test('list derives scores, bands, and decision state (incl. declined)', async () => {
    db.listVendors.mockResolvedValue([
      { ...BASE_VENDOR, round: 1, inherent_likelihood: 4, inherent_impact: 5,
        residual_likelihood: 2, residual_impact: 4, treatment: 'mitigate', decision: null },
      { ...BASE_VENDOR, vendor_id: 'VEN-2026-002', round: 2, inherent_likelihood: 3, inherent_impact: 3,
        residual_likelihood: 1, residual_impact: 3, treatment: 'accept', decision: 'approve' },
      { ...BASE_VENDOR, vendor_id: 'VEN-2026-003', round: 1, inherent_likelihood: 5, inherent_impact: 5,
        residual_likelihood: 4, residual_impact: 5, treatment: 'avoid', decision: 'decline' },
      { ...BASE_VENDOR, vendor_id: 'VEN-2026-004', round: null, decision: null },
    ]);
    const res = await asUser(request(app).get('/api/vendors'), USERS.viewer);
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({
      inherent_score: 20, inherent_band: 'Critical',
      residual_score: 8,  residual_band: 'Medium',
      decision_state: 'awaiting_decision',
    });
    expect(res.body[1]).toMatchObject({ residual_score: 3, residual_band: 'Low', decision_state: 'approved' });
    expect(res.body[2]).toMatchObject({ residual_score: 20, residual_band: 'Critical', decision_state: 'declined' });
    expect(res.body[3]).toMatchObject({ decision_state: 'not_assessed', residual_score: null });
  });

  test('viewer cannot register a vendor', async () => {
    const res = await asUser(request(app).post('/api/vendors').send({ name: 'x' }), USERS.viewer);
    expect(res.status).toBe(403);
    expect(db.createVendor).not.toHaveBeenCalled();
  });

  test('create validates tier, defaults the owner to the creator, and logs', async () => {
    const badTier = await asUser(
      request(app).post('/api/vendors').send({ name: 'X', tier: 'extreme' }), USERS.admin);
    expect(badTier.status).toBe(400);

    const res = await asUser(
      request(app).post('/api/vendors').send({
        name: '  CloudCRM Ltd  ',
        category: 'SaaS',
        tier: 'high',
        dataScope: 'Customer contact records',
        approver: 'MD@acme.example',
        nextReviewDate: '2026-12-01',
        policyIds: ['POL-2026-001', 'POL-2026-001'],
        riskIds: ['RSK-2026-001'],
      }),
      USERS.admin,
    );
    expect(res.status).toBe(201);
    expect(db.createVendor).toHaveBeenCalledWith(expect.objectContaining({
      vendor_id: 'VEN-2026-002',
      name: 'CloudCRM Ltd',
      tier: 'high',
      data_scope: 'Customer contact records',
      owner_email: USERS.admin.email,
      approver_email: 'md@acme.example',
      policy_ids: ['POL-2026-001'],           // deduped
      risk_ids: ['RSK-2026-001'],
    }));
    expect(db.logVendorEvent).toHaveBeenCalledWith(expect.objectContaining({ event: 'Vendor registered' }));
    expect(res.body.decision_state).toBe('not_assessed');
  });

  test('links are validated: an unknown risk id is a 400', async () => {
    db.filterExistingRiskIds.mockResolvedValue([]);
    const res = await asUser(
      request(app).post('/api/vendors').send({ name: 'X', riskIds: ['RSK-2026-999'] }),
      USERS.admin,
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/RSK-2026-999/);
    expect(db.createVendor).not.toHaveBeenCalled();
  });

  test('an owner-role user cannot edit a vendor they do not own', async () => {
    db.getVendorById.mockResolvedValue({ ...BASE_VENDOR, owner_email: 'someone-else@acme.example' });
    const res = await asUser(
      request(app).put('/api/vendors/VEN-2026-001').send({ name: 'New' }), USERS.owner);
    expect(res.status).toBe(403);
  });

  test('the owner assesses: a new append-only round with derived bands', async () => {
    const res = await asUser(
      request(app).post('/api/vendors/VEN-2026-001/assess').send({
        inherentLikelihood: 4, inherentImpact: 5,
        residualLikelihood: 2, residualImpact: 4,
        treatment: 'mitigate', treatmentNotes: 'DPA + SSO enforced',
      }),
      USERS.owner,
    );
    expect(res.status).toBe(201);
    expect(db.addVendorAssessment).toHaveBeenCalledWith(TENANT.id, expect.objectContaining({
      vendorId: 'VEN-2026-001', treatment: 'mitigate', assessedBy: USERS.owner.email,
    }));
    expect(res.body).toMatchObject({
      inherent_score: 20, inherent_band: 'Critical',
      residual_score: 8,  residual_band: 'Medium',
      decision_state: 'awaiting_decision',
    });
  });

  test('decide requires an assessment first and a valid decision value', async () => {
    const noRound = await asUser(
      request(app).post('/api/vendors/VEN-2026-001/decide').send({ decision: 'approve' }), USERS.owner);
    expect(noRound.status).toBe(400);

    db.getVendorAssessments.mockResolvedValue([V_ASSESSMENT]);
    const badDecision = await asUser(
      request(app).post('/api/vendors/VEN-2026-001/decide').send({ decision: 'maybe' }), USERS.owner);
    expect(badDecision.status).toBe(400);
    expect(db.addVendorDecision).not.toHaveBeenCalled();
  });

  test('only the effective approver may decide (approver falls back to owner)', async () => {
    db.getVendorAssessments.mockResolvedValue([V_ASSESSMENT]);
    const res = await asUser(
      request(app).post('/api/vendors/VEN-2026-001/decide').send({ decision: 'approve' }),
      USERS.authoriser,
    );
    expect(res.status).toBe(403);
  });

  test('the approver approves the latest round — receipt pinned to it', async () => {
    db.getVendorById.mockResolvedValue({ ...BASE_VENDOR, approver_email: USERS.exec.email });
    db.getVendorAssessments.mockResolvedValue([V_ASSESSMENT]);
    const res = await asUser(
      request(app).post('/api/vendors/VEN-2026-001/decide').send({ decision: 'approve', notes: 'Engaged for FY27' }),
      USERS.exec,
    );
    expect(res.status).toBe(201);
    expect(db.addVendorDecision).toHaveBeenCalledWith(TENANT.id, expect.objectContaining({
      vendorId: 'VEN-2026-001', round: 1, decision: 'approve',
      deciderEmail: USERS.exec.email, notes: 'Engaged for FY27',
    }));
    expect(res.body).toMatchObject({ residual_score: 8, residual_band: 'Medium' });
    expect(db.logVendorEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.stringContaining('Vendor approved'),
    }));
  });

  test('DECLINE is a first-class receipt — walking away is recorded evidence', async () => {
    db.getVendorAssessments.mockResolvedValue([V_ASSESSMENT]);
    const res = await asUser(
      request(app).post('/api/vendors/VEN-2026-001/decide').send({ decision: 'decline', notes: 'No SOC 2, refused DPA' }),
      USERS.owner,
    );
    expect(res.status).toBe(201);
    expect(db.addVendorDecision).toHaveBeenCalledWith(TENANT.id, expect.objectContaining({
      decision: 'decline', notes: 'No SOC 2, refused DPA',
    }));
    expect(db.logVendorEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.stringContaining('Vendor declined'),
    }));
  });

  test('tier gate: a HIGH tier vendor cannot be decided by the named approver', async () => {
    db.getVendorById.mockResolvedValue({ ...BASE_VENDOR, tier: 'high', approver_email: USERS.exec.email });
    db.getVendorAssessments.mockResolvedValue([V_ASSESSMENT]);
    const res = await asUser(
      request(app).post('/api/vendors/VEN-2026-001/decide').send({ decision: 'approve' }),
      USERS.exec,
    );
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/high-tier/);
    expect(db.addVendorDecision).not.toHaveBeenCalled();
  });

  test('tier gate: an admin decides a CRITICAL tier vendor', async () => {
    db.getVendorById.mockResolvedValue({ ...BASE_VENDOR, tier: 'critical' });
    db.getVendorAssessments.mockResolvedValue([V_ASSESSMENT]);
    const res = await asUser(
      request(app).post('/api/vendors/VEN-2026-001/decide').send({ decision: 'approve' }),
      USERS.admin,
    );
    expect(res.status).toBe(201);
  });

  test('a round takes exactly one decision', async () => {
    db.getVendorAssessments.mockResolvedValue([V_ASSESSMENT]);
    db.getVendorDecisions.mockResolvedValue([{ id: 1, round: 1, decision: 'decline', decider_email: USERS.owner.email }]);
    const res = await asUser(
      request(app).post('/api/vendors/VEN-2026-001/decide').send({ decision: 'approve' }), USERS.owner);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already decided/);
    expect(db.addVendorDecision).not.toHaveBeenCalled();
  });

  test('a re-assessment reopens the decision: detail derives awaiting_decision', async () => {
    db.getVendorAssessments.mockResolvedValue([
      V_ASSESSMENT,
      { ...V_ASSESSMENT, id: 2, round: 2, residual_likelihood: 3 },
    ]);
    // decision covers round 1 only
    db.getVendorDecisions.mockResolvedValue([{ id: 1, round: 1, decision: 'approve', decider_email: USERS.owner.email }]);
    const res = await asUser(request(app).get('/api/vendors/VEN-2026-001'), USERS.viewer);
    expect(res.status).toBe(200);
    expect(res.body.round).toBe(2);
    expect(res.body.decision_state).toBe('awaiting_decision');
    expect(res.body.assessments).toHaveLength(2);
    expect(res.body.effective_approver).toBe(USERS.owner.email);
    expect(res.body.tier_escalated).toBe(false);
  });

  test('offboard and reactivate append events; assessing an offboarded vendor is rejected', async () => {
    const off = await asUser(request(app).post('/api/vendors/VEN-2026-001/offboard').send({ reason: 'Contract ended' }), USERS.admin);
    expect(off.status).toBe(200);
    expect(db.updateVendor).toHaveBeenCalledWith(TENANT.id, 'VEN-2026-001', { status: 'OFFBOARDED' });

    db.getVendorById.mockResolvedValue({ ...BASE_VENDOR, status: 'OFFBOARDED' });
    const assess = await asUser(
      request(app).post('/api/vendors/VEN-2026-001/assess').send({
        inherentLikelihood: 1, inherentImpact: 1, residualLikelihood: 1, residualImpact: 1, treatment: 'accept',
      }),
      USERS.admin,
    );
    expect(assess.status).toBe(400);

    const decide = await asUser(
      request(app).post('/api/vendors/VEN-2026-001/decide').send({ decision: 'approve' }), USERS.admin);
    expect(decide.status).toBe(400);

    const back = await asUser(request(app).post('/api/vendors/VEN-2026-001/reactivate'), USERS.admin);
    expect(back.status).toBe(200);
    expect(db.updateVendor).toHaveBeenCalledWith(TENANT.id, 'VEN-2026-001', { status: 'OPEN' });
  });

  test('dashboard: vendors section appears when entitled, with awaiting-decision attention', async () => {
    TENANT.entitlements = ['policy_hub', 'vendor_assessments'];
    db.listVendors.mockResolvedValue([
      { ...BASE_VENDOR, round: 1, residual_likelihood: 4, residual_impact: 5, decision: null, tier: 'critical' },
      { ...BASE_VENDOR, vendor_id: 'VEN-2026-002', round: null, decision: null },
    ]);
    const res = await asUser(request(app).get('/api/dashboard'), USERS.admin);
    expect(res.status).toBe(200);
    expect(res.body.vendors).toMatchObject({
      open: 2, awaiting_decision: 1, not_assessed: 1,
    });
    expect(res.body.vendors.attention[0]).toMatchObject({
      vendor_id: 'VEN-2026-001', tier: 'critical', residual_score: 20, residual_band: 'Critical',
    });
    expect(res.body.risks).toBeUndefined();
  });
});

// ─── Obligations Register ─────────────────────────────────────────────────────

describe('Obligations Register', () => {
  const BASE_OBLIGATION = {
    tenant_id: 1,
    obligation_id: 'OBL-2026-001',
    title: 'Notify the ICO of a personal data breach within 72 hours',
    description: null,
    source_type: 'regulation',
    source_name: 'UK GDPR',
    source_ref: 'Art. 33',
    owner_email: USERS.owner.email,
    next_review_date: '2026-12-31',
    policy_ids: ['POL-2026-001'],
    risk_ids: [],
    evidence_ids: [],
    status: 'ACTIVE',
    created_by: USERS.admin.email,
    created_at: '2026-07-12T00:00:00Z',
  };

  beforeEach(() => {
    TENANT.entitlements = ['policy_hub', 'obligations'];
    db.allocateObligationId.mockResolvedValue('OBL-2026-002');
    db.createObligation.mockImplementation(async (data) => ({ ...BASE_OBLIGATION, ...data }));
    db.getObligationById.mockResolvedValue({ ...BASE_OBLIGATION });
    db.listObligations.mockResolvedValue([]);
    db.updateObligation.mockImplementation(async (_t, id, updates) => ({ ...BASE_OBLIGATION, obligation_id: id, ...updates }));
    db.logObligationEvent.mockResolvedValue();
    db.getObligationEvents.mockResolvedValue([]);
    db.getObligationsLinkedTo.mockResolvedValue([]);
    db.filterExistingPolicyIds.mockImplementation(async (_t, ids) => ids);
    db.filterExistingEvidenceIds.mockImplementation(async (_t, ids) => ids);
    db.filterExistingRiskIds.mockImplementation(async (_t, ids) => ids);
  });

  test('module gate: a workspace without obligations is blocked', async () => {
    TENANT.entitlements = ['policy_hub'];
    const res = await asUser(request(app).get('/api/obligations'), USERS.admin);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'module_not_enabled', module: 'obligations' });
  });

  test('staff and acceptor never reach the register; viewer reads it', async () => {
    expect((await asUser(request(app).get('/api/obligations'), USERS.staff)).status).toBe(403);
    expect((await asUser(request(app).get('/api/obligations'), USERS.acceptor)).status).toBe(403);
    const res = await asUser(request(app).get('/api/obligations'), USERS.viewer);
    expect(res.status).toBe(200);
  });

  test('list derives coverage: linked = answered, bare = unanswered', async () => {
    db.listObligations.mockResolvedValue([
      { ...BASE_OBLIGATION },
      { ...BASE_OBLIGATION, obligation_id: 'OBL-2026-002', policy_ids: [], risk_ids: [], evidence_ids: [] },
      { ...BASE_OBLIGATION, obligation_id: 'OBL-2026-003', status: 'RETIRED' },
    ]);
    const res = await asUser(request(app).get('/api/obligations'), USERS.admin);
    expect(res.status).toBe(200);
    expect(res.body.map(o => o.coverage_state)).toEqual(['answered', 'unanswered', 'retired']);
  });

  test('viewer cannot record an obligation', async () => {
    const res = await asUser(
      request(app).post('/api/obligations').send({ title: 'X', sourceType: 'law', sourceName: 'Y' }),
      USERS.viewer,
    );
    expect(res.status).toBe(403);
    expect(db.createObligation).not.toHaveBeenCalled();
  });

  test('create validates the source, defaults the owner to the creator, and logs', async () => {
    const badSource = await asUser(
      request(app).post('/api/obligations').send({ title: 'X', sourceType: 'vibes', sourceName: 'Y' }),
      USERS.admin,
    );
    expect(badSource.status).toBe(400);

    const noSourceName = await asUser(
      request(app).post('/api/obligations').send({ title: 'X', sourceType: 'contract' }),
      USERS.admin,
    );
    expect(noSourceName.status).toBe(400);

    const res = await asUser(
      request(app).post('/api/obligations').send({
        title: '  Maintain MFA on all admin accounts  ',
        sourceType: 'insurance',
        sourceName: 'Cyber policy CP-2026-118',
        sourceRef: 'Condition 4(b)',
        nextReviewDate: '2027-03-01',
        policyIds: ['POL-2026-001', 'POL-2026-001'],
        evidenceIds: ['EVD-2026-001'],
      }),
      USERS.admin,
    );
    expect(res.status).toBe(201);
    expect(db.createObligation).toHaveBeenCalledWith(expect.objectContaining({
      obligation_id: 'OBL-2026-002',
      title: 'Maintain MFA on all admin accounts',
      source_type: 'insurance',
      source_name: 'Cyber policy CP-2026-118',
      source_ref: 'Condition 4(b)',
      owner_email: USERS.admin.email,
      policy_ids: ['POL-2026-001'],          // deduped
      evidence_ids: ['EVD-2026-001'],
    }));
    expect(db.logObligationEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.stringContaining('Obligation recorded'),
    }));
    expect(res.body.coverage_state).toBe('answered');
  });

  test('links are validated: an unknown evidence id is a 400', async () => {
    db.filterExistingEvidenceIds.mockResolvedValue([]);
    const res = await asUser(
      request(app).post('/api/obligations').send({
        title: 'X', sourceType: 'law', sourceName: 'Y', evidenceIds: ['EVD-2026-999'],
      }),
      USERS.admin,
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/EVD-2026-999/);
    expect(db.createObligation).not.toHaveBeenCalled();
  });

  test('an owner-role user cannot edit an obligation they do not own', async () => {
    db.getObligationById.mockResolvedValue({ ...BASE_OBLIGATION, owner_email: 'someone-else@acme.example' });
    const res = await asUser(
      request(app).put('/api/obligations/OBL-2026-001').send({ title: 'New' }), USERS.owner);
    expect(res.status).toBe(403);
  });

  test('review records the attributed event and moves the review date', async () => {
    const res = await asUser(
      request(app).post('/api/obligations/OBL-2026-001/review')
        .send({ nextReviewDate: '2027-07-01', notes: 'Policy renewed, conditions unchanged' }),
      USERS.owner,
    );
    expect(res.status).toBe(200);
    expect(db.updateObligation).toHaveBeenCalledWith(TENANT.id, 'OBL-2026-001', {
      next_review_date: '2027-07-01',
    });
    expect(db.logObligationEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.stringContaining('still current'),
      metadata: expect.objectContaining({ notes: 'Policy renewed, conditions unchanged' }),
    }));
  });

  test('retire and reactivate are events, never deletes', async () => {
    const retired = await asUser(
      request(app).post('/api/obligations/OBL-2026-001/retire').send({ reason: 'Contract ended' }),
      USERS.admin,
    );
    expect(retired.status).toBe(200);
    expect(db.updateObligation).toHaveBeenCalledWith(TENANT.id, 'OBL-2026-001', { status: 'RETIRED' });

    db.getObligationById.mockResolvedValue({ ...BASE_OBLIGATION, status: 'RETIRED' });
    const back = await asUser(
      request(app).post('/api/obligations/OBL-2026-001/reactivate'), USERS.admin);
    expect(back.status).toBe(200);
    expect(db.updateObligation).toHaveBeenCalledWith(TENANT.id, 'OBL-2026-001', { status: 'ACTIVE' });
  });

  test('policy detail carries the obligations naming it', async () => {
    db.getObligationsLinkedTo.mockResolvedValue([{
      obligation_id: 'OBL-2026-001', title: BASE_OBLIGATION.title,
      source_type: 'regulation', source_name: 'UK GDPR', source_ref: 'Art. 33', status: 'ACTIVE',
    }]);
    const res = await asUser(request(app).get('/api/policies/POL-2026-001'), USERS.viewer);
    expect(res.status).toBe(200);
    expect(res.body.linkedObligations).toHaveLength(1);
    expect(res.body.linkedObligations[0]).toMatchObject({ obligation_id: 'OBL-2026-001', source_name: 'UK GDPR' });
  });

  test('dashboard: unanswered obligations lead the attention list', async () => {
    TENANT.entitlements = ['policy_hub', 'obligations'];
    db.listPolicies.mockResolvedValue([]);
    db.countOutstandingAcceptances.mockResolvedValue(0);
    db.listObligations.mockResolvedValue([
      { ...BASE_OBLIGATION },
      { ...BASE_OBLIGATION, obligation_id: 'OBL-2026-002', policy_ids: [], risk_ids: [], evidence_ids: [],
        next_review_date: '2000-01-01' },
    ]);
    const res = await asUser(request(app).get('/api/dashboard'), USERS.admin);
    expect(res.status).toBe(200);
    // OBL-001 cites a policy but no evidence → answered, but unproven.
    expect(res.body.obligations).toMatchObject({ active: 2, unanswered: 1, unproven: 1, review_overdue: 1 });
    expect(res.body.obligations.attention[0]).toMatchObject({
      obligation_id: 'OBL-2026-002', source_name: 'UK GDPR',
    });
  });

  test('dashboard: unproven counts obligations with a method but no evidence', async () => {
    TENANT.entitlements = ['policy_hub', 'obligations'];
    db.listPolicies.mockResolvedValue([]);
    db.countOutstandingAcceptances.mockResolvedValue(0);
    db.listObligations.mockResolvedValue([
      // answered by a policy AND proven — the chain is intact.
      { ...BASE_OBLIGATION, evidence_ids: ['EVD-2026-001'] },
      // answered by a policy, nothing proving it.
      { ...BASE_OBLIGATION, obligation_id: 'OBL-2026-002' },
      // answered by a risk only, nothing proving it — still unproven.
      { ...BASE_OBLIGATION, obligation_id: 'OBL-2026-003', policy_ids: [], risk_ids: ['RSK-2026-001'] },
      // nothing at all — unanswered, and NOT counted as unproven.
      { ...BASE_OBLIGATION, obligation_id: 'OBL-2026-004', policy_ids: [] },
    ]);
    const res = await asUser(request(app).get('/api/dashboard'), USERS.admin);
    expect(res.status).toBe(200);
    expect(res.body.obligations).toMatchObject({ active: 4, unanswered: 1, unproven: 2 });
  });

  test('the audit pack carries the obligations register when enabled', async () => {
    TENANT.entitlements = ['policy_hub', 'evidence_locker', 'obligations'];
    const asBinary = (req) => req.buffer(true).parse((res2, cb) => {
      const chunks = [];
      res2.on('data', (c) => chunks.push(c));
      res2.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    db.listEvidence.mockResolvedValue([]);
    db.listApprovalReceipts.mockResolvedValue([]);
    db.getAuditChain.mockResolvedValue([]);
    db.listObligations.mockResolvedValue([{ ...BASE_OBLIGATION }]);

    const res = await asBinary(asUser(request(app).get('/api/evidence/pack'), USERS.admin));
    expect(res.status).toBe(200);
    const text = res.body.toString('latin1');
    expect(text).toContain('obligations.csv');
    expect(text).toContain('UK GDPR');
    expect(text).toContain('"obligations": 1');
  });
});
