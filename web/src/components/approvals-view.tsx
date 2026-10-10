"use client";

import { FilePen, Send, Stamp } from "lucide-react";

import { DataSourceBadge } from "@/components/data-source-badge";
import { EmptyState } from "@/components/empty-state";
import { PolicyTable } from "@/components/policy-table";
import { StatCard } from "@/components/stat-card";
import { Skeleton } from "@/components/ui/skeleton";
import { type Policy } from "@/lib/policies";
import { useRegister } from "@/lib/use-register";

function Section({ title, hint, policies }: { title: string; hint: string; policies: Policy[] }) {
  if (policies.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      <PolicyTable policies={policies} showAck={false} />
    </section>
  );
}

export function ApprovalsView() {
  const { policies, source, loading, error } = useRegister();

  const awaiting = policies.filter((p) => p.status === "UNDER REVIEW");
  const approved = policies.filter((p) => p.status === "PENDING ACCEPTANCE");
  const drafting = policies.filter((p) => p.status === "DRAFT");
  const empty = awaiting.length + approved.length + drafting.length === 0;

  return (
    <>
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Approvals
          </h1>
          {!loading && <DataSourceBadge source={source} error={error} />}
        </div>
        <p className="text-sm text-muted-foreground">
          Drafts awaiting approver sign-off.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <StatCard
          label="Awaiting sign-off"
          value={awaiting.length}
          hint="Submitted, with approvers"
          icon={Stamp}
        />
        <StatCard
          label="Approved"
          value={approved.length}
          hint="Approved, awaiting distribution"
          icon={Send}
        />
        <StatCard
          label="In drafting"
          value={drafting.length}
          hint="Not yet submitted"
          icon={FilePen}
        />
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : empty ? (
        <EmptyState
          icon={Stamp}
          title="No approvals pending"
          description="When an owner submits a draft for sign-off, the approval requests and their non-repudiable receipts will appear here."
        />
      ) : (
        <>
          <Section
            title="Awaiting sign-off"
            hint="Submitted by their owners — every named approver must approve before the policy advances."
            policies={awaiting}
          />
          <Section
            title="Approved — awaiting distribution"
            hint="All approvers signed off; the owner distributes for staff acceptance next."
            policies={approved}
          />
          <Section
            title="In drafting"
            hint="Not yet submitted for approval."
            policies={drafting}
          />
        </>
      )}
    </>
  );
}
