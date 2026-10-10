import { CheckCircle2, CircleDashed, ClipboardCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { LineDecision, ProgressState } from "@/lib/use-access-reviews";

const PROGRESS: Record<
  ProgressState,
  { label: string; className: string; Icon: typeof CheckCircle2 }
> = {
  in_review: {
    label: "in review",
    className: "border-blue-600/20 bg-blue-500/10 text-blue-700 dark:text-blue-400",
    Icon: CircleDashed,
  },
  ready_to_attest: {
    label: "ready to attest",
    className: "border-amber-600/20 bg-amber-500/10 text-amber-700 dark:text-amber-400",
    Icon: ClipboardCheck,
  },
  attested: {
    label: "attested",
    className: "border-emerald-600/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    Icon: CheckCircle2,
  },
};

export function ProgressBadge({ state }: { state: ProgressState }) {
  const { label, className, Icon } = PROGRESS[state];
  return (
    <Badge variant="outline" className={className}>
      <Icon className="size-3" />
      {label}
    </Badge>
  );
}

const DECISION: Record<LineDecision, string> = {
  keep: "border-emerald-600/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  flag: "border-amber-600/20 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  remove: "border-red-600/20 bg-red-500/10 text-red-700 dark:text-red-400",
};

export function DecisionBadge({ decision }: { decision: LineDecision | null }) {
  if (decision == null) {
    return (
      <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
        undecided
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className={DECISION[decision]}>
      {decision}
    </Badge>
  );
}
