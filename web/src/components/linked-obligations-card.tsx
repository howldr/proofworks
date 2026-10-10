import { Scale } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SOURCE_TYPE_LABELS, type LinkedObligation } from "@/lib/use-obligations";

/** The "why does this exist?" card: obligations naming this object. Renders
 *  nothing when there are none — the back-link is a signal, not a fixture. */
export function LinkedObligationsCard({
  obligations,
  description,
}: {
  obligations: LinkedObligation[];
  description: string;
}) {
  if (obligations.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Scale className="size-4 text-muted-foreground" />
          Obligations
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {obligations.map((o) => (
          <Link
            key={o.obligation_id}
            href={`/obligations/view?id=${encodeURIComponent(o.obligation_id)}`}
            className="flex items-center justify-between gap-3 rounded-lg border p-2.5 text-sm hover:bg-muted/50"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{o.title}</p>
              <p className="truncate font-mono text-xs text-muted-foreground">
                {o.obligation_id} · {o.source_name}
                {o.source_ref ? ` ${o.source_ref}` : ""}
              </p>
            </div>
            <Badge variant="outline" className="shrink-0 text-muted-foreground">
              {SOURCE_TYPE_LABELS[o.source_type] ?? o.source_type}
            </Badge>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
