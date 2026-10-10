import { Suspense } from "react";

import { VendorDetailView } from "@/components/vendor-detail-view";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Vendor detail lives at /vendors/view?id=VEN-YYYY-NNN rather than a dynamic
 * segment: the app is a static export (ADR 0002), which cannot prerender
 * unknown dynamic params. useSearchParams requires a Suspense boundary when
 * the route is prerendered.
 */
export default function VendorViewPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <VendorDetailView />
    </Suspense>
  );
}
