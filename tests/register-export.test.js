/**
 * Unit tests — src/api/register-export.js (CSV/row shaping)
 */

const { toCsv, toRegisterRows, csvField, REGISTER_COLUMNS } = require('../src/api/register-export');

const samplePolicy = {
  policy_id: 'POL-2026-001',
  title: 'Acceptable Use Policy',
  category: 'IT',
  owner_email: 'owner@acme.example',
  current_version: 'v2.0',
  status: 'ACTIVE',
  authorised_date: new Date('2026-01-15T00:00:00Z'),
  review_frequency_months: 12,
  next_review_date: new Date('2027-01-15T00:00:00Z'),
  applicable_roles: ['all-staff', 'contractors'],
  acknowledgement_count: 47,
  acknowledgement_total: 51,
  last_updated: new Date('2026-06-01T08:00:00Z'),
  // extra DB columns that must NOT leak into the register
  lf_folder_id_root: 'secret-folder-id',
  tenant_id: 1,
};

describe('csvField', () => {
  test('passes plain values through', () => {
    expect(csvField('IT')).toBe('IT');
    expect(csvField(42)).toBe('42');
  });

  test('escapes commas, quotes, and newlines per RFC 4180', () => {
    expect(csvField('Policies, procedures')).toBe('"Policies, procedures"');
    expect(csvField('He said "go"')).toBe('"He said ""go"""');
    expect(csvField('line1\nline2')).toBe('"line1\nline2"');
  });

  test('renders null/undefined as empty and arrays joined', () => {
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
    expect(csvField(['a', 'b'])).toBe('a; b');
  });

  test('formats dates as YYYY-MM-DD', () => {
    expect(csvField(new Date('2026-01-15T12:34:56Z'))).toBe('2026-01-15');
  });
});

describe('toRegisterRows', () => {
  test('keeps exactly the register columns', () => {
    const [row] = toRegisterRows([samplePolicy]);
    expect(Object.keys(row)).toEqual(REGISTER_COLUMNS);
    expect(row.lf_folder_id_root).toBeUndefined();
    expect(row.tenant_id).toBeUndefined();
  });

  test('normalises values', () => {
    const [row] = toRegisterRows([samplePolicy]);
    expect(row.authorised_date).toBe('2026-01-15');
    expect(row.applicable_roles).toBe('all-staff; contractors');
    expect(row.acknowledgement_count).toBe('47');
  });
});

describe('toCsv', () => {
  test('emits header + one line per policy with CRLF endings', () => {
    const csv = toCsv([samplePolicy]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe(REGISTER_COLUMNS.join(','));
    expect(lines[1]).toContain('POL-2026-001');
    expect(lines[1]).toContain('all-staff; contractors');
    expect(lines[2]).toBe(''); // trailing CRLF
  });

  test('quotes titles containing commas', () => {
    const csv = toCsv([{ ...samplePolicy, title: 'Data, Privacy & You' }]);
    expect(csv).toContain('"Data, Privacy & You"');
  });
});
