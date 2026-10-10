/**
 * howldr ProofWorks
 * Dev API stub — a tiny in-memory imitation of the Express API so the web
 * app can be developed and demoed without DATABASE_URL or a Supabase session.
 *
 *   node scripts/dev-api-stub.js            # listens on :4100
 *   PORT=5000 node scripts/dev-api-stub.js
 *
 * Point the web app at it with web/.env.local:
 *   NEXT_PUBLIC_API_BASE_URL=http://localhost:4100
 *
 * Endpoint shapes mirror src/api exactly (underscored statuses, DB column
 * names, pg date serialisation) so the web normalisation layer is exercised
 * for real. No auth: every request is treated as an admin.
 */

const http = require('http');

const PORT = process.env.PORT || 4100;

const today = new Date();
const iso = (d) => d.toISOString();
const day = (offsetDays) => {
  const d = new Date(today);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return iso(d);
};

const POLICIES = [
  {
    policy_id: 'POL-2026-001',
    title: 'Acceptable Use Policy',
    category: 'IT',
    owner_email: 'jane.doe@acme.example',
    current_version: 'v2.0',
    status: 'ACTIVE',
    authorised_date: day(-300),
    review_frequency_months: 12,
    next_review_date: day(65),
    applicable_roles: ['all-staff'],
    acknowledgement_count: 47,
    acknowledgement_total: 47,
    last_updated: day(-3),
  },
  {
    policy_id: 'POL-2026-002',
    title: 'Information Security Policy',
    category: 'Security',
    owner_email: 'ciso@acme.example',
    current_version: 'v1.3',
    status: 'UNDER_REVIEW',
    authorised_date: null,
    review_frequency_months: 12,
    next_review_date: day(14),
    applicable_roles: ['all-staff'],
    acknowledgement_count: 0,
    acknowledgement_total: 51,
    last_updated: day(-1),
  },
  {
    policy_id: 'POL-2026-003',
    title: 'Data Protection, Privacy & Retention Policy',
    category: 'Legal',
    owner_email: 'dpo@acme.example',
    current_version: 'v3.0',
    status: 'PENDING_ACCEPTANCE',
    authorised_date: day(-10),
    review_frequency_months: 12,
    next_review_date: day(355),
    applicable_roles: ['all-staff'],
    acknowledgement_count: 32,
    acknowledgement_total: 51,
    last_updated: day(0),
  },
  {
    policy_id: 'POL-2026-004',
    title: 'AI & Generative Tools Usage Policy',
    category: 'IT',
    owner_email: 'cto@acme.example',
    current_version: 'v0.4',
    status: 'DRAFT',
    authorised_date: null,
    review_frequency_months: 12,
    next_review_date: null,
    applicable_roles: ['engineering', 'product'],
    acknowledgement_count: 0,
    acknowledgement_total: 0,
    last_updated: day(-2),
  },
  {
    policy_id: 'POL-2025-009',
    title: 'Remote Working Policy',
    category: 'HR',
    owner_email: 'hr.lead@acme.example',
    current_version: 'v1.0',
    status: 'ACTIVE',
    authorised_date: day(-400),
    review_frequency_months: 12,
    next_review_date: day(-12), // overdue on purpose
    applicable_roles: ['remote', 'hybrid'],
    acknowledgement_count: 28,
    acknowledgement_total: 28,
    last_updated: day(-40),
  },
  {
    policy_id: 'POL-2024-005',
    title: 'Social Media Policy',
    category: 'Marketing',
    owner_email: 'comms@acme.example',
    current_version: 'v1.2',
    status: 'RETIRED',
    authorised_date: day(-700),
    review_frequency_months: 12,
    next_review_date: day(-180),
    applicable_roles: ['marketing'],
    acknowledgement_count: 12,
    acknowledgement_total: 12,
    last_updated: day(-180),
  },
];

const AUTHORISERS = {
  'POL-2026-002': [
    { email: 'ciso@acme.example', approved_at: day(-1), returned_at: null, feedback: null },
    { email: 'legal@acme.example', approved_at: null, returned_at: null, feedback: null },
  ],
  'POL-2026-003': [
    { email: 'ciso@acme.example', approved_at: day(-10), returned_at: null, feedback: null },
  ],
};

