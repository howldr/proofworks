/**
 * Policy types, status styling, register helpers — and the demo dataset.
 *
 * Live data comes from the Express API via lib/use-register.ts. While the
 * app is signed out (no Supabase session yet) or the API is unreachable,
 * pages fall back to DEMO_POLICIES and label themselves as demo data.
 * Shapes mirror the register fields in docs/specification.md §5.1.
 */

export type PolicyStatus =
  | "DRAFT"
  | "UNDER REVIEW"
  | "OWNER ACCEPTANCE"
  | "EXEC REVIEW"
  | "PENDING ACCEPTANCE"
  | "ACTIVE"
  | "RETIRED";

export type Policy = {
  policy_id: string;
  title: string;
  category: string;
  owner: string;
  current_version: string;
  status: PolicyStatus;
  next_review_date: string; // ISO date
  review_frequency_months?: number;
  applicable_roles: string[];
  acknowledgement_count: number;
  acknowledgement_total: number;
};

/** Tailwind classes per status, for use on an outline <Badge>. */
export const STATUS_STYLES: Record<PolicyStatus, string> = {
  ACTIVE:
    "border-emerald-600/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  DRAFT: "border-border bg-muted text-muted-foreground",
  "UNDER REVIEW":
    "border-amber-600/20 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  "OWNER ACCEPTANCE":
    "border-cyan-600/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-400",
  "EXEC REVIEW":
    "border-purple-600/20 bg-purple-500/10 text-purple-700 dark:text-purple-400",
  "PENDING ACCEPTANCE":
    "border-blue-600/20 bg-blue-500/10 text-blue-700 dark:text-blue-400",
  RETIRED: "border-border bg-transparent text-muted-foreground line-through",
};

export const DEMO_POLICIES: Policy[] = [
  {
    policy_id: "POL-2025-001",
    title: "Acceptable Use Policy",
    category: "IT",
    owner: "jane.doe@acme.example",
    current_version: "v2.0",
    status: "ACTIVE",
    next_review_date: "2026-03-14",
    applicable_roles: ["all-staff"],
    acknowledgement_count: 47,
    acknowledgement_total: 47,
  },
  {
    policy_id: "POL-2025-004",
    title: "Information Security Policy",
    category: "Security",
    owner: "ciso@acme.example",
    current_version: "v1.3",
    status: "UNDER REVIEW",
    next_review_date: "2026-06-20",
    applicable_roles: ["all-staff"],
    acknowledgement_count: 0,
    acknowledgement_total: 51,
  },
  {
    policy_id: "POL-2025-007",
    title: "Data Protection & Privacy Policy",
    category: "Legal",
    owner: "dpo@acme.example",
    current_version: "v3.0",
    status: "PENDING ACCEPTANCE",
    next_review_date: "2027-01-10",
    applicable_roles: ["all-staff"],
    acknowledgement_count: 32,
    acknowledgement_total: 51,
  },
  {
    policy_id: "POL-2025-011",
    title: "Remote Working Policy",
    category: "HR",
    owner: "hr.lead@acme.example",
    current_version: "v1.0",
    status: "ACTIVE",
    next_review_date: "2026-06-30",
    applicable_roles: ["remote", "hybrid"],
    acknowledgement_count: 28,
    acknowledgement_total: 28,
  },
  {
    policy_id: "POL-2025-013",
    title: "Anti-Bribery & Corruption Policy",
    category: "Compliance",
    owner: "legal@acme.example",
    current_version: "v2.0",
    status: "ACTIVE",
    next_review_date: "2026-07-12",
    applicable_roles: ["all-staff", "procurement"],
    acknowledgement_count: 49,
    acknowledgement_total: 51,
  },
  {
    policy_id: "POL-2026-002",
    title: "AI & Generative Tools Usage Policy",
    category: "IT",
    owner: "cto@acme.example",
    current_version: "v0.4",
    status: "DRAFT",
    next_review_date: "2027-02-01",
    applicable_roles: ["engineering", "product"],
    acknowledgement_count: 0,
    acknowledgement_total: 0,
  },
  {
    policy_id: "POL-2024-009",
    title: "Health & Safety Policy",
    category: "Health & Safety",
    owner: "facilities@acme.example",
    current_version: "v4.0",
    status: "ACTIVE",
    next_review_date: "2026-06-15",
    applicable_roles: ["all-staff"],
    acknowledgement_count: 50,
    acknowledgement_total: 51,
  },
  {
    policy_id: "POL-2023-005",
    title: "Social Media Policy",
    category: "Marketing",
    owner: "comms@acme.example",
    current_version: "v1.2",
    status: "RETIRED",
    next_review_date: "2025-01-01",
    applicable_roles: ["marketing"],
    acknowledgement_count: 12,
    acknowledgement_total: 12,
  },
];

/** Days from today (2026-06-04 baseline) until an ISO date. */
export function daysUntil(isoDate: string, today = new Date()): number {
  const d = new Date(isoDate + "T00:00:00Z");
  const ms = d.getTime() - today.getTime();
  return Math.round(ms / 86_400_000);
}

export type RegisterSummary = {
  total: number;
  active: number;
  pendingAcceptance: number;
  underReview: number;
  dueWithin30Days: number;
};

export function summarise(
  policies: Policy[] = DEMO_POLICIES,
  today = new Date(),
): RegisterSummary {
  const live = policies.filter((p) => p.status !== "RETIRED");
  return {
    total: live.length,
    active: live.filter((p) => p.status === "ACTIVE").length,
    pendingAcceptance: live.filter((p) => p.status === "PENDING ACCEPTANCE")
      .length,
    underReview: live.filter((p) => p.status === "UNDER REVIEW").length,
    dueWithin30Days: live.filter((p) => {
      const d = daysUntil(p.next_review_date, today);
      return d >= 0 && d <= 30;
    }).length,
  };
}
