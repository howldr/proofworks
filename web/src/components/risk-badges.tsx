import { CheckCircle2, CircleDashed, HelpCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { AcceptanceState, RiskBand } from "@/lib/use-risks";

const BAND_STYLES: Record<RiskBand, string> = {
  Low:      "border-emerald-600/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  Medium:   "border-amber-600/20 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  High:     "border-orange-600/20 bg-orange-500/10 text-orange-700 dark:text-orange-400",
  Critical: "border-red-600/20 bg-red-500/10 text-red-700 dark:text-red-400",
};

/** Score band chip, e.g. "Medium · 8". Renders an em-dash chip when the risk
 *  has never been assessed. */
export function RiskBandBadge({
  band,
  score,
}: {
  band: RiskBand | null;
  score: number | null;
}) {
  if (band == null || score == null) {
    return (
      <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
        not assessed
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className={BAND_STYLES[band]}>
      {band} · {score}
    </Badge>
  );
}

const ACCEPTANCE_STYLES: Record<
  AcceptanceState,
  { label: string; className: string; Icon: typeof CheckCircle2 }
> = {
  accepted: {
    label: "accepted",
    className: "border-emerald-600/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    Icon: CheckCircle2,
  },
  awaiting_acceptance: {
    label: "awaiting acceptance",
    className: "border-blue-600/20 bg-blue-500/10 text-blue-700 dark:text-blue-400",
    Icon: CircleDashed,
  },
  not_assessed: {
    label: "not assessed",
    className: "border-border bg-muted text-muted-foreground",
    Icon: HelpCircle,
  },
};

export function AcceptanceBadge({ state }: { state: AcceptanceState }) {
  const { label, className, Icon } = ACCEPTANCE_STYLES[state];
  return (
    <Badge variant="outline" className={className}>
      <Icon className="size-3" />
      {label}
    </Badge>
  );
}