const ACKS = {
  'POL-2026-003': [
    { version: 'v3.0', recipient_email: 'a.archer@acme.example', manager_email: 'm.boss@acme.example', distributed_at: day(-9), expires_at: day(21), acknowledged_at: day(-7), download_count: 2 },
    { version: 'v3.0', recipient_email: 'b.brown@acme.example', manager_email: 'm.boss@acme.example', distributed_at: day(-9), expires_at: day(21), acknowledged_at: null, download_count: 0 },
    { version: 'v3.0', recipient_email: 'c.clark@acme.example', manager_email: null, distributed_at: day(-9), expires_at: day(21), acknowledged_at: day(-2), download_count: 1 },
  ],
};

const CHANGELOG = {
  'POL-2026-003': [
    { id: 1, event: 'Policy initiated', from_status: null, to_status: 'DRAFT', from_version: null, to_version: 'v0.1', actor_email: 'admin@acme.example', created_at: day(-30) },
    { id: 2, event: 'Submitted for authorisation', from_status: 'DRAFT', to_status: 'UNDER_REVIEW', from_version: null, to_version: null, actor_email: 'dpo@acme.example', created_at: day(-14) },
    { id: 3, event: 'All authorisers approved — policy authorised', from_status: 'UNDER_REVIEW', to_status: 'PENDING_ACCEPTANCE', from_version: 'v2.4', to_version: 'v3.0', actor_email: 'ciso@acme.example', created_at: day(-10) },
    { id: 4, event: 'Policy distributed to 3 recipients', from_status: null, to_status: null, from_version: null, to_version: null, actor_email: 'dpo@acme.example', created_at: day(-9) },
  ],
};

const STAFF = [
  { id: 'u-1', email: 'admin@acme.example',   role: 'admin',           created_at: day(-160) },
  { id: 'u-2', email: 'dpo@acme.example',     role: 'owner',           created_at: day(-150) },
  { id: 'u-3', email: 'ciso@acme.example',    role: 'authoriser',      created_at: day(-120) },
  { id: 'u-4', email: 'legal@acme.example',   role: 'authoriser',      created_at: day(-118) },
  { id: 'u-5', email: 'gov@acme.example',     role: 'governance_lead', created_at: day(-90) },
  { id: 'u-6', email: 'auditor@acme.example', role: 'viewer',          created_at: day(-30) },
];

const SETTINGS = {
  tenant: {
    slug: 'acme', name: 'Acme Corporation', custom_domain: null,
    lf_share_name: 'policies', status: 'active', created_at: day(-365),
  },
  cadence: {
    acceptanceReminderDays: [3, 7, 14],
    reviewAdvanceNoticeDays: 30,
    reviewGracePeriodDays: 30,
    scope: 'deployment',
  },
  integrations: {
    liquidFiles: { configured: true, host: 'sft.howldr.com' },
    invites: { configured: true },
    app: { host: 'policyhub.howldr.com' },
  },
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  console.log(`[stub] ${req.method} ${path}`);

  if (req.method === 'OPTIONS') return send(res, 204, {});

  if (path === '/health') {
    return send(res, 200, { status: 'ok', db: { time: iso(new Date()) } });
  }

  if (path === '/api/policies') {
    return send(res, 200, POLICIES);
  }

  let m = path.match(/^\/api\/policies\/([^/]+)$/);
  if (m) {
    const p = POLICIES.find((x) => x.policy_id === decodeURIComponent(m[1]));
    if (!p) return send(res, 404, { error: 'Policy not found' });
    return send(res, 200, { ...p, authorisers: AUTHORISERS[p.policy_id] || [] });
  }

  m = path.match(/^\/api\/policies\/([^/]+)\/acknowledgements$/);
  if (m) return send(res, 200, ACKS[decodeURIComponent(m[1])] || []);

  m = path.match(/^\/api\/policies\/([^/]+)\/changelog$/);
  if (m) return send(res, 200, CHANGELOG[decodeURIComponent(m[1])] || []);

  if (path === '/api/users') return send(res, 200, STAFF);

  if (path === '/api/settings') return send(res, 200, SETTINGS);

  send(res, 404, { error: `No stub for ${req.method} ${path}` });
});

server.listen(PORT, () => {
  console.log(`[stub] ProofWorks dev API stub on http://localhost:${PORT}`);
});
