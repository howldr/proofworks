import { CheckCircle2, CircleDashed, HelpCircle, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { VendorDecisionState, VendorTier } from "@/lib/use-vendors";

const TIER_STYLES: Record<VendorTier, string> = {
  low:      "border-emerald-600/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  medium:   "border-amber-600/20 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  high:     "border-orange-600/20 bg-orange-500/10 text-orange-700 dark:text-orange-400",
  critical: "border-red-600/20 bg-red-500/10 text-red-700 dark:text-red-400",
};

/** Criticality tier chip. High/critical tiers escalate the decision to an
 *  admin or governance lead. */
export function TierBadge({ tier }: { tier: VendorTier }) {
  return (
    <Badge variant="outline" className={TIER_STYLES[tier] + " capitalize"}>
      {tier}
    </Badge>
  );
}

const DECISION_STYLES: Record<
  VendorDecisionState,
  { label: string; className: string; Icon: typeof CheckCircle2 }
> = {
  approved: {
    label: "approved",
    className: "border-emerald-600/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    Icon: CheckCircle2,
  },
  declined: {
    label: "declined",
    className: "border-red-600/20 bg-red-500/10 text-red-700 dark:text-red-400",
    Icon: XCircle,
  },
  awaiting_decision: {
    label: "awaiting decision",
    className: "border-blue-600/20 bg-blue-500/10 text-blue-700 dark:text-blue-400",
    Icon: CircleDashed,
  },
  not_assessed: {
    label: "not assessed",
    className: "border-border bg-muted text-muted-foreground",
    Icon: HelpCircle,
  },
};

export function DecisionBadge({ state }: { state: VendorDecisionState }) {
  const { label, className, Icon } = DECISION_STYLES[state];
  return (
    <Badge variant="outline" className={className}>
      <Icon className="size-3" />
      {label}
    </Badge>
  );
}
