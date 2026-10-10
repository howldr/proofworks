"use client";

import type { LucideIcon } from "lucide-react";
import {
  CheckCircle2,
  ClipboardCheck,
  FileText,
  RefreshCw,
  Send,
  ShieldCheck,
  Stamp,
  Undo2,
} from "lucide-react";
import Link from "next/link";

import { DataSourceBadge } from "@/components/data-source-badge";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { STATUS_STYLES, type PolicyStatus } from "@/lib/policies";
import { type TaskKind, useTasks } from "@/lib/use-tasks";

const KIND_META: Record<
  TaskKind,
  { icon: LucideIcon; label: string; className: string }
> = {
  revise: {
    icon: Undo2,
    label: "Revise",
    className: "text-amber-600 dark:text-amber-400",
  },
  approve: {
    icon: CheckCircle2,
    label: "Approve",
    className: "text-brand",
  },
  "sign-off": {
    icon: Stamp,
    label: "Sign off",
    className: "text-brand",
  },
  accept: {
    icon: ShieldCheck,
    label: "Accept",
    className: "text-brand",
  },
  distribute: {
    icon: Send,
    label: "Distribute",
    className: "text-blue-600 dark:text-blue-400",
  },
  review: {
    icon: RefreshCw,
    label: "Review",
    className: "text-amber-600 dark:text-amber-400",
  },
  draft: {
    icon: FileText,
    label: "Draft",
    className: "text-muted-foreground",
  },
};

export function MyTasksView() {
  const { tasks, source, loading, error } = useTasks();

  return (
    <>
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">My tasks</h1>
          {!loading && <DataSourceBadge source={source} error={error} />}
        </div>
        <p className="text-sm text-muted-foreground">
          Waiting on you — approvals, sign-offs, acceptances, revisions,
          distributions, and reviews.
        </p>
      </div>

      {loading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="You're all caught up"
          description="Nothing needs your attention right now."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {tasks.map((t) => {
            const meta = KIND_META[t.kind];
            const Icon = meta.icon;
            const status = t.status.replace(/_/g, " ") as PolicyStatus;
            // Risk-acceptance tasks point at the risk; everything else is a policy.
            const objectId = t.policy_id ?? t.risk_id ?? "";
            const href = t.risk_id
              ? `/risks/view?id=${encodeURIComponent(t.risk_id)}`
              : `/policies/view?id=${encodeURIComponent(objectId)}`;
            return (
              <Link key={`${t.kind}:${objectId}`} href={href} className="group">
                <Card className="transition-colors group-hover:border-brand/50">
                  <CardContent className="flex items-center gap-4 py-4">
                    <Icon className={`size-5 shrink-0 ${meta.className}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium">{t.title}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {objectId}
                          {t.version ? ` · ${t.version}` : ""}
                        </span>
                        <Badge
                          variant="outline"
                          className={STATUS_STYLES[status]}
                        >
                          {status}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {t.reason}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-medium text-brand opacity-0 transition-opacity group-hover:opacity-100">
                      {meta.label} →
                    </span>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
