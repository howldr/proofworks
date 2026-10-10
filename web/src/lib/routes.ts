/** Human labels per top-level route — used by the header breadcrumb. */
export const ROUTE_LABELS: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/tasks": "My tasks",
  "/policies": "Policy Register",
  "/approvals": "Approvals",
  "/acknowledgements": "Acknowledgements",
  "/reviews": "Policy Reviews",
  "/obligations": "Obligations",
  "/evidence": "Evidence Locker",
  "/risks": "Risk Register",
  "/access-reviews": "Access Reviews",
  "/vendors": "Vendor Assessments",
  "/staff": "Staff",
  "/settings": "Settings",
};

export function labelForPath(pathname: string): string {
  // Match the longest known prefix (so /policies/POL-2025-001 still resolves).
  const hit = Object.keys(ROUTE_LABELS)
    .filter((base) => pathname === base || pathname.startsWith(base + "/"))
    .sort((a, b) => b.length - a.length)[0];
  return hit ? ROUTE_LABELS[hit] : "ProofWorks";
}

/** Where the header search lands per route: the searchable register and its
 *  noun. Policy Hub's workflow pages (approvals, reviews, …) and the
 *  overview pages search the policy register; module pages search their own.
 *  Detail pages inherit their module via prefix match. */
const SEARCH_TARGETS: { prefix: string; list: string; noun: string }[] = [
  { prefix: "/obligations", list: "/obligations", noun: "obligations" },
  { prefix: "/evidence", list: "/evidence", noun: "evidence" },
  { prefix: "/risks", list: "/risks", noun: "risks" },
  { prefix: "/access-reviews", list: "/access-reviews", noun: "access reviews" },
  { prefix: "/vendors", list: "/vendors", noun: "vendors" },
];

export function searchTargetForPath(pathname: string): {
  list: string;
  noun: string;
} {
  const hit = SEARCH_TARGETS.find(
    (t) => pathname === t.prefix || pathname.startsWith(t.prefix + "/"),
  );
  return hit ?? { list: "/policies", noun: "policies" };
}
