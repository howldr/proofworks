"use client";

/**
 * Client hooks that read the policy register from the API, falling back to
 * the bundled demo data while the app is signed out (401/403) or the API is
 * unreachable. Components render `source` so demo data is always labelled.
 */

import { useCallback, useEffect, useState } from "react";

import { ApiError, apiFetch } from "@/lib/api";
import { DEMO_POLICIES, type Policy, type PolicyStatus } from "@/lib/policies";
import { useAuth } from "@/lib/use-auth";
// type-only: use-risks imports runtime helpers from this module, so a value
// import here would create a require cycle.
import type { LinkedObligation } from "@/lib/use-obligations";
import type { LinkedRisk } from "@/lib/use-risks";

/** Raw policy row as the Express API returns it (DB column names). */
export type ApiPolicy = {
  policy_id: string;
  title: string;
  category: string | null;
  owner_email: string;
  current_version: string;
  status: string; // 'UNDER_REVIEW' etc — underscored
  authorised_date: string | null;
  review_frequency_months: number;
  next_review_date: string | null;
  applicable_roles: string[];
  acknowledgement_count: number;
  acknowledgement_total: number;
  last_updated: string;
};

export type Authoriser = {
  email: string;
  approved_at: string | null;
  returned_at: string | null;
  feedback: string | null;
};

/** One member's standing within a stage, as the route engine reports it. */
export type StageMember = {
  email: string;
  decision: "approved" | "returned" | null;
  decidedAt: string | null;
  feedback: string | null;
};

/** The executive-authorisation gate summary for a policy. `required` is true
 *  when the policy's category is in the tenant's exec_required_categories. */
export type ExecSummary = {
  email: string | null;
  required: boolean;
  decision: "approved" | "returned" | null;
  decidedAt: string | null;
  feedback: string | null;
};

/** The owner-acceptance gate summary. `required` reflects the tenant toggle. */
export type OwnerAcceptanceSummary = {
  required: boolean;
  decision: "approved" | "returned" | null;
  decidedAt: string | null;
  feedback: string | null;
};

/** A stage of the authorisation route with live per-stage progress.
 *  threshold null = every member must approve; integer = a quorum of N. */
export type AuthorisationStage = {
  position: number;
  threshold: number | null;
  members: StageMember[];
  memberCount: number;
  approved: number;
  required: number;
  satisfied: boolean;
};

export type Acknowledgement = {
  version: string;
  recipient_email: string;
  manager_email: string | null;
  distributed_at: string | null;
  expires_at: string | null;
  acknowledged_at: string | null;
  download_count: number | null;
  /** Checksum of the exact published file this receipt is pinned to. */
  document_checksum?: string | null;
  /** Explicit "I have read and accept" click, on top of the download receipt. */
  attested_at?: string | null;
};

export type ChangelogEntry = {
  id?: number;
  event: string;
  from_status: string | null;
  to_status: string | null;
  from_version: string | null;
  to_version: string | null;
  actor_email: string | null;
  created_at: string;
};

export type Comment = {
  id: number;
  version: string;
  author_email: string;
  kind: "comment" | "question";
  body: string;
  created_at: string;
};

export type ReaderStat = {
  version: string;
  reader_email: string;
  read_count: number;
  first_read_at: string;
  last_read_at: string;
};

export type DocumentFile = {
  area: "current" | "drafts" | "archive";
  id: string;
  name: string;
  size: number;
  checksum: string;
  content_type: string | null;
  created_at: string;
};

export type DataSource = "live" | "demo";

/** '2026-03-14T00:00:00.000Z' | '2026-03-14' → '2026-03-14' */
function isoDay(value: string | null): string {
  return value ? value.slice(0, 10) : "";
}

/** Map an API row (underscored status, owner_email) onto the UI Policy shape. */
export function normalisePolicy(row: ApiPolicy): Policy {
  return {
    policy_id: row.policy_id,
    title: row.title,
    category: row.category ?? "—",
    owner: row.owner_email,
    current_version: row.current_version,
    status: row.status.replace(/_/g, " ") as PolicyStatus,
    next_review_date: isoDay(row.next_review_date),
    review_frequency_months: row.review_frequency_months,
    applicable_roles: row.applicable_roles ?? [],
    acknowledgement_count: row.acknowledgement_count ?? 0,
    acknowledgement_total: row.acknowledgement_total ?? 0,
  };
}

/** Signed out (401/403) or no tenant context yet (400 "Tenant required") —
 *  both expected until the auth flow lands; anything else is a fault. */
export function isSignedOut(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.status === 401 || err.status === 403) return true;
  return err.status === 400 && /tenant required/i.test(err.message);
}

export type RegisterState = {
  policies: Policy[];
  source: DataSource;
  loading: boolean;
  /** Non-null only when the API faulted (network/5xx) — not when signed out. */
  error: string | null;
};

