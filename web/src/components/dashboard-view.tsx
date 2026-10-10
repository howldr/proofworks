"use client";

import {
  Activity,
  CalendarClock,
  ClipboardCheck,
  FileCheck2,
  Files,
  Handshake,
  Lock,
  Scale,
  ShieldAlert,
  UserCheck,
} from "lucide-react";
import Link from "next/link";

import { ApiStatus } from "@/components/api-status";
import { DataSourceBadge } from "@/components/data-source-badge";
import { LifecycleFlow } from "@/components/lifecycle-flow";
import { PolicyTable } from "@/components/policy-table";
import { RiskBandBadge } from "@/components/risk-badges";
import { TierBadge } from "@/components/vendor-badges";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { daysUntil, STATUS_STYLES, summarise } from "@/lib/policies";
import { useDashboard, type SpineEvent } from "@/lib/use-dashboard";
import { useRegister } from "@/lib/use-register";

const OBJECT_VIEW: Record<string, string> = {
  policy: "/policies/view",
  evidence: "/evidence/view",
  risk: "/risks/view",
  access_review: "/access-reviews/view",
  vendor: "/vendors/view",
  obligation: "/obligations/view",
};

function eventHref(e: SpineEvent): string | null {
  const base = OBJECT_VIEW[e.object_type];
  return base ? `${base}?id=${encodeURIComponent(e.object_id)}` : null;
}

