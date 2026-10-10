/**
 * howldr ProofWorks
 * Policy register export
 *
 * GET /api/register            → JSON array of register rows
 * GET /api/register?format=csv → text/csv download
 *
 * Optional filters: ?status=ACTIVE  ?category=IT
 * Register columns mirror docs/specification.md §5.1.
 */

const db = require('../db/db');

const REGISTER_COLUMNS = [
  'policy_id',
  'title',
  'category',
  'owner_email',
  'current_version',
  'status',
  'authorised_date',
  'review_frequency_months',
  'next_review_date',
  'applicable_roles',
  'acknowledgement_count',
  'acknowledgement_total',
  'last_updated',
];

/** Format a value for the register: dates → YYYY-MM-DD, arrays → "a; b". */
function registerValue(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join('; ');
  if (value instanceof Date) return value.toISOString().split('T')[0];
  return String(value);
}

/** RFC 4180 field escaping: quote when the value contains , " or newline. */
function csvField(value) {
  const s = registerValue(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toRegisterRows(policies) {
  return policies.map(p => {
    const row = {};
    for (const col of REGISTER_COLUMNS) row[col] = registerValue(p[col]);
    return row;
  });
}

function toCsv(policies) {
  const lines = [REGISTER_COLUMNS.join(',')];
  for (const p of policies) {
    lines.push(REGISTER_COLUMNS.map(col => csvField(p[col])).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

async function handleRegisterExport(req, res) {
  try {
    const { status, category, format } = req.query;
    const policies = await db.listPolicies({
      tenantId: req.tenant.id,
      status,
      category,
      limit: 10000,
    });

    if ((format || '').toLowerCase() === 'csv') {
      const today = new Date().toISOString().split('T')[0];
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="policy-register-${req.tenant.slug}-${today}.csv"`
      );
      return res.send(toCsv(policies));
    }

    res.json({
      tenant:      req.tenant.slug,
      exported_at: new Date().toISOString(),
      count:       policies.length,
      policies:    toRegisterRows(policies),
    });
  } catch (err) {
    console.error('GET /register failed:', err);
    res.status(500).json({ error: err.message });
  }
}

module.exports = { handleRegisterExport, toCsv, toRegisterRows, csvField, REGISTER_COLUMNS };