export function useRegister(): RegisterState {
  const { ready, contextKey } = useAuth();
  const [state, setState] = useState<RegisterState>({
    policies: DEMO_POLICIES,
    source: "demo",
    loading: true,
    error: null,
  });

  useEffect(() => {
    // Wait for the session to restore (and /api/me to settle) so the first
    // fetch already carries the token + tenant prefix. Re-runs on sign-in/out;
    // previous data stays on screen while the re-fetch is in flight.
    if (!ready) return;
    let active = true;
    apiFetch<ApiPolicy[]>("/api/policies")
      .then((rows) => {
        if (!active) return;
        setState({
          policies: rows.map(normalisePolicy),
          source: "live",
          loading: false,
          error: null,
        });
      })
      .catch((err: unknown) => {
        if (!active) return;
        setState({
          policies: DEMO_POLICIES,
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
  }, [ready, contextKey]);

  return state;
}

export type PolicyDetailState = {
  policy: Policy | null;
  authorisers: Authoriser[];
  /** Ordered stages with per-stage progress; empty in demo mode. */
  authorisationRoute: AuthorisationStage[];
  /** Executive-gate summary; the neutral default outside live mode. */
  exec: ExecSummary;
  /** Owner-acceptance gate summary; the neutral default outside live mode. */
  ownerAcceptance: OwnerAcceptanceSummary;
  acknowledgements: Acknowledgement[];
  changelog: ChangelogEntry[];
  comments: Comment[];
  reads: ReaderStat[];
  documents: DocumentFile[];
  /** Risks in the register citing this policy as a treating control. */
  linkedRisks: LinkedRisk[];
  /** Obligations naming this policy as part of their answer. */
  linkedObligations: LinkedObligation[];
  source: DataSource;
  loading: boolean;
  error: string | null;
  /** True when the id matched nothing (live 404, or unknown demo id). */
  notFound: boolean;
  /** Re-fetch the policy — call after a lifecycle action mutates it. */
  reload: () => void;
};

const DEFAULT_EXEC: ExecSummary = {
  email: null, required: false, decision: null, decidedAt: null, feedback: null,
};

const DEFAULT_OWNER_ACCEPTANCE: OwnerAcceptanceSummary = {
  required: false, decision: null, decidedAt: null, feedback: null,
};

export function usePolicyDetail(id: string | null): PolicyDetailState {
  const { ready, contextKey } = useAuth();
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const [state, setState] = useState<Omit<PolicyDetailState, "reload">>({
    policy: null,
    authorisers: [],
    authorisationRoute: [],
    exec: DEFAULT_EXEC,
    ownerAcceptance: DEFAULT_OWNER_ACCEPTANCE,
    acknowledgements: [],
    changelog: [],
    comments: [],
    reads: [],
    documents: [],
    linkedRisks: [],
    linkedObligations: [],
    source: "demo",
    loading: true,
    error: null,
    notFound: false,
  });

  useEffect(() => {
    if (!id || !ready) return;
    let active = true;

    const demoFallback = (faultMessage: string | null) => {
      const demo = DEMO_POLICIES.find((p) => p.policy_id === id) ?? null;
      setState({
        policy: demo,
        authorisers: [],
        authorisationRoute: [],
        exec: DEFAULT_EXEC,
        ownerAcceptance: DEFAULT_OWNER_ACCEPTANCE,
        acknowledgements: [],
        changelog: [],
        comments: [],
        reads: [],
        documents: [],
        linkedRisks: [],
    linkedObligations: [],
        source: "demo",
        loading: false,
        error: faultMessage,
        notFound: !demo,
      });
    };

    type DetailResp = ApiPolicy & {
      authorisers: Authoriser[];
      authorisationRoute?: AuthorisationStage[];
      exec?: ExecSummary;
      ownerAcceptance?: OwnerAcceptanceSummary;
      linkedRisks?: LinkedRisk[];
      linkedObligations?: LinkedObligation[];
    };

    apiFetch<DetailResp>(`/api/policies/${encodeURIComponent(id)}`)
      .then(async (detail) => {
        // Acks, changelog, comments, reads are read-access too — best-effort in parallel.
        const [acks, log, comments, reads, documents] = await Promise.all([
          apiFetch<Acknowledgement[]>(
            `/api/policies/${encodeURIComponent(id)}/acknowledgements`,
          ).catch(() => [] as Acknowledgement[]),
          apiFetch<ChangelogEntry[]>(
            `/api/policies/${encodeURIComponent(id)}/changelog`,
          ).catch(() => [] as ChangelogEntry[]),
          apiFetch<Comment[]>(
            `/api/policies/${encodeURIComponent(id)}/comments`,
          ).catch(() => [] as Comment[]),
          apiFetch<ReaderStat[]>(
            `/api/policies/${encodeURIComponent(id)}/reads`,
          ).catch(() => [] as ReaderStat[]),
          apiFetch<DocumentFile[]>(
            `/api/policies/${encodeURIComponent(id)}/documents`,
          ).catch(() => [] as DocumentFile[]),
        ]);
        if (!active) return;
        setState({
          policy: normalisePolicy(detail),
          authorisers: detail.authorisers ?? [],
          authorisationRoute: detail.authorisationRoute ?? [],
          exec: detail.exec ?? DEFAULT_EXEC,
          ownerAcceptance: detail.ownerAcceptance ?? DEFAULT_OWNER_ACCEPTANCE,
          acknowledgements: acks,
          changelog: log,
          comments,
          reads,
          documents,
          linkedRisks: detail.linkedRisks ?? [],
          linkedObligations: detail.linkedObligations ?? [],
          source: "live",
          loading: false,
          error: null,
          notFound: false,
        });
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof ApiError && err.status === 404) {
          setState((s) => ({ ...s, loading: false, notFound: true, source: "live" }));
          return;
        }
        demoFallback(
          isSignedOut(err)
            ? null
            : err instanceof Error
              ? err.message
              : String(err),
        );
      });

    return () => {
      active = false;
    };
  }, [id, ready, contextKey, tick]);

  // No id in the URL — nothing to load. Derived here rather than set in the
  // effect so the effect never calls setState synchronously.
  if (!id) {
    return {
      policy: null,
      authorisers: [],
      authorisationRoute: [],
      exec: DEFAULT_EXEC,
      ownerAcceptance: DEFAULT_OWNER_ACCEPTANCE,
      acknowledgements: [],
      changelog: [],
      comments: [],
      reads: [],
      documents: [],
      linkedRisks: [],
    linkedObligations: [],
      source: "demo",
      loading: false,
      error: null,
      notFound: true,
      reload,
    };
  }

  return { ...state, reload };
}
