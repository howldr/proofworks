"use client";

import { ChevronDown, ChevronRight, Lock, Scale, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { DashboardData } from "@/lib/use-dashboard";

/**
 * The evidence spine, drawn as a flow: Understanding → Method → Proof
 * (obligations → the controls that answer them → the proof behind them).
 * This is the story the sidebar can only imply — nav groups things, a flow
 * shows direction. Two kinds of amber, kept deliberately distinct: a *hop*
 * glows for things that never crossed it (obligations with no method, methods
 * with no proof), a *node* glows for its own state (controls not yet in force,
 * proof that has expired). Stages whose module isn't entitled show as faded
 * placeholders, so the whole spine is always visible.
 */

type Stage = {
  label: string;
  noun: string;
  icon: LucideIcon;
  href: string;
  enabled: boolean;
  metric: number;
  metricLabel: string;
  /** The loudest signal for this stage — a break in the chain. */
  gap?: { count: number; label: string; tone: "amber" | "red" };
};

function StageNode({ stage }: { stage: Stage }) {
  const inner = (
    <>
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <stage.icon className="size-3.5" />
        {stage.label}
      </div>
      {stage.enabled ? (
        <>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold tabular-nums">{stage.metric}</span>
            <span className="text-sm text-muted-foreground">{stage.metricLabel}</span>
          </div>
          <div className="text-sm font-medium">{stage.noun}</div>
          {stage.gap ? (
            <Badge
              variant="outline"
              className={
                "mt-2 shrink-0 " +
                (stage.gap.tone === "red"
                  ? "border-red-600/30 bg-red-500/10 text-red-700 dark:text-red-400"
                  : "border-amber-600/30 bg-amber-500/10 text-amber-700 dark:text-amber-400")
              }
            >
              {stage.gap.count} {stage.gap.label}
            </Badge>
          ) : (
            <span className="mt-2 text-xs text-muted-foreground">no issues</span>
          )}
        </>
      ) : (
        <div className="mt-2 flex flex-1 flex-col justify-center">
          <div className="text-sm font-medium text-muted-foreground">{stage.noun}</div>
          <span className="text-xs text-muted-foreground/70">Not enabled</span>
        </div>
      )}
    </>
  );

  const className =
    "flex flex-1 flex-col rounded-lg border p-4 " +
    (stage.enabled
      ? "hover:bg-muted/50"
      : "border-dashed bg-muted/30 opacity-70");

  return stage.enabled ? (
    <Link href={stage.href} className={className}>
      {inner}
    </Link>
  ) : (
    <div className={className}>{inner}</div>
  );
}

/** A hop between stages. `broken` is the count of things that never made it
 *  across — the chain's weak link, so the hop itself carries the warning. */
function Connector({
  caption,
  broken,
}: {
  caption: string;
  broken?: { count: number; label: string };
}) {
  const tone = broken ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground";
  return (
    <div className="flex flex-row items-center justify-center gap-1 md:flex-col md:px-1">
      <ChevronDown className={"size-5 md:hidden " + tone} />
      <ChevronRight className={"hidden size-5 md:block " + tone} />
      <span className={"text-[10px] uppercase tracking-wide " + tone}>{caption}</span>
      {broken && (
        <span className="text-[10px] tabular-nums text-amber-700 dark:text-amber-400">
          {broken.count} {broken.label}
        </span>
      )}
    </div>
  );
}

export function LifecycleFlow({ suite }: { suite: DashboardData }) {
  const ob = suite.obligations;
  const pol = suite.policies;
  const ev = suite.evidence;

  const stages: Stage[] = [
    {
      label: "Understand",
      noun: "Obligations",
      icon: Scale,
      href: "/obligations",
      enabled: !!ob,
      metric: ob?.active ?? 0,
      metricLabel: "active",
      gap:
        ob && ob.review_overdue > 0
          ? { count: ob.review_overdue, label: "review overdue", tone: "amber" }
          : undefined,
    },
    {
      label: "Control",
      noun: "Policies",
      icon: ShieldCheck,
      href: "/policies",
      enabled: !!pol,
      metric: pol?.active ?? 0,
      metricLabel: "in force",
      gap:
        pol && pol.pending_acceptance > 0
          ? { count: pol.pending_acceptance, label: "pending acceptance", tone: "amber" }
          : undefined,
    },
    {
      label: "Prove",
      noun: "Evidence",
      icon: Lock,
      href: "/evidence",
      enabled: !!ev,
      metric: ev?.active ?? 0,
      metricLabel: "active",
      gap:
        ev && ev.expired > 0
          ? { count: ev.expired, label: "expired", tone: "red" }
          : ev && ev.expiring_30d > 0
            ? { count: ev.expiring_30d, label: "expiring ≤30d", tone: "amber" }
            : undefined,
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Your evidence spine</CardTitle>
        <CardDescription>
          Understanding → Method → Proof — the obligations you carry, the
          controls that answer them, and the proof behind them.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col md:flex-row md:items-stretch">
          <StageNode stage={stages[0]} />
          <Connector
            caption="answered by"
            broken={
              ob && ob.unanswered > 0
                ? { count: ob.unanswered, label: "unanswered" }
                : undefined
            }
          />
          <StageNode stage={stages[1]} />
          <Connector
            caption="proven by"
            broken={
              ob && ob.unproven > 0
                ? { count: ob.unproven, label: "unproven" }
                : undefined
            }
          />
          <StageNode stage={stages[2]} />
        </div>
      </CardContent>
    </Card>
  );
}
