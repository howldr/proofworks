import { FileCheck2, Fingerprint, MessageSquareQuote } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { EvidenceStrength } from "@/lib/use-evidence";

/** held → we have the bytes; fingerprinted → we can verify a produced copy;
 *  declared → attestation only. Auditors deal in exactly these gradations. */
const STYLES: Record<EvidenceStrength, { label: string; className: string; Icon: typeof FileCheck2 }> = {
  held: {
    label: "held",
    className:
      "border-emerald-600/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    Icon: FileCheck2,
  },
  fingerprinted: {
    label: "fingerprinted",
    className: "border-blue-600/20 bg-blue-500/10 text-blue-700 dark:text-blue-400",
    Icon: Fingerprint,
  },
  declared: {
    label: "declared",
    className: "border-border bg-muted text-muted-foreground",
    Icon: MessageSquareQuote,
  },
};

export function EvidenceStrengthBadge({ strength }: { strength: EvidenceStrength }) {
  const { label, className, Icon } = STYLES[strength];
  return (
    <Badge variant="outline" className={className}>
      <Icon className="size-3" />
      {label}
    </Badge>
  );
}
