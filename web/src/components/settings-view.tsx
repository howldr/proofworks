"use client";

import { useRef, useState } from "react";
import {
  Building2,
  CalendarClock,
  CheckCircle2,
  Image as ImageIcon,
  Loader2,
  Lock,
  Palette,
  Plug,
  Save,
  ShieldCheck,
  Sparkles,
  Upload,
  UserCheck,
  XCircle,
} from "lucide-react";

import { AudienceGroupsCard } from "@/components/audience-groups-card";
import { DataSourceBadge } from "@/components/data-source-badge";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api";
import {
  applyTenantTheme,
  CUSTOM_THEME,
  extractAccentFromImage,
  THEMES,
} from "@/lib/themes";
import { useAuth } from "@/lib/use-auth";
import { type Cadence, useSettings } from "@/lib/use-settings";

const READ_ROLES = new Set(["admin", "governance_lead", "howldr_support"]);

// Mirrors the category list on the New/Edit policy forms.
const CATEGORIES = [
  "IT",
  "Security",
  "Privacy",
  "HR",
  "Compliance",
  "Health & Safety",
  "Operations",
  "Other",
];

function Row({
  label,
  value,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

function ConfiguredBadge({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="flex items-center gap-1 text-sm text-emerald-700 dark:text-emerald-400">
      <CheckCircle2 className="size-4" />
      Connected
    </span>
  ) : (
    <span className="flex items-center gap-1 text-sm text-muted-foreground">
      <XCircle className="size-4" />
      Not configured
    </span>
  );
}

export function SettingsView() {
  const { me, status } = useAuth();
  const { settings, source, loading, error, reload } = useSettings();

  if (status === "signed-in" && me != null && !READ_ROLES.has(me.role)) {
    return (
      <>
        <Header source={source} error={error} loading={loading} />
        <EmptyState
          icon={Lock}
          title="Restricted"
          description="Workspace settings are available to admins and governance leads."
        />
      </>
    );
  }

  if (loading) {
    return (
      <>
        <Header source={source} error={error} loading={loading} />
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-52 w-full" />
          <Skeleton className="h-52 w-full" />
        </div>
      </>
    );
  }

  const { tenant, cadence, integrations } = settings;
  const canEditCadence =
    source === "live" &&
    (me?.role === "admin" || me?.role === "howldr_support");
  // Audiences: governance leads run distributions, so they can manage these
  // too (unlike cadence, which stays admin-only).
  const canEditGroups =
    source === "live" &&
    (me?.role === "admin" ||
      me?.role === "governance_lead" ||
      me?.role === "howldr_support");

  return (
    <>
      <Header source={source} error={error} loading={loading} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="size-4 text-muted-foreground" />
              Workspace
            </CardTitle>
            <CardDescription>Tenant identity and document store.</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            <Row label="Name" value={tenant.name} />
            <Row label="Slug" value={<code className="text-xs">{tenant.slug}</code>} />
            <Row
              label="Custom domain"
              value={tenant.custom_domain ?? "—"}
            />
            <Row
              label="Document share"
              value={<code className="text-xs">{tenant.lf_share_name}</code>}
            />
            <Row
              label="Status"
              value={
                <Badge
                  variant="outline"
                  className={
                    tenant.status === "active"
                      ? "border-emerald-600/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : "text-muted-foreground"
                  }
                >
                  {tenant.status}
                </Badge>
              }
            />
          </CardContent>
        </Card>

        <CadenceCard
          cadence={cadence}
          canEdit={canEditCadence}
          onSaved={reload}
        />

        <ExecCategoriesCard
          selected={settings.execRequiredCategories}
          canEdit={canEditCadence}
          onSaved={reload}
        />

        <OwnerAcceptanceCard
          enabled={settings.ownerAcceptanceRequired}
          canEdit={canEditCadence}
          onSaved={reload}
        />

        <AppearanceCard
          theme={settings.theme}
          themeAccent={settings.themeAccent ?? null}
          logo={settings.logo ?? null}
          canEdit={canEditCadence}
          onSaved={reload}
        />

        <AudienceGroupsCard canEdit={canEditGroups} />

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Plug className="size-4 text-muted-foreground" />
              Integrations
            </CardTitle>
            <CardDescription>
              Connections this workspace relies on. Configured by howldr.
            </CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            <Row
              label={
                <>
                  Secure file delivery
                  {integrations.liquidFiles.host && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {integrations.liquidFiles.host}
                    </span>
                  )}
                </>
              }
              value={<ConfiguredBadge ok={integrations.liquidFiles.configured} />}
            />
            <Row
              label="User invitations"
              value={<ConfiguredBadge ok={integrations.invites.configured} />}
            />
            <Row
              label={
                <>
                  Application link
                  {integrations.app.host && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {integrations.app.host}
                    </span>
                  )}
                </>
              }
              value={<ConfiguredBadge ok={Boolean(integrations.app.host)} />}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

/** Reminder/review cadence — editable for admins, read-only otherwise. */
function CadenceCard({
  cadence,
  canEdit,
  onSaved,
}: {
  cadence: Cadence;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [advance, setAdvance] = useState(String(cadence.reviewAdvanceNoticeDays));
  const [grace, setGrace] = useState(String(cadence.reviewGracePeriodDays));
  const [reminders, setReminders] = useState(
    cadence.acceptanceReminderDays.join(", "),
  );
  const [govEmail, setGovEmail] = useState(cadence.governanceLeadEmail ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function parseReminders(s: string): number[] | null {
    const nums = s.split(/[\s,]+/).filter(Boolean).map(Number);
    if (
      nums.length === 0 ||
      nums.some((n) => !Number.isInteger(n) || n < 1 || n > 365)
    )
      return null;
    return Array.from(new Set(nums)).sort((a, b) => a - b);
  }

  async function save() {
    setError(null);
    setSaved(false);
    const adv = Number(advance);
    const gr = Number(grace);
    const rem = parseReminders(reminders);
    if (!Number.isInteger(adv) || adv < 0 || adv > 365) {
      setError("Review advance notice must be 0–365 days.");
      return;
    }
    if (!Number.isInteger(gr) || gr < 0 || gr > 365) {
      setError("Overdue grace period must be 0–365 days.");
      return;
    }
    if (rem === null) {
      setError("Acceptance reminders must be day numbers between 1 and 365.");
      return;
    }
    setBusy(true);
    try {
      await apiFetch("/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          reviewAdvanceNoticeDays: adv,
          reviewGracePeriodDays: gr,
          acceptanceReminderDays: rem,
          governanceLeadEmail: govEmail.trim() || undefined,
        }),
      });
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="size-4 text-muted-foreground" />
          Reminder &amp; review cadence
        </CardTitle>
        <CardDescription>
          {canEdit
            ? "Workspace-specific. Changes apply to the next cycle — not policies already mid-review."
            : "Workspace-specific cadence."}
        </CardDescription>
      </CardHeader>

      {canEdit ? (
        <CardContent className="flex flex-col gap-4">
          <Field
            label="Acceptance reminders"
            hint="Comma-separated days after distribution (e.g. 3, 7, 14)."
          >
            <Input
              value={reminders}
              onChange={(e) => setReminders(e.target.value)}
              disabled={busy}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Review advance notice" hint="Days before due">
              <Input
                type="number"
                min={0}
                max={365}
                value={advance}
                onChange={(e) => setAdvance(e.target.value)}
                disabled={busy}
              />
            </Field>
            <Field label="Overdue grace period" hint="Days after due">
              <Input
                type="number"
                min={0}
                max={365}
                value={grace}
                onChange={(e) => setGrace(e.target.value)}
                disabled={busy}
              />
            </Field>
          </div>
          <Field
            label="Governance lead email"
            hint="Receives overdue-review escalations."
          >
            <Input
              type="email"
              value={govEmail}
              onChange={(e) => setGovEmail(e.target.value)}
              placeholder="governance@company.com"
              disabled={busy}
            />
          </Field>
          <div className="flex items-center gap-3">
            <Button onClick={save} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Save />}
              Save cadence
            </Button>
            {saved && (
              <span className="text-sm text-emerald-700 dark:text-emerald-400">
                Saved.
              </span>
            )}
            {error && <span className="text-sm text-destructive">{error}</span>}
          </div>
        </CardContent>
      ) : (
        <CardContent className="divide-y">
          <Row
            label="Acceptance reminders"
            value={
              cadence.acceptanceReminderDays.length
                ? `Day ${cadence.acceptanceReminderDays.join(", ")}`
                : "—"
            }
          />
          <Row
            label="Review advance notice"
            value={`${cadence.reviewAdvanceNoticeDays} days before`}
          />
          <Row
            label="Overdue grace period"
            value={`${cadence.reviewGracePeriodDays} days`}
          />
          <Row label="Governance lead" value={cadence.governanceLeadEmail ?? "—"} />
        </CardContent>
      )}
    </Card>
  );
}

/** Which policy categories require executive sign-off before distribution. */
function ExecCategoriesCard({
  selected,
  canEdit,
  onSaved,
}: {
  selected: string[];
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [chosen, setChosen] = useState<string[]>(selected);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(cat: string) {
    setSaved(false);
    setChosen((cs) =>
      cs.includes(cat) ? cs.filter((c) => c !== cat) : [...cs, cat],
    );
  }

  async function save() {
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      await apiFetch("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ execRequiredCategories: chosen }),
      });
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="size-4 text-muted-foreground" />
          Executive sign-off
        </CardTitle>
        <CardDescription>
          {canEdit
            ? "Policies in these categories need a named executive to approve them after the approvers, before distribution."
            : "Categories that require executive approval before distribution."}
        </CardDescription>
      </CardHeader>

      {canEdit ? (
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((cat) => {
              const on = chosen.includes(cat);
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => toggle(cat)}
                  disabled={busy}
                  className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                    on
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input text-muted-foreground hover:border-ring"
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={save} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Save />}
              Save categories
            </Button>
            {saved && (
              <span className="text-sm text-emerald-700 dark:text-emerald-400">
                Saved.
              </span>
            )}
            {error && <span className="text-sm text-destructive">{error}</span>}
          </div>
        </CardContent>
      ) : (
        <CardContent>
          <Row
            label="Requires executive sign-off"
            value={selected.length ? selected.join(", ") : "None"}
          />
        </CardContent>
      )}
    </Card>
  );
}

/** Whether the owner must explicitly accept the authorised version before it
 *  advances (a per-tenant toggle). */
function OwnerAcceptanceCard({
  enabled,
  canEdit,
  onSaved,
}: {
  enabled: boolean;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: boolean) {
    setError(null);
    setSaved(false);
    setBusy(true);
    setOn(next);
    try {
      await apiFetch("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ ownerAcceptanceRequired: next }),
      });
      setSaved(true);
      onSaved();
    } catch (err) {
      setOn(!next); // revert the optimistic toggle
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserCheck className="size-4 text-muted-foreground" />
          Owner acceptance
        </CardTitle>
        <CardDescription>
          When on, the policy owner must explicitly accept the approved version
          after the approvers, before it advances.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {canEdit ? (
          <div className="flex items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={on}
              onClick={() => save(!on)}
              disabled={busy}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                on ? "bg-primary" : "bg-input"
              }`}
            >
              <span
                className={`inline-block size-5 rounded-full bg-background transition-transform ${
                  on ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </button>
            <span className="text-sm">
              {on ? "Required" : "Not required"}
            </span>
            {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
            {saved && !busy && (
              <span className="text-sm text-emerald-700 dark:text-emerald-400">
                Saved.
              </span>
            )}
            {error && <span className="text-sm text-destructive">{error}</span>}
          </div>
        ) : (
          <Row
            label="Owner acceptance"
            value={enabled ? "Required" : "Not required"}
          />
        )}
      </CardContent>
    </Card>
  );
}

/** Appearance: preset theme picker, workspace logo, and the one generated
 *  option — a "custom" theme derived from the logo's dominant colour. All of
 *  it is curated --brand swaps or a single validated hex, never free-form
 *  CSS. Applies immediately on save so the admin sees it without a reload. */
const LOGO_MAX_BYTES = 64 * 1024;
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

function AppearanceCard({
  theme,
  themeAccent,
  logo,
  canEdit,
  onSaved,
}: {
  theme: string;
  themeAccent: string | null;
  logo: string | null;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [selected, setSelected] = useState(theme);
  const [accent, setAccent] = useState<string | null>(themeAccent);
  const [logoUrl, setLogoUrl] = useState<string | null>(logo);
  const [suggested, setSuggested] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function put(body: Record<string, unknown>, apply: () => void): Promise<boolean> {
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      await apiFetch("/api/settings", { method: "PUT", body: JSON.stringify(body) });
      apply(); // live-swap — no reload needed
      setSaved(true);
      onSaved();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function saveTheme(next: string, nextAccent?: string) {
    const previous = { selected, accent };
    setSelected(next);
    if (nextAccent) setAccent(nextAccent);
    void put(
      nextAccent ? { theme: next, themeAccent: nextAccent } : { theme: next },
      () => applyTenantTheme(next, nextAccent ?? accent),
    ).then((ok) => {
      if (!ok) {
        setSelected(previous.selected);
        setAccent(previous.accent);
      }
    });
  }

  function onLogoPicked(file: File | undefined) {
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) {
      setError("Use a PNG, JPEG, WebP, or SVG image.");
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      setError("Logo must be under 64KB — export it smaller or compress it.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      setLogoUrl(dataUrl);
      void put({ logo: dataUrl }, () => {});
      // Offer a theme generated from the logo's dominant colour.
      void extractAccentFromImage(dataUrl).then(setSuggested);
    };
    reader.readAsDataURL(file);
  }

  function removeLogo() {
    setLogoUrl(null);
    setSuggested(null);
    void put({ logo: null }, () => {});
  }

  const current = THEMES.find((t) => t.key === selected);
  const currentSwatch =
    selected === CUSTOM_THEME ? (accent ?? undefined) : current?.swatch;
  const currentLabel =
    selected === CUSTOM_THEME ? "Custom" : (current?.label ?? selected);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Palette className="size-4 text-muted-foreground" />
          Appearance
        </CardTitle>
        <CardDescription>
          Your logo and a curated theme — an accent color and font set, like
          an Office theme — applied across the app for everyone in this
          workspace, with a &ldquo;by howldr&rdquo; byline.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {canEdit ? (
          <>
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Workspace logo
              </span>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex h-10 min-w-10 items-center justify-center overflow-hidden rounded-lg border bg-white px-1.5">
                  {logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logoUrl} alt="Workspace logo" className="h-8 max-w-32 object-contain" />
                  ) : (
                    <ImageIcon className="size-4 text-muted-foreground" />
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept={LOGO_TYPES.join(",")}
                  className="hidden"
                  onChange={(e) => {
                    onLogoPicked(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload /> {logoUrl ? "Replace" : "Upload"}
                </Button>
                {logoUrl && (
                  <Button variant="ghost" size="sm" disabled={busy} onClick={removeLogo}>
                    Remove
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Shown in the app header with your workspace name and a discrete
                &ldquo;ProofWorks · by howldr&rdquo;. PNG, JPEG, WebP, or SVG,
                under 64KB.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Theme
              </span>
              <div className="flex flex-wrap gap-2">
                {THEMES.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => saveTheme(t.key)}
                    disabled={busy}
                    aria-pressed={selected === t.key}
                    className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors hover:bg-muted/50 ${
                      selected === t.key ? "border-brand ring-2 ring-brand/30" : "border-border"
                    }`}
                  >
                    <span
                      className="inline-block size-4 shrink-0 rounded-full border border-black/10"
                      style={{ backgroundColor: t.swatch }}
                    />
                    <span
                      className="flex flex-col items-start leading-tight"
                      style={{ fontFamily: `var(${t.fontVar})` }}
                    >
                      {t.label}
                      <span className="text-xs text-muted-foreground">
                        {t.fontLabel}
                      </span>
                    </span>
                  </button>
                ))}
                {accent && (
                  <button
                    type="button"
                    onClick={() => saveTheme(CUSTOM_THEME)}
                    disabled={busy}
                    aria-pressed={selected === CUSTOM_THEME}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors hover:bg-muted/50 ${
                      selected === CUSTOM_THEME ? "border-brand ring-2 ring-brand/30" : "border-border"
                    }`}
                  >
                    <span
                      className="inline-block size-4 rounded-full border border-black/10"
                      style={{ backgroundColor: accent }}
                    />
                    Custom
                  </button>
                )}
              </div>
              {suggested && suggested !== accent && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    saveTheme(CUSTOM_THEME, suggested);
                    setSuggested(null);
                  }}
                  className="flex w-fit items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm transition-colors hover:bg-muted/50"
                >
                  <Sparkles className="size-4 text-muted-foreground" />
                  <span
                    className="inline-block size-4 rounded-full border border-black/10"
                    style={{ backgroundColor: suggested }}
                  />
                  Use a theme generated from your logo
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 text-sm">
              {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
              {saved && !busy && (
                <span className="text-emerald-700 dark:text-emerald-400">Saved.</span>
              )}
              {error && <span className="text-destructive">{error}</span>}
            </div>
          </>
        ) : (
          <>
            <Row
              label="Theme"
              value={
                <span className="flex items-center gap-2">
                  {currentSwatch && (
                    <span
                      className="inline-block size-3.5 rounded-full border border-black/10"
                      style={{ backgroundColor: currentSwatch }}
                    />
                  )}
                  {currentLabel}
                </span>
              }
            />
            <p className="text-xs text-muted-foreground">
              Only workspace admins can change the logo and theme.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Header({
  source,
  error,
  loading,
}: {
  source: "live" | "demo";
  error: string | null;
  loading: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        {!loading && <DataSourceBadge source={source} error={error} />}
      </div>
      <p className="text-sm text-muted-foreground">
        Workspace configuration, cadence, and integration status.
      </p>
    </div>
  );
}
