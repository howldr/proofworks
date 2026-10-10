"use client";

import { useEffect, useState } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { API_BASE } from "@/lib/api";

type HealthResp =
  | { status: "ok"; db?: { time: string } }
  | { status: "error"; detail: string };

export function ApiStatus() {
  const [health, setHealth] = useState<HealthResp | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`${API_BASE}/health`, { cache: "no-store" })
      .then(async (r): Promise<HealthResp> =>
        r.ok
          ? ((await r.json()) as HealthResp)
          : { status: "error", detail: `HTTP ${r.status}` },
      )
      .catch(
        (e): HealthResp => ({
          status: "error",
          detail: e instanceof Error ? e.message : String(e),
        }),
      )
      .then((h) => {
        if (active) setHealth(h);
      });
    return () => {
      active = false;
    };
  }, []);

  const loading = health === null;
  const ok = health?.status === "ok";

  return (
    <Card>
      <CardHeader>
        <CardDescription>Backend API</CardDescription>
        <CardTitle className="flex items-center gap-2 text-base">
          <span
            className={
              "inline-block size-2.5 rounded-full " +
              (loading
                ? "animate-pulse bg-muted-foreground"
                : ok
                  ? "bg-emerald-500"
                  : "bg-red-500")
            }
            aria-hidden
          />
          {loading ? "Checking…" : ok ? "Healthy" : "Unreachable"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-xs text-muted-foreground">
        <p className="truncate font-mono">{API_BASE}</p>
        {health?.status === "ok" && health.db?.time && (
          <p>db time: {health.db.time}</p>
        )}
        {health?.status === "error" && (
          <p className="text-destructive">{health.detail}</p>
        )}
      </CardContent>
    </Card>
  );
}
