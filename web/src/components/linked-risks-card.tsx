"use client";

import { ShieldAlert } from "lucide-react";
import Link from "next/link";

import { AcceptanceBadge, RiskBandBadge } from "@/components/risk-badges";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { bandOf, type LinkedRisk } from "@/lib/use-risks";

/**
 * "Risks citing this object" — rendered on policy and evidence detail pages
 * from the server's reverse lookup. Hidden entirely when nothing links here.
 */
export function LinkedRisksCard({
  risks,
  description,
}: {
  risks: LinkedRisk[];
  description: string;
}) {
  if (risks.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="size-4" /> Linked risks
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col divide-y">
        {risks.map((r) => {
          const assessed =
            r.round != null &&
            r.residual_likelihood != null &&
            r.residual_impact != null;
          const score = assessed
            ? r.residual_likelihood! * r.residual_impact!
            : null;
          return (
            <div
              key={r.risk_id}
              className="flex flex-wrap items-center gap-2 py-2.5 first:pt-0 last:pb-0"
            >
              <Link
                href={`/risks/view?id=${encodeURIComponent(r.risk_id)}`}
                className="font-mono text-sm underline-offset-2 hover:underline"
              >
                {r.risk_id}
              </Link>
              <span
                className={
                  "min-w-0 flex-1 truncate text-sm" +
                  (r.status === "CLOSED" ? " text-muted-foreground line-through" : "")
                }
              >
                {r.title}
              </span>
              <RiskBandBadge band={score == null ? null : bandOf(score)} score={score} />
              <AcceptanceBadge
                state={
                  !assessed
                    ? "not_assessed"
                    : r.accepted
                      ? "accepted"
                      : "awaiting_acceptance"
                }
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
