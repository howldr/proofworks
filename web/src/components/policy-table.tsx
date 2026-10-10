import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  daysUntil,
  STATUS_STYLES,
  type Policy,
} from "@/lib/policies";

function ReviewCell({ date }: { date: string | null }) {
  const d = date ? daysUntil(date) : NaN;
  // No review date yet (a fresh draft) — say nothing rather than "in NaNd".
  if (Number.isNaN(d)) return <span className="text-muted-foreground">—</span>;
  const overdue = d < 0;
  const soon = d >= 0 && d <= 30;
  return (
    <div className="flex flex-col">
      <span className="tabular-nums">{date}</span>
      <span
        className={
          "text-xs " +
          (overdue
            ? "text-destructive"
            : soon
              ? "text-amber-600 dark:text-amber-400"
              : "text-muted-foreground")
        }
      >
        {overdue
          ? `${Math.abs(d)}d overdue`
          : d === 0
            ? "due today"
            : `in ${d}d`}
      </span>
    </div>
  );
}

export function PolicyTable({
  policies,
  showAck = true,
}: {
  policies: Policy[];
  showAck?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead className="w-[130px]">ID</TableHead>
            <TableHead>Policy</TableHead>
            <TableHead className="hidden md:table-cell">Category</TableHead>
            <TableHead className="w-[90px]">Version</TableHead>
            <TableHead>Status</TableHead>
            {showAck && (
              <TableHead className="hidden lg:table-cell">Accepted</TableHead>
            )}
            <TableHead className="hidden sm:table-cell">Next review</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {policies.map((p) => (
            <TableRow key={p.policy_id} className="group">
              <TableCell className="font-mono text-xs text-muted-foreground">
                <Link
                  href={`/policies/view?id=${encodeURIComponent(p.policy_id)}`}
                  className="hover:text-foreground hover:underline"
                >
                  {p.policy_id}
                </Link>
              </TableCell>
              <TableCell className="font-medium">{p.title}</TableCell>
              <TableCell className="hidden md:table-cell text-muted-foreground">
                {p.category}
              </TableCell>
              <TableCell className="tabular-nums text-muted-foreground">
                {p.current_version}
              </TableCell>
              <TableCell>
                <Badge variant="outline" className={STATUS_STYLES[p.status]}>
                  {p.status}
                </Badge>
              </TableCell>
              {showAck && (
                <TableCell className="hidden lg:table-cell">
                  {p.acknowledgement_total > 0 ? (
                    <span className="tabular-nums text-muted-foreground">
                      {p.acknowledgement_count}/{p.acknowledgement_total}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              )}
              <TableCell className="hidden sm:table-cell">
                <ReviewCell date={p.next_review_date} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
