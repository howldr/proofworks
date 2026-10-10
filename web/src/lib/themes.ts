/**
 * Workspace theme presets — the web half of src/themes.js (backend).
 *
 * A theme is a curated preset, not free-form CSS: each key has an override
 * block in globals.css scoped to [data-tenant-theme="<key>"], swapping the
 * --brand token (which --primary, --ring, and the sidebar accents follow).
 * Keep this list, src/themes.js, and globals.css in sync when adding one.
 *
 * 'howldr' is the default and has no override block — it IS the base tokens.
 *
 * 'custom' is the one generated theme: a single #rrggbb accent (typically
 * extracted from the workspace logo) from which the full token set is derived
 * here — still just as constrained as a preset, never arbitrary CSS.
 */

export type ThemeKey = "howldr" | "slate" | "forest" | "ocean" | "burgundy";

export type ThemePreset = {
  key: ThemeKey;
  label: string;
  swatch: string;
  /** Display name of the theme's font pairing (like an Office theme). */
  fontLabel: string;
  /** CSS variable carrying the font family, set by next/font in layout.tsx. */
  fontVar: string;
};

export const THEMES: ThemePreset[] = [
  { key: "howldr",   label: "howldr Gold", swatch: "#C9922A", fontLabel: "Geist",          fontVar: "--font-geist-sans" },
  { key: "slate",    label: "Slate",       swatch: "#5B7292", fontLabel: "IBM Plex Sans",  fontVar: "--font-ibm-plex-sans" },
  { key: "forest",   label: "Forest",      swatch: "#2E7D51", fontLabel: "Source Sans 3",  fontVar: "--font-source-sans" },
  { key: "ocean",    label: "Ocean",       swatch: "#2E6FA3", fontLabel: "Nunito Sans",    fontVar: "--font-nunito-sans" },
  { key: "burgundy", label: "Burgundy",    swatch: "#96404A", fontLabel: "Libre Franklin", fontVar: "--font-libre-franklin" },
];

export const DEFAULT_THEME: ThemeKey = "howldr";
export const CUSTOM_THEME = "custom";

const ACCENT_RE = /^#[0-9a-fA-F]{6}$/;
const STYLE_ID = "tenant-custom-theme";

/** Perceived lightness (WCAG-ish) of a #rrggbb colour, 0–255. */
function luma(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Derive the full token block from one accent colour. color-mix keeps the
 *  light/dark variants in the browser — nothing user-authored reaches CSS
 *  beyond the strictly validated hex. */
function customThemeCss(accent: string): string {
  const fg = luma(accent) > 150 ? "oklch(0.2 0 0)" : "oklch(0.98 0 0)";
  return `
:root[data-tenant-theme="custom"] {
  --brand: ${accent};
  --brand-foreground: ${fg};
  --background: color-mix(in oklab, ${accent} 2%, oklch(0.99 0 0));
  --sidebar: color-mix(in oklab, ${accent} 10%, oklch(0.19 0 0));
  --sidebar-accent: color-mix(in oklab, ${accent} 18%, transparent);
  --sidebar-accent-foreground: color-mix(in oklab, ${accent} 55%, white);
}
.dark[data-tenant-theme="custom"] {
  --brand: color-mix(in oklab, ${accent} 72%, white);
  --brand-foreground: color-mix(in oklab, ${accent} 35%, black);
  --background: color-mix(in oklab, ${accent} 4%, oklch(0.145 0 0));
  --sidebar: color-mix(in oklab, ${accent} 8%, oklch(0.205 0 0));
}`;
}

/** Apply (or clear) the tenant theme on <html>. The default theme removes the
 *  attribute so the base tokens apply untouched. 'custom' injects a derived
 *  token block for the given accent. */
export function applyTenantTheme(
  theme: string | null | undefined,
  accent?: string | null,
) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const injected = document.getElementById(STYLE_ID);

  if (theme === CUSTOM_THEME && accent && ACCENT_RE.test(accent)) {
    const el =
      injected ?? Object.assign(document.createElement("style"), { id: STYLE_ID });
    el.textContent = customThemeCss(accent);
    if (!injected) document.head.appendChild(el);
    root.dataset.tenantTheme = CUSTOM_THEME;
    return;
  }

  injected?.remove();
  if (!theme || theme === DEFAULT_THEME || !THEMES.some((t) => t.key === theme)) {
    delete root.dataset.tenantTheme;
  } else {
    root.dataset.tenantTheme = theme;
  }
}

// ─── Accent extraction (logo → suggested theme colour) ───────────────────────

function hueBucket(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return Math.floor(h / 30) % 12;
}

/** Pull the dominant saturated colour out of an image (the uploaded logo) and
 *  return it as #rrggbb, nudged into a lightness band that works as an accent.
 *  Resolves null when nothing usable stands out (grey/mono logos, SVGs the
 *  canvas can't rasterise) — callers just skip the suggestion then. */
export function extractAccentFromImage(src: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const size = 48;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(null);
      try {
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);
        const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
          if (a < 200) continue;
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          if (max === 0 || (max - min) / max < 0.25) continue; // greys
          if (max < 40 || min > 235) continue; // near-black / near-white
          const key = hueBucket(r, g, b);
          const cur = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
          cur.n += 1; cur.r += r; cur.g += g; cur.b += b;
          buckets.set(key, cur);
        }
        const best = [...buckets.values()].sort((x, y) => y.n - x.n)[0];
        if (!best || best.n < 12) return resolve(null);
        let r = best.r / best.n, g = best.g / best.n, b = best.b / best.n;
        // Nudge into an accent-friendly lightness band (not pastel, not murky).
        const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const target = Math.min(Math.max(l, 70), 140);
        const scale = target / (l || 1);
        r = Math.min(255, r * scale); g = Math.min(255, g * scale); b = Math.min(255, b * scale);
        const hex = (v: number) => Math.round(v).toString(16).padStart(2, "0");
        resolve(`#${hex(r)}${hex(g)}${hex(b)}`);
      } catch {
        resolve(null); // tainted canvas or unrasterisable SVG
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
