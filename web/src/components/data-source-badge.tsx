import { Database, FlaskConical, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { DataSource } from "@/lib/use-register";

/**
 * Labels whether a view is showing live register data or the bundled demo
 * dataset (signed out / API unreachable). Faults get a warning treatment so
 * "demo because broken" never masquerades as "demo because signed out".
 */
export function DataSourceBadge({
  source,
  error,
}: {
  source: DataSource;
  error?: string | null;
}) {
  if (source === "live") {
    return (
      <Badge
        variant="outline"
        className="border-emerald-600/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
        title="Live register data from the API"
      >
        <Database /> Live
      </Badge>
    );
  }

  if (error) {
    return (
      <Badge
        variant="outline"
        className="border-amber-600/20 bg-amber-500/10 text-amber-700 dark:text-amber-400"
        title={`Falling back to demo data: ${error}`}
      >
        <TriangleAlert /> Demo data — API unreachable
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className="text-muted-foreground"
      title="Showing sample policies — sign in to see your live register."
    >
      <FlaskConical /> Demo data
    </Badge>
  );
}
