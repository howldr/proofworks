"use client";

/**
 * Risk Register hooks — GET /api/risks with the usual demo fallback while
 * signed out or unreachable. Mutations are issued from the views via apiFetch.
 */

import { useCallback, useEffect, useState } from "react";

import { ApiError, apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/use-auth";
import type { LinkedObligation } from "@/lib/use-obligations";
import { type DataSource, isSignedOut } from "@/lib/use-register";

export type RiskBand = "Low" | "Medium" | "High" | "Critical";
export type Treatment = "accept" | "mitigate" | "transfer" | "avoid";
export type AcceptanceState = "not_assessed" | "awaiting_acceptance" | "accepted";

/** Score → band, mirroring the server's thresholds (1–25). */
export function bandOf(score: number): RiskBand {
  if (score >= 16) return "Critical";
  if (score >= 10) return "High";
  if (score >= 5) return "Medium";
  return "Low";
}

/** Light row from the reverse lookups on policy/evidence detail responses. */
export type LinkedRisk = {
  risk_id: string;
  title: string;
  status: "OPEN" | "CLOSED";
  category: string | null;
  owner_email: string;
  round: number | null;
  residual_likelihood: number | null;
  residual_impact: number | null;
  accepted: boolean;
};

export type Risk = {
  risk_id: string;
  title: string;
  description: string | null;
  category: string | null;
  tags: string[];
  owner_email: string;
  acceptor_email: string | null;
  next_review_date: string | null;
  policy_ids: string[];
  evidence_ids: string[];
  status: "OPEN" | "CLOSED";
  created_by: string;
  created_at: string;
  // latest round, derived server-side (null when never assessed)
  round: number | null;
  inherent_likelihood?: number;
  inherent_impact?: number;
  residual_likelihood?: number;
  residual_impact?: number;
  treatment: Treatment | null;
  inherent_score: number | null;
  inherent_band: RiskBand | null;
  residual_score: number | null;
  residual_band: RiskBand | null;
  acceptance_state: AcceptanceState;
};

export type RiskAssessment = {
  id: number;
  round: number;
  inherent_likelihood: number;
  inherent_impact: number;
  residual_likelihood: number;
  residual_impact: number;
  treatment: Treatment;
  treatment_notes: string | null;
  assessed_by: string;
  created_at: string;
  inherent_score: number;
  inherent_band: RiskBand;
  residual_score: number;
  residual_band: RiskBand;
};

export type RiskAcceptance = {
  id: number;
  round: number;
  acceptor_email: string;
  notes: string | null;
  created_at: string;
};

export type RiskEvent = {
  id: number;
  event: string;
  actor_email: string | null;
  created_at: string;
};

export type RiskDetail = Risk & {
  effective_acceptor: string;
  assessments: RiskAssessment[];
  acceptances: RiskAcceptance[];
  events: RiskEvent[];
  /** Obligations naming this risk as a threat to what they require. */
  linked_obligations?: LinkedObligation[];
};

export const RISK_CATEGORIES = [
  "Technology",
  "Information Security",
  "Third Party",
  "Operational",
  "People",
  "Legal & Regulatory",
  "Financial",
  "Other",
];

export const TREATMENTS: { value: Treatment; label: string }[] = [
  { value: "mitigate", label: "Mitigate — reduce it with controls" },
  { value: "accept",   label: "Accept — take it as-is" },
  { value: "transfer", label: "Transfer — insure or outsource it" },
  { value: "avoid",    label: "Avoid — stop the activity" },
];

const DEMO_RISKS: Risk[] = [
  {
    risk_id: "RSK-2026-003",
    title: "Unpatched public-facing servers",
    description: "Internet-exposed estate misses the monthly patch window.",
    category: "Technology",
    tags: ["cyber-insurance"],
    owner_email: "it.director@acme.example",
    acceptor_email: "coo@acme.example",
    next_review_date: "2026-10-01",
    policy_ids: ["POL-2026-001"],
    evidence_ids: ["EVD-2026-003"],
    status: "OPEN",
    created_by: "it.director@acme.example",
    created_at: "2026-06-01T09:00:00Z",
    round: 2,
    treatment: "mitigate",
    inherent_score: 20,
    inherent_band: "Critical",
    residual_score: 8,
    residual_band: "Medium",
    acceptance_state: "awaiting_acceptance",
  },
  {
    risk_id: "RSK-2026-002",
    title: "Single supplier for payment processing",
    description: null,
    category: "Third Party",
    tags: [],
    owner_email: "cfo@acme.example",
    acceptor_email: null,
    next_review_date: "2027-01-15",
    policy_ids: [],
    evidence_ids: [],
    status: "OPEN",
    created_by: "cfo@acme.example",
    created_at: "2026-05-10T09:00:00Z",
    round: 1,
    treatment: "accept",
    inherent_score: 12,
    inherent_band: "High",
    residual_score: 12,
    residual_band: "High",
    acceptance_state: "accepted",
  },
  {
    risk_id: "RSK-2026-001",
    title: "Key-person dependency in finance ops",
    description: null,
    category: "People",
    tags: [],
    owner_email: "cfo@acme.example",
    acceptor_email: null,
    next_review_date: null,
    policy_ids: [],
    evidence_ids: [],
    status: "OPEN",
    created_by: "cfo@acme.example",
    created_at: "2026-04-02T09:00:00Z",
    round: null,
    treatment: null,
    inherent_score: null,
    inherent_band: null,
    residual_score: null,
    residual_band: null,
    acceptance_state: "not_assessed",
  },
];

export type RisksState = {
  risks: Risk[];
  source: DataSource;
  loading: boolean;
  error: string | null;
  notEnabled: boolean;
  reload: () => void;
};

export function useRisks(): RisksState {
  const { ready, contextKey } = useAuth();
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const [state, setState] = useState<Omit<RisksState, "reload">>({
    risks: DEMO_RISKS,
    source: "demo",
    loading: true,
    error: null,
    notEnabled: false,
  });

  useEffect(() => {
    if (!ready) return;
    let active = true;
    apiFetch<Risk[]>("/api/risks")
      .then((rows) => {
        if (!active) return;
        setState({ risks: rows, source: "live", loading: false, error: null, notEnabled: false });
      })
      .catch((err: unknown) => {
        if (!active) return;
        const notEnabled =
          err instanceof ApiError && err.status === 403 && /module is not enabled/i.test(err.message);
        setState({
          risks: DEMO_RISKS,
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

export type RiskDetailState = {
  risk: RiskDetail | null;
  source: DataSource;
  loading: boolean;
  error: string | null;
  notFound: boolean;
  reload: () => void;
};

export function useRiskDetail(id: string | null): RiskDetailState {
  const { ready, contextKey } = useAuth();
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const [state, setState] = useState<Omit<RiskDetailState, "reload">>({
    risk: null,
    source: "demo",
    loading: true,
    error: null,
    notFound: false,
  });

  useEffect(() => {
    if (!id || !ready) return;
    let active = true;
    apiFetch<RiskDetail>(`/api/risks/${encodeURIComponent(id)}`)
      .then((risk) => {
        if (!active) return;
        setState({ risk, source: "live", loading: false, error: null, notFound: false });
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof ApiError && err.status === 404) {
          setState((s) => ({ ...s, loading: false, notFound: true }));
          return;
        }
        const demo = DEMO_RISKS.find((d) => d.risk_id === id) ?? null;
        setState({
          risk: demo
            ? {
                ...demo,
                effective_acceptor: demo.acceptor_email ?? demo.owner_email,
                assessments: [],
                acceptances: [],
                events: [],
              }
            : null,
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
    return { risk: null, source: "demo", loading: false, error: null, notFound: true, reload };
  }
  return { ...state, reload };
}
