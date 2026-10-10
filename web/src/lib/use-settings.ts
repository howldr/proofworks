"use client";

/**
 * Workspace settings hook — read-only tenant config from GET /api/settings,
 * with the usual demo fallback while signed out or unreachable.
 */

import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/use-auth";
import { type DataSource, isSignedOut } from "@/lib/use-register";

export type Cadence = {
  acceptanceReminderDays: number[];
  reviewAdvanceNoticeDays: number;
  reviewGracePeriodDays: number;
  governanceLeadEmail: string | null;
  scope: string;
};

export type Settings = {
  tenant: {
    slug: string;
    name: string;
    custom_domain: string | null;
    lf_share_name: string;
    status: string;
    created_at: string | null;
  };
  cadence: Cadence;
  /** Policy categories that require executive sign-off before distribution. */
  execRequiredCategories: string[];
  /** Whether the owner must explicitly accept the authorised version. */
  ownerAcceptanceRequired: boolean;
  /** The workspace's presentation theme (a curated preset key, or "custom"). */
  theme: string;
  /** Preset keys the API accepts — the picker renders from the app's list. */
  themes?: string[];
  /** #rrggbb accent behind the "custom" theme (usually logo-derived). */
  themeAccent?: string | null;
  /** Workspace logo as a small data URL, or null. */
  logo?: string | null;
  integrations: {
    liquidFiles: { configured: boolean; host: string | null };
    invites: { configured: boolean };
    app: { host: string | null };
  };
};

const DEMO_SETTINGS: Settings = {
  tenant: {
    slug: "acme",
    name: "Acme Corporation",
    custom_domain: null,
    lf_share_name: "policies",
    status: "active",
    created_at: "2026-01-01",
  },
  cadence: {
    acceptanceReminderDays: [3, 7, 14],
    reviewAdvanceNoticeDays: 30,
    reviewGracePeriodDays: 30,
    governanceLeadEmail: null,
    scope: "workspace",
  },
  execRequiredCategories: ["Security", "Compliance"],
  ownerAcceptanceRequired: false,
  theme: "howldr",
  themeAccent: null,
  logo: null,
  integrations: {
    liquidFiles: { configured: true, host: "files.example.com" },
    invites: { configured: true },
    app: { host: "policyhub.example.com" },
  },
};

export type SettingsState = {
  settings: Settings;
  source: DataSource;
  loading: boolean;
  error: string | null;
  /** Re-fetch settings — call after a successful edit. */
  reload: () => void;
};

export function useSettings(): SettingsState {
  const { ready, contextKey } = useAuth();
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const [state, setState] = useState<Omit<SettingsState, "reload">>({
    settings: DEMO_SETTINGS,
    source: "demo",
    loading: true,
    error: null,
  });

  useEffect(() => {
    if (!ready) return;
    let active = true;
    apiFetch<Settings>("/api/settings")
      .then((s) => {
        if (!active) return;
        setState({ settings: s, source: "live", loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (!active) return;
        setState({
          settings: DEMO_SETTINGS,
          source: "demo",
          loading: false,
          error: isSignedOut(err)
            ? null
            : err instanceof Error
              ? err.message
              : String(err),
        });
      });
    return () => {
      active = false;
    };
  }, [ready, contextKey, tick]);

  return { ...state, reload };
}
