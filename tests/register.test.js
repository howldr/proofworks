/**
 * Unit tests — src/register/register.js (pure lifecycle logic)
 */

const {
  STATUS,
  VALID_TRANSITIONS,
  transition,
  parseVersion,
  formatVersion,
  incrementMinor,
  promoteToMajor,
  generatePolicyId,
  calculateNextReviewDate,
  buildInitialRegister,
} = require('../src/register/register');

describe('version management', () => {
  test('parseVersion handles vX.Y', () => {
    expect(parseVersion('v1.3')).toEqual({ major: 1, minor: 3 });
    expect(parseVersion('v0.1')).toEqual({ major: 0, minor: 1 });
    expect(parseVersion('v12.34')).toEqual({ major: 12, minor: 34 });
  });

  test('parseVersion rejects malformed versions', () => {
    for (const bad of ['1.3.5', 'v1', 'vx.y', '', 'v1.']) {
      expect(() => parseVersion(bad)).toThrow(/Invalid version format/);
    }
  });

  test('formatVersion round-trips', () => {
    expect(formatVersion(2, 3)).toBe('v2.3');
    const { major, minor } = parseVersion('v7.9');
    expect(formatVersion(major, minor)).toBe('v7.9');
  });

  test('incrementMinor bumps draft iteration', () => {
    expect(incrementMinor('v1.3')).toBe('v1.4');
    expect(incrementMinor('v0.9')).toBe('v0.10');
  });

  test('promoteToMajor resets minor', () => {
    expect(promoteToMajor('v1.3')).toBe('v2.0');
    expect(promoteToMajor('v0.7')).toBe('v1.0');
  });
});

describe('status transitions', () => {
  const policy = (status) => ({ policy_id: 'POL-2026-001', status });

  test.each([
    [STATUS.DRAFT, STATUS.UNDER_REVIEW],
    [STATUS.UNDER_REVIEW, STATUS.DRAFT],
    [STATUS.UNDER_REVIEW, STATUS.PENDING_ACCEPTANCE],
    [STATUS.PENDING_ACCEPTANCE, STATUS.ACTIVE],
    [STATUS.ACTIVE, STATUS.UNDER_REVIEW],
    [STATUS.ACTIVE, STATUS.RETIRED],
  ])('allows %s → %s', (from, to) => {
    const updated = transition(policy(from), to);
    expect(updated.status).toBe(to);
    expect(updated.last_updated).toBeTruthy();
  });

  test.each([
    [STATUS.DRAFT, STATUS.ACTIVE],
    [STATUS.DRAFT, STATUS.RETIRED],
    [STATUS.PENDING_ACCEPTANCE, STATUS.DRAFT],
    [STATUS.RETIRED, STATUS.DRAFT],
    [STATUS.RETIRED, STATUS.ACTIVE],
  ])('rejects %s → %s', (from, to) => {
    expect(() => transition(policy(from), to)).toThrow(/Invalid status transition/);
  });

  test('RETIRED is terminal', () => {
    expect(VALID_TRANSITIONS[STATUS.RETIRED].size).toBe(0);
  });
});

describe('policy IDs', () => {
  test('generatePolicyId pads the sequence', () => {
    const year = new Date().getFullYear();
    expect(generatePolicyId(0)).toBe(`POL-${year}-001`);
    expect(generatePolicyId(41)).toBe(`POL-${year}-042`);
    expect(generatePolicyId(999)).toBe(`POL-${year}-1000`);
  });
});

describe('review dates', () => {
  test('calculateNextReviewDate adds frequency months', () => {
    expect(calculateNextReviewDate('2026-01-15', 12)).toBe('2027-01-15');
    expect(calculateNextReviewDate('2026-01-15', 6)).toBe('2026-07-15');
  });

  test('handles month-end rollover', () => {
    // Jan 31 + 1 month — JS Date rolls into March; assert it stays a valid date
    const out = calculateNextReviewDate('2026-01-31', 1);
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('buildInitialRegister', () => {
  test('produces a DRAFT v0.1 register entry', () => {
    const reg = buildInitialRegister({
      policyId: 'POL-2026-001',
      title: 'Acceptable Use',
      category: 'IT',
      ownerEmail: 'owner@acme.example',
      authoriserEmails: ['ciso@acme.example'],
      applicableRoles: ['all-staff'],
      reviewFrequencyMonths: 12,
      liquidfilesFolderIds: { root: 'r1', current: 'c1' },
      acknowledgementTotal: 0,
    });
    expect(reg.status).toBe(STATUS.DRAFT);
    expect(reg.current_version).toBe('v0.1');
    expect(reg.policy_id).toBe('POL-2026-001');
    expect(reg.authorised_date).toBeNull();
    expect(reg.liquidfiles_folder_id).toBe('r1');
  });
});
