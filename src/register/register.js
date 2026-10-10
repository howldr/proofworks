/**
 * howldr ProofWorks
 * Policy register
 *
 * Manages the master policy register — status transitions, version management,
 * and register.json per policy.
 */

// ─── Status constants ────────────────────────────────────────────────────────

const STATUS = {
  DRAFT:              'DRAFT',
  UNDER_REVIEW:       'UNDER_REVIEW',
  OWNER_ACCEPTANCE:   'OWNER_ACCEPTANCE',
  EXEC_REVIEW:        'EXEC_REVIEW',
  PENDING_ACCEPTANCE: 'PENDING_ACCEPTANCE',
  ACTIVE:             'ACTIVE',
  RETIRED:            'RETIRED',
};

// Valid transitions: STATUS[from] → set of valid STATUS[to]
// After full authoriser consensus a policy may pass through two optional gates
// before distribution: OWNER_ACCEPTANCE (per-tenant toggle) then EXEC_REVIEW
// (category-triggered). Either gate can authorise onward or return to DRAFT.
const VALID_TRANSITIONS = {
  [STATUS.DRAFT]:              new Set([STATUS.UNDER_REVIEW]),
  [STATUS.UNDER_REVIEW]:       new Set([STATUS.DRAFT, STATUS.OWNER_ACCEPTANCE, STATUS.EXEC_REVIEW, STATUS.PENDING_ACCEPTANCE]),
  [STATUS.OWNER_ACCEPTANCE]:   new Set([STATUS.DRAFT, STATUS.EXEC_REVIEW, STATUS.PENDING_ACCEPTANCE]),
  [STATUS.EXEC_REVIEW]:        new Set([STATUS.DRAFT, STATUS.PENDING_ACCEPTANCE]),
  [STATUS.PENDING_ACCEPTANCE]: new Set([STATUS.ACTIVE]),
  [STATUS.ACTIVE]:             new Set([STATUS.UNDER_REVIEW, STATUS.RETIRED]),
  [STATUS.RETIRED]:            new Set(),
};

// ─── Status transitions ──────────────────────────────────────────────────────

/**
 * Validate and apply a status transition.
 * Throws if the transition is not permitted.
 *
 * @param {object} policy   - Current policy register record
 * @param {string} toStatus - Target status
 * @returns {object} Updated policy record (not yet persisted)
 */
function transition(policy, toStatus) {
  const allowed = VALID_TRANSITIONS[policy.status];
  if (!allowed || !allowed.has(toStatus)) {
    throw new Error(
      `Invalid status transition: ${policy.status} → ${toStatus} for policy ${policy.policy_id}`
    );
  }

  return {
    ...policy,
    status:       toStatus,
    last_updated: new Date().toISOString(),
  };
}

// ─── Version management ──────────────────────────────────────────────────────

/**
 * Parse a version string into major and minor components.
 * @param {string} version - e.g. 'v1.3'
 * @returns {{ major: number, minor: number }}
 */
function parseVersion(version) {
  const match = version.replace(/^v/, '').match(/^(\d+)\.(\d+)$/);
  if (!match) throw new Error(`Invalid version format: ${version}`);
  return { major: parseInt(match[1], 10), minor: parseInt(match[2], 10) };
}

/**
 * Format major and minor into a version string.
 * @param {number} major
 * @param {number} minor
 * @returns {string} e.g. 'v2.3'
 */
function formatVersion(major, minor) {
  return `v${major}.${minor}`;
}

/**
 * Increment the minor version (new draft iteration).
 * e.g. v1.3 → v1.4
 */
function incrementMinor(currentVersion) {
  const { major, minor } = parseVersion(currentVersion);
  return formatVersion(major, minor + 1);
}

/**
 * Promote to next major version (policy authorised and published).
 * e.g. v1.3 → v2.0
 */
function promoteToMajor(currentVersion) {
  const { major } = parseVersion(currentVersion);
  return formatVersion(major + 1, 0);
}

// ─── Policy ID generation ────────────────────────────────────────────────────

/**
 * Generate the next policy ID for the current year.
 * Requires the current highest NNN for this year from the database.
 *
 * @param {number} lastSequence - Highest NNN used this year (0 if none)
 * @returns {string} e.g. 'POL-2025-001'
 */
function generatePolicyId(lastSequence = 0) {
  const year = new Date().getFullYear();
  const seq  = String(lastSequence + 1).padStart(3, '0');
  return `POL-${year}-${seq}`;
}

// ─── Review date calculation ─────────────────────────────────────────────────

/**
 * Calculate the next review date from authorisation date and frequency.
 *
 * @param {string|Date} authorisedDate
 * @param {number}      frequencyMonths
 * @returns {string} ISO date string (YYYY-MM-DD)
 */
function calculateNextReviewDate(authorisedDate, frequencyMonths) {
  // Work in UTC throughout: 'YYYY-MM-DD' strings parse as UTC midnight, so
  // local-time month arithmetic can shift the result a day across DST.
  const date = new Date(authorisedDate);
  date.setUTCMonth(date.getUTCMonth() + frequencyMonths);
  return date.toISOString().split('T')[0];
}

// ─── register.json builder ───────────────────────────────────────────────────

/**
 * Build an initial register.json object for a new policy.
 *
 * @param {object} opts
 * @returns {object} register.json payload
 */
function buildInitialRegister({
  policyId,
  title,
  category,
  ownerEmail,
  authoriserEmails,
  applicableRoles,
  reviewFrequencyMonths,
  liquidfilesFolderIds,
  acknowledgementTotal,
}) {
  return {
    policy_id:                policyId,
    title,
    category,
    owner:                    ownerEmail,
    current_version:          'v0.1',
    status:                   STATUS.DRAFT,
    authorised_date:          null,
    authorised_by:            authoriserEmails,
    review_frequency_months:  reviewFrequencyMonths,
    next_review_date:         null,
    applicable_roles:         applicableRoles,
    liquidfiles_folder_id:    liquidfilesFolderIds.root,
    liquidfiles_folder_ids:   liquidfilesFolderIds,
    acknowledgement_count:    0,
    acknowledgement_total:    acknowledgementTotal,
    last_updated:             new Date().toISOString(),
  };
}

module.exports = {
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
};
