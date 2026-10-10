"use client";

/**
 * Access Reviews hooks — GET /api/access-reviews (+ detail) with the usual
 * demo fallback while signed out or unreachable. Mutations are issued from the
 * views via apiFetch. `notEnabled` is set when the workspace lacks the module.
 */

import { useCallback, useEffect, useState } from "react";

import { ApiError, apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/use-auth";
import { type DataSource, isSignedOut } from "@/lib/use-register";

export type LineDecision = "keep" | "flag" | "remove";
export type ReviewStatus = "OPEN" | "ATTESTED";
export type ProgressState = "in_review" | "ready_to_attest" | "attested";

export type AccessReview = {
  review_id: string;
  title: string;
  system: string;
  description: string | null;
  reviewer_email: string;
  due_date: string | null;
  next_review_date: string | null;
  status: ReviewStatus;
  created_by: string;
  created_at: string;
  // derived server-side on list + detail
  lines_total: number;
  lines_decided: number;
  lines_flag: number;
  lines_remove: number;
  progress_state: ProgressState;
};

export type AccessReviewLine = {
  id: number;
  review_id: string;
  subject: string;
  resource: string;
  access_detail: string | null;
  decision: LineDecision | null;
  decision_note: string | null;
  decided_by: string | null;
  decided_at: string | null;
};

export type AccessReviewAttestation = {
  id: number;
  review_id: string;
  reviewer_email: string;
  notes: string | null;
  lines_total: number;
  lines_keep: number;
  lines_flag: number;
  lines_remove: number;
  created_at: string;
};

export type AccessReviewDetail = AccessReview & {
  lines: AccessReviewLine[];
  attestations: AccessReviewAttestation[];
};

const DEMO_REVIEWS: AccessReview[] = [
  {
    review_id: "ARV-2026-001", title: "Microsoft 365 — quarterly admin review",
    system: "Microsoft 365", description: null, reviewer_email: "it-lead@demo.example",
    due_date: "2026-09-30", next_review_date: null, status: "OPEN",
    created_by: "admin@demo.example", created_at: "2026-07-01T00:00:00Z",
    lines_total: 12, lines_decided: 5, lines_flag: 1, lines_remove: 0, progress_state: "in_review",
  },
  {
    review_id: "ARV-2026-002", title: "Production database access", system: "PostgreSQL (prod)",
    description: null, reviewer_email: "dba@demo.example", due_date: "2026-08-15",
    next_review_date: "2026-11-15", status: "ATTESTED", created_by: "admin@demo.example",
    created_at: "2026-06-20T00:00:00Z",
    lines_total: 6, lines_decided: 6, lines_flag: 0, lines_remove: 2, progress_state: "attested",
  },
];

export type AccessReviewsState = {
  reviews: AccessReview[];
  source: DataSource;
  loading: boolean;
  error: string | null;
  notEnabled: boolean;
  reload: () => void;
};

export function useAccessReviews(): AccessReviewsState {
  const { ready, contextKey } = useAuth();
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const [state, setState] = useState<Omit<AccessReviewsState, "reload">>({
    reviews: DEMO_REVIEWS,
    source: "demo",
    loading: true,
    error: null,
    notEnabled: false,
  });

  useEffect(() => {
    if (!ready) return;
    let active = true;
    apiFetch<AccessReview[]>("/api/access-reviews")
      .then((rows) => {
        if (!active) return;
        setState({ reviews: rows, source: "live", loading: false, error: null, notEnabled: false });
      })
      .catch((err: unknown) => {
        if (!active) return;
        const notEnabled =
          err instanceof ApiError && err.status === 403 && /module is not enabled/i.test(err.message);
        setState({
          reviews: DEMO_REVIEWS,
          source: "demo",
          loading: false,
          notEnabled,
          error: notEnabled || isSignedOut(err) ? null : err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      active = false;
    };
  }, [ready, contextKey, tick]);

  return { ...state, reload };
}

export type AccessReviewDetailState = {
  review: AccessReviewDetail | null;
  source: DataSource;
  loading: boolean;
  error: string | null;
  notFound: boolean;
  reload: () => void;
};

export function useAccessReviewDetail(id: string | null): AccessReviewDetailState {
  const { ready, contextKey } = useAuth();
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const [state, setState] = useState<Omit<AccessReviewDetailState, "reload">>({
    review: null,
    source: "demo",
    loading: true,
    error: null,
    notFound: false,
  });

  useEffect(() => {
    if (!id || !ready) return;
    let active = true;
    apiFetch<AccessReviewDetail>(`/api/access-reviews/${encodeURIComponent(id)}`)
      .then((review) => {
        if (!active) return;
        setState({ review, source: "live", loading: false, error: null, notFound: false });
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof ApiError && err.status === 404) {
          setState((s) => ({ ...s, loading: false, notFound: true }));
          return;
        }
        setState({
          review: null,
          source: "demo",
          loading: false,
          error: isSignedOut(err) ? null : err instanceof Error ? err.message : String(err),
          notFound: !isSignedOut(err),
        });
      });
    return () => {
      active = false;
    };
  }, [id, ready, contextKey, tick]);

  if (!id) {
    return { review: null, source: "demo", loading: false, error: null, notFound: true, reload };
  }
  return { ...state, reload };
}

/** Parse pasted CSV/TSV into review lines: subject, resource, access_detail. */
export function parseAccessLines(text: string): { subject: string; resource: string; access_detail?: string }[] {
  const out: { subject: string; resource: string; access_detail?: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const cells = line.split(line.includes("\t") ? "\t" : ",").map((c) => c.trim());
    const [subject, resource, ...rest] = cells;
    if (!subject || !resource) continue;
    const detail = rest.join(", ").trim();
    out.push({ subject, resource, ...(detail ? { access_detail: detail } : {}) });
  }
  return out;
}
