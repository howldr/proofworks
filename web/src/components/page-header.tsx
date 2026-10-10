"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bell, Search } from "lucide-react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { labelForPath, searchTargetForPath } from "@/lib/routes";

const SEARCH_INPUT_CLASS =
  "h-8 w-56 rounded-lg border border-input bg-background pl-8 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** Module-aware search. On a searchable register it live-filters via ?q=
 *  (the list views sync from the param); anywhere else, Enter jumps to the
 *  module's register carrying the query. */
function HeaderSearch() {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const target = searchTargetForPath(pathname);
  const onList = pathname === target.list;
  const urlQ = onList ? (params.get("q") ?? "") : "";

  const [value, setValue] = useState(urlQ);
  // Derive-during-render (not an effect): re-seed when the route changes, or
  // when something else set ?q=.
  const seed = `${pathname}|${urlQ}`;
  const [prevSeed, setPrevSeed] = useState(seed);
  if (seed !== prevSeed) {
    setPrevSeed(seed);
    setValue(urlQ);
  }

  function navigate(q: string, replace: boolean) {
    const url = q
      ? `${target.list}?q=${encodeURIComponent(q)}`
      : target.list;
    if (replace) router.replace(url, { scroll: false });
    else router.push(url);
  }

  return (
    <input
      type="search"
      value={value}
      placeholder={`Search ${target.noun}…`}
      onChange={(e) => {
        setValue(e.target.value);
        if (onList) navigate(e.target.value, true);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") navigate(value, onList);
      }}
      className={SEARCH_INPUT_CLASS}
    />
  );
}

export function PageHeader() {
  const pathname = usePathname();
  const label = labelForPath(pathname);
  const isDashboard = pathname === "/dashboard";

  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 !h-4" />
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem className="hidden sm:block">
            <BreadcrumbLink render={<Link href="/dashboard" />}>
              ProofWorks
            </BreadcrumbLink>
          </BreadcrumbItem>
          {!isDashboard && (
            <BreadcrumbSeparator className="hidden sm:block" />
          )}
          <BreadcrumbItem>
            <BreadcrumbPage>{label}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="ml-auto flex items-center gap-2">
        <div className="relative hidden md:block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          {/* useSearchParams needs Suspense when prerendered (ADR 0002). */}
          <Suspense
            fallback={
              <input
                type="search"
                placeholder="Search…"
                disabled
                className={SEARCH_INPUT_CLASS}
              />
            }
          >
            <HeaderSearch />
          </Suspense>
        </div>
        <Button variant="ghost" size="icon" aria-label="Notifications">
          <Bell />
        </Button>
      </div>
    </header>
  );
}
