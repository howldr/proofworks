"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Static export has no server runtime, so the `/` -> `/dashboard` redirect is
// done at the edge by public/_redirects, with this client-side fallback for
// `next start` / direct loads.
export default function Home() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard");
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
      Loading…
    </main>
  );
}
