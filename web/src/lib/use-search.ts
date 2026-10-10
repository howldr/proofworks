"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Local filter state for a list view, seeded and re-synced from the ?q=
 * search param so the header search drives the page. Typing in the page's
 * own filter box still works locally without touching the URL.
 *
 * useSearchParams means the consuming page needs a Suspense boundary when
 * prerendered (ADR 0002 static export) — same rule as the detail pages.
 */
export function useSearchQuery(): [string, (v: string) => void] {
  const params = useSearchParams();
  const urlQ = params.get("q") ?? "";
  const [query, setQuery] = useState(urlQ);
  // Derive-during-render (not an effect): when the URL's q changes, adopt it.
  const [prevUrlQ, setPrevUrlQ] = useState(urlQ);
  if (urlQ !== prevUrlQ) {
    setPrevUrlQ(urlQ);
    setQuery(urlQ);
  }
  return [query, setQuery];
}
