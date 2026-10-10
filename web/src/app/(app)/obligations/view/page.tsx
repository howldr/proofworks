import { Suspense } from "react";

import { ObligationDetailView } from "@/components/obligation-detail-view";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Obligation detail lives at /obligations/view?id=OBL-YYYY-NNN rather than a
 * dynamic segment: the app is a static export (ADR 0002), which cannot
 * prerender unknown dynamic params. useSearchParams requires a Suspense
 * boundary when the route is prerendered.
 */
export default function ObligationViewPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <ObligationDetailView />
    </Suspense>
  );
}
