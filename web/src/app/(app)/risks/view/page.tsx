import { Suspense } from "react";

import { RiskDetailView } from "@/components/risk-detail-view";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Risk detail lives at /risks/view?id=RSK-YYYY-NNN rather than a dynamic
 * segment: the app is a static export (ADR 0002), which cannot prerender
 * unknown dynamic params. useSearchParams requires a Suspense boundary when
 * the route is prerendered.
 */
export default function RiskViewPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <RiskDetailView />
    </Suspense>
  );
}
