import { Suspense } from "react";

import { PolicyDetailView } from "@/components/policy-detail-view";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Policy detail lives at /policies/view?id=POL-YYYY-NNN rather than a
 * dynamic segment: the app is a static export (ADR 0002), which cannot
 * prerender unknown dynamic params. useSearchParams requires a Suspense
 * boundary when the route is prerendered.
 */
export default function PolicyViewPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <PolicyDetailView />
    </Suspense>
  );
}
