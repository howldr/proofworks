"use client";

import {
  AlarmClockMinus,
  CalendarClock,
  CalendarRange,
  RefreshCw,
} from "lucide-react";

import { DataSourceBadge } from "@/components/data-source-badge";
import { EmptyState } from "@/components/empty-state";
import { PolicyTable } from "@/components/policy-table";
import { StatCard } from "@/components/stat-card";
import { Skeleton } from "@/components/ui/skeleton";
import { daysUntil, type Policy } from "@/lib/policies";
import { useRegister } from "@/lib/use-register";

function byReviewDate(a: Policy, b: Policy) {
  return a.next_review_date.localeCompare(b.next_review_date);
}

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

export function ReviewsView() {
  const { policies, source, loading, error } = useRegister();

  // Review cycles only apply once a policy has been authorised — drafts have
  // no next_review_date yet, and retired policies are out of scope.
  const scheduled = policies
    .filter((p) => p.status !== "RETIRED" && p.next_review_date)
    .sort(byReviewDate);

  const inReview = scheduled.filter((p) => p.status === "UNDER REVIEW");
  const rest = scheduled.filter((p) => p.status !== "UNDER REVIEW");
  const overdue = rest.filter((p) => daysUntil(p.next_review_date) < 0);
  const dueSoon = rest.filter((p) => {
    const d = daysUntil(p.next_review_date);
    return d >= 0 && d <= 30;
  });
  const upcoming = rest.filter((p) => daysUntil(p.next_review_date) > 30);

  return (
    <>
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Policy Reviews</h1>
          {!loading && <DataSourceBadge source={source} error={error} />}
        </div>
        <p className="text-sm text-muted-foreground">
          Scheduled review cycles and advance-notice warnings.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Overdue"
          value={overdue.length}
          hint="Past review date, not in review"
          icon={AlarmClockMinus}
        />
        <StatCard
          label="Due ≤30d"
          value={dueSoon.length}
          hint="Advance-notice window"
          icon={CalendarClock}
        />
        <StatCard
          label="In review now"
          value={inReview.length}
          hint="Review cycle in progress"
          icon={RefreshCw}
        />
        <StatCard
          label="Scheduled later"
          value={upcoming.length}
          hint="Beyond the 30-day window"
          icon={CalendarRange}
        />
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : scheduled.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No review cycles scheduled"
          description="Once a policy is approved it gets a next-review date; 30-day advance warnings, triggered cycles, and overdue escalations appear here."
        />
      ) : (
        <>
          <Section
            title="Overdue"
            hint="Past their review date without a review cycle started — the scheduler escalates these."
            policies={overdue}
          />
          <Section
            title="Due within 30 days"
            hint="Inside the advance-notice window — owners have been warned."
            policies={dueSoon}
          />
          <Section
            title="In review now"
            hint="Review cycle in progress, awaiting approver sign-off."
            policies={inReview}
          />
          <Section
            title="Scheduled"
            hint="Next review more than 30 days out."
            policies={upcoming}
          />
        </>
      )}
    </>
  );
}
