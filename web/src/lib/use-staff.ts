"use client";

/**
 * Staff directory hook — tenant members from GET /api/users, with the same
 * demo fallback the register uses while signed out or unreachable. Mutations
 * (invite / role change / remove) are issued from the view via apiFetch.
 */

import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/use-auth";
import { type DataSource, isSignedOut } from "@/lib/use-register";

export type StaffUser = {
  id: string;
  email: string;
  role: string;
  created_at: string | null;
};

/** Roles a tenant admin can assign through the UI (howldr_support is
 *  cross-tenant and provisioned out-of-band, so it's display-only). */
export const ASSIGNABLE_ROLES = [
  "admin",
  "owner",
  "authoriser",
  "governance_lead",
  "acceptor",
  "staff",
  "viewer",
] as const;

export const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  owner: "Owner",
  authoriser: "Approver",
  governance_lead: "Governance lead",
  acceptor: "Acceptor",
  staff: "Staff",
  viewer: "Viewer",
  howldr_support: "howldr support",
};

// acceptor, staff, and viewer are deliberately separate categories: an
// acceptor is a named signer (risk acceptance, executive sign-off, review
// attestation), staff is the workforce (receives and accepts policies), and
// viewer is an observer account (auditors, external assessors, SIEM
// integrations) with tenant-wide read.
export const ROLE_HINTS: Record<string, string> = {
  admin: "Full access — manage policies, users, and settings",
  owner: "Drafts and submits the policies they own",
  authoriser: "Approves or returns policies assigned to them",
  governance_lead: "Read-only oversight and overdue escalations",
  acceptor: "Named signer — accepts risks, gives executive sign-off, attests reviews",
  staff: "Workforce member — sees published policies only; accepts via secure delivery",
  viewer: "Observer — read-only across the workspace (auditors, assessors, SIEM)",
  howldr_support: "Cross-tenant howldr support",
};

const DEMO_STAFF: StaffUser[] = [
  { id: "demo-1", email: "admin@acme.example", role: "admin", created_at: "2026-01-05" },
  { id: "demo-2", email: "dpo@acme.example", role: "owner", created_at: "2026-01-12" },
  { id: "demo-3", email: "ciso@acme.example", role: "authoriser", created_at: "2026-02-01" },
  { id: "demo-4", email: "legal@acme.example", role: "authoriser", created_at: "2026-02-03" },
  { id: "demo-5", email: "auditor@acme.example", role: "viewer", created_at: "2026-03-20" },
  { id: "demo-6", email: "sam@acme.example", role: "staff", created_at: "2026-04-02" },
  { id: "demo-7", email: "ceo@acme.example", role: "acceptor", created_at: "2026-04-10" },
];

export type StaffState = {
  users: StaffUser[];
  source: DataSource;
  loading: boolean;
  error: string | null;
  reload: () => void;
};

export function useStaff(): StaffState {
  const { ready, contextKey } = useAuth();
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const [state, setState] = useState<Omit<StaffState, "reload">>({
    users: DEMO_STAFF,
    source: "demo",
    loading: true,
    error: null,
  });

  useEffect(() => {
    if (!ready) return;
    let active = true;
    apiFetch<StaffUser[]>("/api/users")
      .then((rows) => {
        if (!active) return;
        setState({ users: rows, source: "live", loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (!active) return;
        setState({
          users: DEMO_STAFF,
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
