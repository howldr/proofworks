"use client";

import { CheckCheck, ClipboardCheck, Hourglass, Users } from "lucide-react";
import Link from "next/link";

import { DataSourceBadge } from "@/components/data-source-badge";
import { EmptyState } from "@/components/empty-state";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { STATUS_STYLES } from "@/lib/policies";
import { useRegister } from "@/lib/use-register";

function AckProgress({ count, total }: { count: number; total: number }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  const done = count >= total;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
        <div
          className={
            "h-full rounded-full " + (done ? "bg-emerald-500" : "bg-amber-500")
          }
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="tabular-nums text-xs text-muted-foreground">
        {count}/{total}
      </span>
    </div>
  );
}

export function AcknowledgementsView() {
  const { policies, source, loading, error } = useRegister();

  // Only policies that have actually been distributed carry recipients.
  const distributed = policies
    .filter((p) => p.status !== "RETIRED" && p.acknowledgement_total > 0)
    .sort(
      (a, b) =>
        b.acknowledgement_total -
        b.acknowledgement_count -
        (a.acknowledgement_total - a.acknowledgement_count) ||
        a.title.localeCompare(b.title),
    );

  const recipients = distributed.reduce(
    (n, p) => n + p.acknowledgement_total,
    0,
  );
  const accepted = distributed.reduce(
    (n, p) => n + p.acknowledgement_count,
    0,
  );
  const fullyAccepted = distributed.filter(
    (p) => p.acknowledgement_count >= p.acknowledgement_total,
  ).length;

  return (
    <>
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Acknowledgements
          </h1>
          {!loading && <DataSourceBadge source={source} error={error} />}
        </div>
        <p className="text-sm text-muted-foreground">
          Staff acceptance tracking across distributed policies.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Recipients"
          value={recipients}
          hint="Across all distributions"
          icon={Users}
        />
        <StatCard
          label="Accepted"
          value={accepted}
          hint="Acknowledgements received"
          icon={ClipboardCheck}
        />
        <StatCard
          label="Outstanding"
          value={recipients - accepted}
          hint="Awaiting staff sign-off"
          icon={Hourglass}
        />
        <StatCard
          label="Fully accepted"
          value={fullyAccepted}
          hint="Policies at 100% acceptance"
          icon={CheckCheck}
        />
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : distributed.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="Nothing distributed yet"
          description="Per-recipient acceptance status, reminders, and overdue escalations will be tracked here once policies are distributed."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="w-[130px]">ID</TableHead>
                <TableHead>Policy</TableHead>
                <TableHead className="w-[90px]">Version</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Acceptance</TableHead>
                <TableHead className="hidden sm:table-cell text-right">
                  Outstanding
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {distributed.map((p) => {
                const open = p.acknowledgement_total - p.acknowledgement_count;
                return (
                  <TableRow key={p.policy_id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      <Link
                        href={`/policies/view?id=${encodeURIComponent(p.policy_id)}`}
                        className="hover:text-foreground hover:underline"
                      >
                        {p.policy_id}
                      </Link>
                    </TableCell>
                    <TableCell className="font-medium">{p.title}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {p.current_version}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={STATUS_STYLES[p.status]}
                      >
                        {p.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <AckProgress
                        count={p.acknowledgement_count}
                        total={p.acknowledgement_total}
                      />
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-right tabular-nums">
                      {open > 0 ? (
                        <span className="text-amber-600 dark:text-amber-400">
                          {open}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
