"use client";

/**
 * Suite dashboard hook — GET /api/dashboard, the cross-module "needs
 * attention" aggregate. Sections are present only when the workspace is
 * entitled to that module (and recent_events only for audit-grade roles),
 * so the view renders exactly what came back. Null when signed out or the
 * API is unreachable — the dashboard then shows its policy-register demo
 * state only.
 */

import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/use-auth";
import type { RiskBand } from "@/lib/use-risks";

export type DashboardPolicies = {
  total: number;
  active: number;
  in_authorisation: number;
  pending_acceptance: number;
  review_overdue: number;
  review_due_30d: number;
  outstanding_acknowledgements: number;
};

export type DashboardEvidenceItem = {
  evidence_id: string;
  title: string;
  expires_at: string;
  expired: boolean;
};

export type DashboardEvidence = {
  active: number;
  expired: number;
  expiring_30d: number;
  attention: DashboardEvidenceItem[];
};

export type DashboardRiskItem = {
  risk_id: string;
  title: string;
  residual_score: number;
  residual_band: RiskBand;
};

export type DashboardRisks = {
  open: number;
  awaiting_acceptance: number;
  not_assessed: number;
  review_overdue: number;
  attention: DashboardRiskItem[];
};

export type DashboardAccessReviewItem = {
  review_id: string;
  title: string;
  system: string;
  due_date: string | null;
  overdue: boolean;
  lines_total: number;
  lines_decided: number;
};

export type DashboardAccessReviews = {
  open: number;
  overdue: number;
  ready_to_attest: number;
  attention: DashboardAccessReviewItem[];
};

export type DashboardVendorItem = {
  vendor_id: string;
  name: string;
  tier: "low" | "medium" | "high" | "critical";
  residual_score: number;
  residual_band: RiskBand;
};

export type DashboardVendors = {
  open: number;
  awaiting_decision: number;
  not_assessed: number;
  review_overdue: number;
  attention: DashboardVendorItem[];
};

export type DashboardObligationItem = {
  obligation_id: string;
  title: string;
  source_type: string;
  source_name: string;
};

export type DashboardObligations = {
  active: number;
  unanswered: number;
  /** Answered by a method, but with no evidence behind it. */
  unproven: number;
  review_overdue: number;
  review_due_30d: number;
  attention: DashboardObligationItem[];
};

export type SpineEvent = {
  id: number;
  occurred_at: string;
  actor_email: string | null;
  action: string;
  object_type: "policy" | "evidence" | "risk" | "access_review" | "vendor" | "obligation" | string;
  object_id: string;
};

export type DashboardData = {
  policies?: DashboardPolicies;
  evidence?: DashboardEvidence;
  risks?: DashboardRisks;
  access_reviews?: DashboardAccessReviews;
  vendors?: DashboardVendors;
  obligations?: DashboardObligations;
  recent_events?: SpineEvent[];
};

export function useDashboard() {
  const { ready, contextKey } = useAuth();
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready) return;
    let active = true;
    apiFetch<DashboardData>("/api/dashboard")
      .then((d) => {
        if (!active) return;
        setData(d);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setData(null);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [ready, contextKey, tick]);

  return { data, loading, reload };
}
