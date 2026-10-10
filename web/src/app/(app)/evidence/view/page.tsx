import { Suspense } from "react";

import { EvidenceDetailView } from "@/components/evidence-detail-view";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Evidence detail lives at /evidence/view?id=EVD-YYYY-NNN rather than a
 * dynamic segment: the app is a static export (ADR 0002), which cannot
 * prerender unknown dynamic params. useSearchParams requires a Suspense
 * boundary when the route is prerendered.
 */
export default function EvidenceViewPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <EvidenceDetailView />
    </Suspense>
  );
}
