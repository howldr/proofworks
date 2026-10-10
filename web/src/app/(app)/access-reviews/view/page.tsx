import { Suspense } from "react";

import { AccessReviewDetailView } from "@/components/access-review-detail-view";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Access review detail lives at /access-reviews/view?id=ARV-YYYY-NNN rather
 * than a dynamic segment: the app is a static export (ADR 0002), which cannot
 * prerender unknown dynamic params. useSearchParams requires a Suspense
 * boundary when the route is prerendered.
 */
export default function AccessReviewViewPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <AccessReviewDetailView />
    </Suspense>
  );
}
