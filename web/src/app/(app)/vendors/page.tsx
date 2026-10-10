import { Suspense } from "react";

import { VendorsView } from "@/components/vendors-view";
import { Skeleton } from "@/components/ui/skeleton";

/** The list filter syncs from ?q= (header search) — useSearchParams requires
 *  a Suspense boundary when the route is prerendered (ADR 0002). */
export default function VendorsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <VendorsView />
    </Suspense>
  );
}