export function DashboardView() {
  const { policies, source, loading, error } = useRegister();
  const { data: suite } = useDashboard();

  const s = summarise(policies);
  const live = policies.filter((p) => p.status !== "RETIRED");

  const attention = live
    .filter(
      (p) =>
        p.status === "PENDING ACCEPTANCE" ||
        p.status === "UNDER REVIEW" ||
        daysUntil(p.next_review_date) <= 30,
    )
    .slice(0, 5);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
            {!loading && <DataSourceBadge source={source} error={error} />}
          </div>
          <p className="text-sm text-muted-foreground">
            Lifecycle status across your policy register.
          </p>
        </div>
        <Button
          render={<Link href="/policies" />}
          nativeButton={false}
          variant="outline"
        >
          View register
        </Button>
      </div>

      {suite && (suite.obligations || suite.evidence) && <LifecycleFlow suite={suite} />}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Live policies"
          value={s.total}
          hint="Excludes retired"
          icon={Files}
        />
        <StatCard
          label="Active"
          value={s.active}
          hint="Fully accepted & live"
          icon={FileCheck2}
        />
        <StatCard
          label="Pending acceptance"
          value={s.pendingAcceptance}
          hint="Awaiting staff sign-off"
          icon={ClipboardCheck}
        />
        <StatCard
          label="Review due ≤30d"
          value={s.dueWithin30Days}
          hint="Upcoming review window"
          icon={CalendarClock}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Policy register</CardTitle>
              <CardDescription>
                Most recent policies and their lifecycle status.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex flex-col gap-2">
                  {Array.from({ length: 5 }, (_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : (
                <PolicyTable policies={live.slice(0, 6)} />
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Needs attention</CardTitle>
              <CardDescription>
                Pending sign-offs and upcoming reviews.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {attention.length === 0 && !loading && (
                <p className="text-sm text-muted-foreground">
                  Nothing needs attention right now.
                </p>
              )}
              {attention.map((p) => (
                <Link
                  key={p.policy_id}
                  href={`/policies/view?id=${encodeURIComponent(p.policy_id)}`}
                  className="flex items-center justify-between gap-3 rounded-lg border p-2.5 text-sm hover:bg-muted/50"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{p.title}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {p.policy_id}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={STATUS_STYLES[p.status] + " shrink-0"}
                  >
                    {p.status}
                  </Badge>
                </Link>
              ))}
            </CardContent>
          </Card>

          <ApiStatus />
        </div>
      </div>

      {(suite?.evidence || suite?.risks || suite?.access_reviews || suite?.obligations || suite?.recent_events) && (
        <div className="grid gap-6 lg:grid-cols-3">
          {suite.evidence && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Lock className="size-4 text-muted-foreground" /> Evidence
                </CardTitle>
                <CardDescription>
                  {suite.evidence.active} active
                  {suite.evidence.expired > 0 && ` · ${suite.evidence.expired} expired`}
                  {suite.evidence.expiring_30d > 0 &&
                    ` · ${suite.evidence.expiring_30d} expiring ≤30d`}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {suite.evidence.attention.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nothing expired or expiring soon.
                  </p>
                ) : (
                  suite.evidence.attention.map((i) => (
                    <Link
                      key={i.evidence_id}
                      href={`/evidence/view?id=${encodeURIComponent(i.evidence_id)}`}
                      className="flex items-center justify-between gap-3 rounded-lg border p-2.5 text-sm hover:bg-muted/50"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{i.title}</p>
                        <p className="font-mono text-xs text-muted-foreground">
                          {i.evidence_id}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={
                          "shrink-0 " +
                          (i.expired
                            ? "border-red-600/20 bg-red-500/10 text-red-700 dark:text-red-400"
                            : "border-amber-600/20 bg-amber-500/10 text-amber-700 dark:text-amber-400")
                        }
                      >
                        {i.expired ? "expired" : i.expires_at}
                      </Badge>
                    </Link>
                  ))
                )}
                <Button
                  render={<Link href="/evidence" />}
                  nativeButton={false}
                  variant="ghost"
                  size="sm"
                  className="self-start text-muted-foreground"
                >
                  Open Evidence Locker
                </Button>
              </CardContent>
            </Card>
          )}

          {suite.risks && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldAlert className="size-4 text-muted-foreground" /> Risks
                </CardTitle>
                <CardDescription>
                  {suite.risks.open} open
                  {suite.risks.awaiting_acceptance > 0 &&
                    ` · ${suite.risks.awaiting_acceptance} awaiting acceptance`}
                  {suite.risks.review_overdue > 0 &&
                    ` · ${suite.risks.review_overdue} review overdue`}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {suite.risks.attention.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No risks awaiting acceptance.
                  </p>
                ) : (
                  suite.risks.attention.map((r) => (
                    <Link
                      key={r.risk_id}
                      href={`/risks/view?id=${encodeURIComponent(r.risk_id)}`}
                      className="flex items-center justify-between gap-3 rounded-lg border p-2.5 text-sm hover:bg-muted/50"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{r.title}</p>
                        <p className="font-mono text-xs text-muted-foreground">
                          {r.risk_id}
                        </p>
                      </div>
                      <RiskBandBadge band={r.residual_band} score={r.residual_score} />
                    </Link>
                  ))
                )}
                <Button
                  render={<Link href="/risks" />}
                  nativeButton={false}
                  variant="ghost"
                  size="sm"
                  className="self-start text-muted-foreground"
                >
                  Open Risk Register
                </Button>
              </CardContent>
            </Card>
          )}

          {suite.access_reviews && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <UserCheck className="size-4 text-muted-foreground" /> Access reviews
                </CardTitle>
                <CardDescription>
                  {suite.access_reviews.open} open
                  {suite.access_reviews.ready_to_attest > 0 &&
                    ` · ${suite.access_reviews.ready_to_attest} ready to attest`}
                  {suite.access_reviews.overdue > 0 &&
                    ` · ${suite.access_reviews.overdue} overdue`}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {suite.access_reviews.attention.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No open access reviews.</p>
                ) : (
                  suite.access_reviews.attention.map((r) => (
                    <Link
                      key={r.review_id}
                      href={`/access-reviews/view?id=${encodeURIComponent(r.review_id)}`}
                      className="flex items-center justify-between gap-3 rounded-lg border p-2.5 text-sm hover:bg-muted/50"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{r.title}</p>
                        <p className="font-mono text-xs text-muted-foreground">
                          {r.lines_decided}/{r.lines_total} decided
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={
                          "shrink-0 " +
                          (r.overdue
                            ? "border-red-600/20 bg-red-500/10 text-red-700 dark:text-red-400"
                            : "border-border bg-muted text-muted-foreground")
                        }
                      >
                        {r.overdue ? "overdue" : r.due_date ?? r.system}
                      </Badge>
                    </Link>
                  ))
                )}
                <Button
                  render={<Link href="/access-reviews" />}
                  nativeButton={false}
                  variant="ghost"
                  size="sm"
                  className="self-start text-muted-foreground"
                >
                  Open Access Reviews
                </Button>
              </CardContent>
            </Card>
          )}

          {suite.vendors && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Handshake className="size-4 text-muted-foreground" /> Vendors
                </CardTitle>
                <CardDescription>
                  {suite.vendors.open} open
                  {suite.vendors.awaiting_decision > 0 &&
                    ` · ${suite.vendors.awaiting_decision} awaiting decision`}
                  {suite.vendors.review_overdue > 0 &&
                    ` · ${suite.vendors.review_overdue} review overdue`}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {suite.vendors.attention.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No vendors awaiting a decision.
                  </p>
                ) : (
                  suite.vendors.attention.map((v) => (
                    <Link
                      key={v.vendor_id}
                      href={`/vendors/view?id=${encodeURIComponent(v.vendor_id)}`}
                      className="flex items-center justify-between gap-3 rounded-lg border p-2.5 text-sm hover:bg-muted/50"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{v.name}</p>
                        <p className="font-mono text-xs text-muted-foreground">
                          {v.vendor_id}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <TierBadge tier={v.tier} />
                        <RiskBandBadge band={v.residual_band} score={v.residual_score} />
                      </div>
                    </Link>
                  ))
                )}
                <Button
                  render={<Link href="/vendors" />}
                  nativeButton={false}
                  variant="ghost"
                  size="sm"
                  className="self-start text-muted-foreground"
                >
                  Open Vendor Assessments
                </Button>
              </CardContent>
            </Card>
          )}

          {suite.obligations && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Scale className="size-4 text-muted-foreground" /> Obligations
                </CardTitle>
                <CardDescription>
                  {suite.obligations.active} active
                  {suite.obligations.unanswered > 0 &&
                    ` · ${suite.obligations.unanswered} unanswered`}
                  {suite.obligations.review_overdue > 0 &&
                    ` · ${suite.obligations.review_overdue} review overdue`}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {suite.obligations.attention.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Every obligation has something answering it.
                  </p>
                ) : (
                  suite.obligations.attention.map((o) => (
                    <Link
                      key={o.obligation_id}
                      href={`/obligations/view?id=${encodeURIComponent(o.obligation_id)}`}
                      className="flex items-center justify-between gap-3 rounded-lg border p-2.5 text-sm hover:bg-muted/50"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{o.title}</p>
                        <p className="truncate font-mono text-xs text-muted-foreground">
                          {o.obligation_id} · {o.source_name}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className="shrink-0 border-amber-600/40 text-amber-700 dark:text-amber-400"
                      >
                        unanswered
                      </Badge>
                    </Link>
                  ))
                )}
                <Button
                  render={<Link href="/obligations" />}
                  nativeButton={false}
                  variant="ghost"
                  size="sm"
                  className="self-start text-muted-foreground"
                >
                  Open Obligations
                </Button>
              </CardContent>
            </Card>
          )}

          {suite.recent_events && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Activity className="size-4 text-muted-foreground" /> Recent activity
                </CardTitle>
                <CardDescription>
                  The audit spine — every module, one ledger.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {suite.recent_events.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No events yet.</p>
                ) : (
                  suite.recent_events.map((e) => {
                    const href = eventHref(e);
                    const body = (
                      <>
                        <div className="min-w-0">
                          <p className="truncate">{e.action}</p>
                          <p className="font-mono text-xs text-muted-foreground">
                            {e.object_id}
                            {e.actor_email ? ` · ${e.actor_email}` : ""}
                          </p>
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {String(e.occurred_at).slice(0, 10)}
                        </span>
                      </>
                    );
                    return href ? (
                      <Link
                        key={e.id}
                        href={href}
                        className="flex items-baseline justify-between gap-3 rounded-lg border p-2.5 text-sm hover:bg-muted/50"
                      >
                        {body}
                      </Link>
                    ) : (
                      <div
                        key={e.id}
                        className="flex items-baseline justify-between gap-3 rounded-lg border p-2.5 text-sm"
                      >
                        {body}
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
