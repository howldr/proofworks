"use client";

/**
 * Obligations Register hooks — GET /api/obligations with the usual demo
 * fallback while signed out or unreachable. Mutations are issued from the
 * views via apiFetch.
 *
 * The Understanding layer: an obligation is a commitment named by its source
 * (law, regulation, contract, insurance, standard, internal), linked to the
 * policies, risks, and evidence that answer it. One nothing links to is
 * UNANSWERED — the register's loudest signal.
 */

import { useCallback, useEffect, useState } from "react";

import { ApiError, apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/use-auth";
import { type DataSource, isSignedOut } from "@/lib/use-register";

export type ObligationSourceType =
  | "law"
  | "regulation"
  | "contract"
  | "insurance"
  | "standard"
  | "internal";

export type ObligationCoverage = "answered" | "unanswered" | "retired";

export type Obligation = {
  obligation_id: string;
  title: string;
  description: string | null;
  source_type: ObligationSourceType;
  source_name: string;
  source_ref: string | null;
  owner_email: string;
  next_review_date: string | null;
  policy_ids: string[];
  risk_ids: string[];
  evidence_ids: string[];
  status: "ACTIVE" | "RETIRED";
  created_by: string;
  created_at: string;
  coverage_state: ObligationCoverage;
};

export type ObligationEvent = {
  id: number;
  event: string;
  actor_email: string | null;
  created_at: string;
};

export type ObligationDetail = Obligation & {
  events: ObligationEvent[];
};

/** A back-link row: an obligation naming some policy/risk/evidence item. */
export type LinkedObligation = {
  obligation_id: string;
  title: string;
  source_type: ObligationSourceType;
  source_name: string;
  source_ref: string | null;
  status: "ACTIVE" | "RETIRED";
};

export const SOURCE_TYPES: {
  value: ObligationSourceType;
  label: string;
  hint: string;
}[] = [
  { value: "law",        label: "Law",        hint: "An act or statute, e.g. the Data Protection Act" },
  { value: "regulation", label: "Regulation", hint: "A regulator's rules, e.g. UK GDPR, FCA handbook" },
  { value: "contract",   label: "Contract",   hint: "A clause a client or partner holds you to" },
  { value: "insurance",  label: "Insurance",  hint: "A condition of cover, e.g. MFA required by the cyber policy" },
  { value: "standard",   label: "Standard",   hint: "A framework requirement, e.g. ISO 27001, Cyber Essentials" },
  { value: "internal",   label: "Internal",   hint: "A commitment the organization made to itself" },
];

export const SOURCE_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  SOURCE_TYPES.map((s) => [s.value, s.label]),
);

const DEMO_OBLIGATIONS: Obligation[] = [
  {
    obligation_id: "OBL-2026-003",
    title: "Notify the ICO of a personal data breach within 72 hours",
    description: null,
    source_type: "regulation",
    source_name: "UK GDPR",
    source_ref: "Art. 33",
    owner_email: "dpo@acme.example",
    next_review_date: "2027-05-01",
    policy_ids: ["POL-2026-002"],
    risk_ids: ["RSK-2026-002"],
    evidence_ids: [],
    status: "ACTIVE",
    created_by: "dpo@acme.example",
    created_at: "2026-06-01T09:00:00Z",
    coverage_state: "answered",
  },
  {
    obligation_id: "OBL-2026-002",
    title: "Maintain MFA on all administrator accounts",
    description: "Condition of cyber insurance cover — non-compliance voids the policy.",
    source_type: "insurance",
    source_name: "Cyber policy CP-2026-118",
    source_ref: "Condition 4(b)",
    owner_email: "it.director@acme.example",
    next_review_date: "2027-02-28",
    policy_ids: ["POL-2026-001"],
    risk_ids: [],
    evidence_ids: ["EVD-2026-002"],
    status: "ACTIVE",
    created_by: "ops.director@acme.example",
    created_at: "2026-05-20T09:00:00Z",
    coverage_state: "answered",
  },
  {
    obligation_id: "OBL-2026-001",
    title: "Retain client engagement records for 7 years",
    description: null,
    source_type: "contract",
    source_name: "MSA — Meridian Group",
    source_ref: "§12.3",
    owner_email: "ops.director@acme.example",
    next_review_date: null,
    policy_ids: [],
    risk_ids: [],
    evidence_ids: [],
    status: "ACTIVE",
    created_by: "ops.director@acme.example",
    created_at: "2026-04-15T09:00:00Z",
    coverage_state: "unanswered",
  },
];

export type ObligationsState = {
  obligations: Obligation[];
  source: DataSource;
  loading: boolean;
  error: string | null;
  notEnabled: boolean;
  reload: () => void;
};

export function useObligations(): ObligationsState {
  const { ready, contextKey } = useAuth();
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const [state, setState] = useState<Omit<ObligationsState, "reload">>({
    obligations: DEMO_OBLIGATIONS,
    source: "demo",
    loading: true,
    error: null,
    notEnabled: false,
  });

  useEffect(() => {
    if (!ready) return;
    let active = true;
    apiFetch<Obligation[]>("/api/obligations")
      .then((rows) => {
        if (!active) return;
        setState({ obligations: rows, source: "live", loading: false, error: null, notEnabled: false });
      })
      .catch((err: unknown) => {
        if (!active) return;
        const notEnabled =
          err instanceof ApiError && err.status === 403 && /module is not enabled/i.test(err.message);
        setState({
          obligations: DEMO_OBLIGATIONS,
          source: "demo",
          loading: false,
          notEnabled,
          error: notEnabled || isSignedOut(err)
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

export type ObligationDetailState = {
  obligation: ObligationDetail | null;
  source: DataSource;
  loading: boolean;
  error: string | null;
  notFound: boolean;
  reload: () => void;
};

export function useObligationDetail(id: string | null): ObligationDetailState {
  const { ready, contextKey } = useAuth();
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const [state, setState] = useState<Omit<ObligationDetailState, "reload">>({
    obligation: null,
    source: "demo",
    loading: true,
    error: null,
    notFound: false,
  });

  useEffect(() => {
    if (!id || !ready) return;
    let active = true;
    apiFetch<ObligationDetail>(`/api/obligations/${encodeURIComponent(id)}`)
      .then((obligation) => {
        if (!active) return;
        setState({ obligation, source: "live", loading: false, error: null, notFound: false });
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof ApiError && err.status === 404) {
          setState((s) => ({ ...s, loading: false, notFound: true }));
          return;
        }
        const demo = DEMO_OBLIGATIONS.find((d) => d.obligation_id === id) ?? null;
        setState({
          obligation: demo ? { ...demo, events: [] } : null,
          source: "demo",
          loading: false,
          error: isSignedOut(err) ? null : err instanceof Error ? err.message : String(err),
          notFound: !demo,
        });
      });
    return () => {
      active = false;
    };
  }, [id, ready, contextKey, tick]);

  if (!id) {
    return { obligation: null, source: "demo", loading: false, error: null, notFound: true, reload };
  }
  return { ...state, reload };
}
