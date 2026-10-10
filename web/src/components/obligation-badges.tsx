import { Badge } from "@/components/ui/badge";
import type { ObligationCoverage } from "@/lib/use-obligations";

/** Coverage is the register's headline: an ACTIVE obligation nothing links
 *  to is unanswered — the loudest state it can be in. */
export function CoverageBadge({ state }: { state: ObligationCoverage }) {
  if (state === "answered") {
    return (
      <Badge
        variant="outline"
        className="border-emerald-600/40 text-emerald-700 dark:text-emerald-400"
        title="At least one policy, risk, or evidence item answers this obligation"
      >
        answered
      </Badge>
    );
  }
  if (state === "unanswered") {
    return (
      <Badge
        variant="outline"
        className="border-amber-600/40 text-amber-700 dark:text-amber-400"
        title="Nothing is linked to this obligation yet"
      >
        unanswered
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground" title="Retired">
      retired
    </Badge>
  );
}
