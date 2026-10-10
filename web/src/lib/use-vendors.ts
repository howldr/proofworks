"use client";

/**
 * Vendor Assessments hooks — GET /api/vendors with the usual demo fallback
 * while signed out or unreachable. Mutations are issued from the views via
 * apiFetch.
 *
 * A vendor is a risk until understood: same 5×5 rounds as the Risk Register,
 * but the receipt is a DECISION — approve or decline — pinned to the round.
 */

import { useCallback, useEffect, useState } from "react";

import { ApiError, apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/use-auth";
import { type DataSource, isSignedOut } from "@/lib/use-register";
import type { RiskBand, Treatment } from "@/lib/use-risks";

export type VendorTier = "low" | "medium" | "high" | "critical";
export type VendorDecisionValue = "approve" | "decline";
export type VendorDecisionState =
  | "not_assessed"
  | "awaiting_decision"
  | "approved"
  | "declined";

export type Vendor = {
  vendor_id: string;
  name: string;
  description: string | null;
  category: string | null;
  tags: string[];
  tier: VendorTier;
  data_scope: string | null;
  owner_email: string;
  approver_email: string | null;
  next_review_date: string | null;
  policy_ids: string[];
  evidence_ids: string[];
  risk_ids: string[];
  status: "OPEN" | "OFFBOARDED";
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
  decision_state: VendorDecisionState;
};

export type VendorAssessment = {
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

export type VendorDecision = {
  id: number;
  round: number;
  decision: VendorDecisionValue;
  decider_email: string;
  notes: string | null;
  created_at: string;
};

export type VendorEvent = {
  id: number;
  event: string;
  actor_email: string | null;
  created_at: string;
};

export type VendorDetail = Vendor & {
  effective_approver: string;
  tier_escalated: boolean;
  assessments: VendorAssessment[];
  decisions: VendorDecision[];
  events: VendorEvent[];
};

export const VENDOR_CATEGORIES = [
  "SaaS",
  "Infrastructure & Hosting",
  "Professional Services",
  "Data Processor",
  "Managed Service Provider",
  "Hardware & Facilities",
  "Financial Services",
  "Other",
];

export const VENDOR_TIERS: { value: VendorTier; label: string; escalated: boolean }[] = [
  { value: "low",      label: "Low — commodity, no meaningful data",            escalated: false },
  { value: "medium",   label: "Medium — business data, replaceable",            escalated: false },
  { value: "high",     label: "High — sensitive data or hard to replace",       escalated: true },
  { value: "critical", label: "Critical — regulated data or business-critical", escalated: true },
];

const DEMO_VENDORS: Vendor[] = [
  {
    vendor_id: "VEN-2026-003",
    name: "CloudCRM Ltd",
    description: "Hosted CRM platform",
    category: "SaaS",
    tags: ["crm"],
    tier: "high",
    data_scope: "Customer contact records",
    owner_email: "ops.director@acme.example",
    approver_email: null,
    next_review_date: "2027-01-15",
    policy_ids: ["POL-2026-001"],
    evidence_ids: ["EVD-2026-003"],
    risk_ids: [],
    status: "OPEN",
    created_by: "ops.director@acme.example",
    created_at: "2026-06-20T09:00:00Z",
    round: 1,
    treatment: "mitigate",
    inherent_score: 16,
    inherent_band: "Critical",
    residual_score: 6,
    residual_band: "Medium",
    decision_state: "awaiting_decision",
  },
  {
    vendor_id: "VEN-2026-002",
    name: "Shred-It-All Inc",
    description: "Document destruction",
    category: "Professional Services",
    tags: [],
    tier: "low",
    data_scope: null,
    owner_email: "office.manager@acme.example",
    approver_email: null,
    next_review_date: null,
    policy_ids: [],
    evidence_ids: [],
    risk_ids: [],
    status: "OPEN",
    created_by: "office.manager@acme.example",
    created_at: "2026-05-02T09:00:00Z",
    round: 1,
    treatment: "accept",
    inherent_score: 4,
    inherent_band: "Low",
    residual_score: 4,
    residual_band: "Low",
    decision_state: "approved",
  },
  {
    vendor_id: "VEN-2026-001",
    name: "BudgetHost 99",
    description: "Discount VPS hosting",
    category: "Infrastructure & Hosting",
    tags: [],
    tier: "medium",
    data_scope: "Would have held staging databases",
    owner_email: "it.director@acme.example",
    approver_email: null,
    next_review_date: null,
    policy_ids: [],
    evidence_ids: [],
    risk_ids: [],
    status: "OPEN",
    created_by: "it.director@acme.example",
    created_at: "2026-04-11T09:00:00Z",
    round: 1,
    treatment: "avoid",
    inherent_score: 15,
    inherent_band: "High",
    residual_score: 15,
    residual_band: "High",
    decision_state: "declined",
  },
];

export type VendorsState = {
  vendors: Vendor[];
  source: DataSource;
  loading: boolean;
  error: string | null;
  notEnabled: boolean;
  reload: () => void;
};

export function useVendors(): VendorsState {
  const { ready, contextKey } = useAuth();
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const [state, setState] = useState<Omit<VendorsState, "reload">>({
    vendors: DEMO_VENDORS,
    source: "demo",
    loading: true,
    error: null,
    notEnabled: false,
  });

  useEffect(() => {
    if (!ready) return;
    let active = true;
    apiFetch<Vendor[]>("/api/vendors")
      .then((rows) => {
        if (!active) return;
        setState({ vendors: rows, source: "live", loading: false, error: null, notEnabled: false });
      })
      .catch((err: unknown) => {
        if (!active) return;
        const notEnabled =
          err instanceof ApiError && err.status === 403 && /module is not enabled/i.test(err.message);
        setState({
          vendors: DEMO_VENDORS,
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

export type VendorDetailState = {
  vendor: VendorDetail | null;
  source: DataSource;
  loading: boolean;
  error: string | null;
  notFound: boolean;
  reload: () => void;
};

export function useVendorDetail(id: string | null): VendorDetailState {
  const { ready, contextKey } = useAuth();
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const [state, setState] = useState<Omit<VendorDetailState, "reload">>({
    vendor: null,
    source: "demo",
    loading: true,
    error: null,
    notFound: false,
  });

  useEffect(() => {
    if (!id || !ready) return;
    let active = true;
    apiFetch<VendorDetail>(`/api/vendors/${encodeURIComponent(id)}`)
      .then((vendor) => {
        if (!active) return;
        setState({ vendor, source: "live", loading: false, error: null, notFound: false });
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof ApiError && err.status === 404) {
          setState((s) => ({ ...s, loading: false, notFound: true }));
          return;
        }
        const demo = DEMO_VENDORS.find((d) => d.vendor_id === id) ?? null;
        setState({
          vendor: demo
            ? {
                ...demo,
                effective_approver: demo.approver_email ?? demo.owner_email,
                tier_escalated: demo.tier === "high" || demo.tier === "critical",
                assessments: [],
                decisions: [],
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
    return { vendor: null, source: "demo", loading: false, error: null, notFound: true, reload };
  }
  return { ...state, reload };
}
