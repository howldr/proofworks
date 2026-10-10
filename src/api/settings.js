/**
 * howldr ProofWorks
 * Workspace settings
 *
 *   GET  /api/settings   read access (any tenant member)
 *   PUT  /api/settings   admin / howldr_support — edit reminder/review cadence
 *
 * Surfaces the tenant record, the tenant's reminder/review cadence (now
 * per-tenant, falling back to the historical env defaults), and whether the
 * LiquidFiles + invite integrations are configured. No secrets are returned —
 * only hostnames and booleans.
 */

const express = require('express');
const router  = express.Router();

const db = require('../db/db');
const { isInviteConfigured } = require('../auth/admin');
const { requireRole } = require('../middleware/auth');
const { THEME_KEYS, DEFAULT_THEME, CUSTOM_THEME } = require('../themes');

function intEnv(name, fallback) {
  const n = parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Default reminder-day offsets from env (comma-separated), fallback 3,7,14. */
function defaultReminderDays() {
  return (process.env.ACCEPTANCE_REMINDER_DAYS || '3,7,14')
    .split(',').map(s => parseInt(s, 10)).filter(Number.isFinite);
}

/** Effective cadence for a tenant: its own columns, or the env defaults. */
function cadenceOf(t) {
  return {
    acceptanceReminderDays: t.acceptance_reminder_days ?? defaultReminderDays(),
    reviewAdvanceNoticeDays: t.review_advance_notice_days ?? intEnv('REVIEW_ADVANCE_NOTICE_DAYS', 30),
    reviewGracePeriodDays:   t.review_grace_period_days ?? intEnv('REVIEW_GRACE_PERIOD_DAYS', 30),
    governanceLeadEmail:     t.governance_lead_email ?? (process.env.GOVERNANCE_LEAD_EMAIL || null),
    scope: 'workspace',
  };
}

/** Host portion of a URL, or null — so we never echo a full secret-bearing URL. */
function hostOf(url) {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

router.get('/', async (req, res) => {
  try {
    const t = req.tenant;
    res.json({
      tenant: {
        slug:          t.slug,
        name:          t.name,
        custom_domain: t.custom_domain || null,
        lf_share_name: t.lf_share_name,
        status:        t.status,
        created_at:    t.created_at,
      },
      cadence: cadenceOf(t),
      execRequiredCategories: t.exec_required_categories ?? [],
      ownerAcceptanceRequired: t.owner_acceptance_required ?? false,
      theme: t.theme ?? DEFAULT_THEME,
      themes: THEME_KEYS,
      themeAccent: t.theme_accent ?? null,
      logo: t.logo_data_url ?? null,
      integrations: {
        liquidFiles: {
          configured: Boolean(process.env.LIQUIDFILES_BASE_URL && process.env.LIQUIDFILES_API_KEY),
          host:       hostOf(process.env.LIQUIDFILES_BASE_URL),
        },
        invites: { configured: isInviteConfigured() },
        app:     { host: hostOf(process.env.APP_BASE_URL) },
      },
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── PUT /api/settings (admin) — edit reminder/review cadence ─────────────────

function validDayInt(v) {
  return v === undefined || v === null || (Number.isInteger(v) && v >= 0 && v <= 365);
}

// Appearance guards. The logo is a small inline data-URL image (SVG is safe
// here: data-URL images in <img> never execute scripts). The cap keeps the
// whole request inside express.json()'s 100kb default body limit.
const ACCENT_RE = /^#[0-9a-fA-F]{6}$/;
const LOGO_RE   = /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/;
const LOGO_MAX  = 90_000; // chars ≈ 64KB of image

router.put('/', requireRole(['admin', 'howldr_support']), async (req, res) => {
  try {
    const {
      reviewAdvanceNoticeDays, reviewGracePeriodDays, acceptanceReminderDays, governanceLeadEmail,
      execRequiredCategories, ownerAcceptanceRequired, theme, themeAccent, logo,
    } = req.body || {};

    const errors = [];
    if (theme !== undefined && theme !== CUSTOM_THEME && !THEME_KEYS.includes(theme)) {
      errors.push(`theme must be one of: ${THEME_KEYS.join(', ')}, ${CUSTOM_THEME}`);
    }
    if (themeAccent !== undefined && themeAccent !== null && !ACCENT_RE.test(themeAccent)) {
      errors.push('themeAccent must be a #rrggbb color');
    }
    if (theme === CUSTOM_THEME && !(themeAccent ?? req.tenant.theme_accent)) {
      errors.push('the custom theme needs a themeAccent color');
    }
    if (logo !== undefined && logo !== null) {
      if (typeof logo !== 'string' || !LOGO_RE.test(logo)) {
        errors.push('logo must be a PNG, JPEG, WebP, or SVG data URL');
      } else if (logo.length > LOGO_MAX) {
        errors.push('logo must be under ~64KB — resize or compress it');
      }
    }
    if (ownerAcceptanceRequired !== undefined && typeof ownerAcceptanceRequired !== 'boolean') {
      errors.push('ownerAcceptanceRequired must be a boolean');
    }
    if (!validDayInt(reviewAdvanceNoticeDays)) errors.push('reviewAdvanceNoticeDays must be an integer 0–365');
    if (!validDayInt(reviewGracePeriodDays))   errors.push('reviewGracePeriodDays must be an integer 0–365');

    let reminders;
    if (acceptanceReminderDays !== undefined && acceptanceReminderDays !== null) {
      if (!Array.isArray(acceptanceReminderDays) ||
          acceptanceReminderDays.some(d => !Number.isInteger(d) || d < 1 || d > 365)) {
        errors.push('acceptanceReminderDays must be an array of integers 1–365');
      } else {
        // Dedupe + sort so reminders fire in order.
        reminders = Array.from(new Set(acceptanceReminderDays)).sort((a, b) => a - b);
      }
    }
    if (governanceLeadEmail !== undefined && governanceLeadEmail !== null &&
        governanceLeadEmail !== '' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(governanceLeadEmail)) {
      errors.push('governanceLeadEmail must be a valid email');
    }

    let execCategories;
    if (execRequiredCategories !== undefined && execRequiredCategories !== null) {
      if (!Array.isArray(execRequiredCategories) ||
          execRequiredCategories.some(c => typeof c !== 'string')) {
        errors.push('execRequiredCategories must be an array of category names');
      } else {
        execCategories = Array.from(new Set(execRequiredCategories.map(c => c.trim()).filter(Boolean)));
      }
    }
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });

    let updated = await db.updateTenantCadence(req.tenant.id, {
      reviewAdvanceNoticeDays,
      reviewGracePeriodDays,
      acceptanceReminderDays: reminders,
      governanceLeadEmail: governanceLeadEmail || undefined,
      execRequiredCategories: execCategories,
      ownerAcceptanceRequired,
    });
    if (theme !== undefined || themeAccent !== undefined || logo !== undefined) {
      updated = await db.updateTenantAppearance(req.tenant.id, {
        theme,
        themeAccent,
        logoDataUrl: logo,
      });
    }

    res.json({
      cadence: cadenceOf(updated),
      execRequiredCategories: updated.exec_required_categories ?? [],
      ownerAcceptanceRequired: updated.owner_acceptance_required ?? false,
      theme: updated.theme ?? DEFAULT_THEME,
      themeAccent: updated.theme_accent ?? null,
      logo: updated.logo_data_url ?? null,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
