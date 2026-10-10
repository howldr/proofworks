/**
 * howldr ProofWorks
 * Workspace theme presets (core — presentation)
 *
 * A theme is a curated preset, not free-form CSS: like an Office theme, each
 * key maps to a COLOUR + FONT set shipped with the web app (accent tokens,
 * surface tints, and a --font-sans swap in web/src/lib/themes.ts +
 * web/src/app/globals.css + fonts loaded in layout.tsx). The API validates
 * against this list; the web app renders it. Keep the files in sync when
 * adding a preset.
 *
 * 'howldr' is the default (hosted = howldr-branded gold) and has no CSS
 * override block — it IS the base tokens.
 */

const THEMES = {
  howldr:   { key: 'howldr',   label: 'howldr Gold' },
  slate:    { key: 'slate',    label: 'Slate' },
  forest:   { key: 'forest',   label: 'Forest' },
  ocean:    { key: 'ocean',    label: 'Ocean' },
  burgundy: { key: 'burgundy', label: 'Burgundy' },
};

const THEME_KEYS = Object.keys(THEMES);
const DEFAULT_THEME = 'howldr';

// The one generated theme: a single validated #rrggbb accent (usually
// extracted from the workspace logo) that the SPA derives a token set from.
// As constrained as a preset — a colour, never CSS.
const CUSTOM_THEME = 'custom';

module.exports = { THEMES, THEME_KEYS, DEFAULT_THEME, CUSTOM_THEME };
