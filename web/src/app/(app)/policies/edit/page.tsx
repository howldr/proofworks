import { Suspense } from "react";

import { EditPolicyView } from "@/components/edit-policy-view";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Edit lives at /policies/edit?id=POL-YYYY-NNN — like the detail view, the
 * static export (ADR 0002) needs useSearchParams behind a Suspense boundary.
 */
export default function EditPolicyPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full max-w-2xl" />}>
      <EditPolicyView />
    </Suspense>
  );
}
