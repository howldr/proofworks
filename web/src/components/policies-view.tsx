"use client";

import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import Link from "next/link";

import { DataSourceBadge } from "@/components/data-source-badge";
import { PolicyTable } from "@/components/policy-table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { type PolicyStatus } from "@/lib/policies";
import { useAuth } from "@/lib/use-auth";
import { useRegister } from "@/lib/use-register";
import { useSearchQuery } from "@/lib/use-search";

const STATUS_FILTERS: Array<PolicyStatus | "ALL"> = [
  "ALL",
  "DRAFT",
  "UNDER REVIEW",
  "PENDING ACCEPTANCE",
  "ACTIVE",
  "RETIRED",
];

export function PoliciesView() {
  const { policies, source, loading, error } = useRegister();
  const { me } = useAuth();
  const canCreate = me?.role === "admin" || me?.role === "howldr_support";
  const [query, setQuery] = useSearchQuery();
  const [status, setStatus] = useState<PolicyStatus | "ALL">("ALL");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return policies.filter((p) => {
      if (status !== "ALL" && p.status !== status) return false;
      if (!q) return true;
      return (
        p.title.toLowerCase().includes(q) ||
        p.policy_id.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.owner.toLowerCase().includes(q)
      );
    });
  }, [policies, query, status]);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              Policy Register
            </h1>
            {!loading && <DataSourceBadge source={source} error={error} />}
          </div>
          <p className="text-sm text-muted-foreground">
            {policies.length} policies · serialised, versioned, and
            audit-tracked.
          </p>
        </div>
        {canCreate ? (
          <Button render={<Link href="/policies/new" />} nativeButton={false}>
            <Plus />
            New policy
          </Button>
        ) : (
          <Button title="Creating policies requires the admin role" disabled>
            <Plus />
            New policy
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative grow sm:grow-0">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by title, ID, category, owner…"
            className="h-8 w-full rounded-lg border border-input bg-background pl-8 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:w-72"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {STATUS_FILTERS.map((s) => (
            <Button
              key={s}
              size="sm"
              variant={status === s ? "secondary" : "ghost"}
              onClick={() => setStatus(s)}
              className="h-8 text-xs"
            >
              {s === "ALL" ? "All" : s.toLowerCase()}
            </Button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          No policies match{query ? ` “${query}”` : ""}
          {status !== "ALL" ? ` with status ${status}` : ""}.
        </p>
      ) : (
        <PolicyTable policies={filtered} />
      )}
    </>
  );
}
