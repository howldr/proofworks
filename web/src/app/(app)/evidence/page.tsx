import { Suspense } from "react";

import { EvidenceView } from "@/components/evidence-view";
import { Skeleton } from "@/components/ui/skeleton";

/** The list filter syncs from ?q= (header search) — useSearchParams requires
 *  a Suspense boundary when the route is prerendered (ADR 0002). */
export default function EvidencePage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <EvidenceView />
    </Suspense>
  );
}
