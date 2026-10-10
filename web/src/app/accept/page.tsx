"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, FileCheck, Loader2, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { API_BASE } from "@/lib/api";

type AttestSummary = {
  organisation: string;
  policy: { id: string; title: string; version: string };
  recipient: string;
  deadline: string | null;
  document_checksum: string | null;
  attested_at: string | null;
  message?: string;
};

function isoDay(value: string | null): string {
  if (!value) return "—";
  return value.slice(0, 10);
}

/**
 * Public read-and-accept page. No login: the high-entropy token in the URL
 * (minted per recipient at distribution) is the authorisation. Clicking
 * accept records the attestation against the exact published document.
 */
function AcceptInner() {
  const params = useSearchParams();
  const token = params.get("t");

  const [summary, setSummary] = useState<AttestSummary | null>(null);
  const [loading, setLoading] = useState(Boolean(token));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const error = !token
    ? "This acceptance link is incomplete. Please use the link from your message."
    : fetchError;

  useEffect(() => {
    if (!token) return;
    let active = true;
    fetch(`${API_BASE}/api/attest/${encodeURIComponent(token)}`, {
      cache: "no-store",
    })
      .then(async (res) => {
        const body = (await res.json()) as AttestSummary & { error?: string };
        if (!active) return;
        if (!res.ok) {
          setFetchError(body.error ?? "This acceptance link is not valid.");
        } else {
          setSummary(body);
          if (body.attested_at) setDone(body.attested_at);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setFetchError("We could not reach the acceptance service. Please try again shortly.");
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  async function accept() {
    if (!token) return;
    setBusy(true);
    setFetchError(null);
    try {
      const res = await fetch(`${API_BASE}/api/attest/${encodeURIComponent(token)}`, {
        method: "POST",
        cache: "no-store",
      });
      const body = (await res.json()) as AttestSummary & { error?: string };
      if (!res.ok) {
        setFetchError(body.error ?? "Something went wrong — please try again.");
      } else {
        setDone(body.attested_at ?? new Date().toISOString());
      }
    } catch {
      setFetchError("We could not reach the acceptance service. Please try again shortly.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2 text-muted-foreground">
          <ShieldCheck className="size-5" />
          <span className="text-sm font-medium">howldr ProofWorks</span>
        </div>

        <Card>
          {loading ? (
            <CardContent className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading your policy…
            </CardContent>
          ) : error && !summary ? (
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              {error}
            </CardContent>
          ) : summary ? (
            <>
              <CardHeader>
                <CardTitle className="text-lg">{summary.policy.title}</CardTitle>
                <CardDescription>
                  {summary.organisation} · {summary.policy.id}{" "}
                  {summary.policy.version}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="rounded-md border bg-muted/40 px-4 py-3 text-sm">
                  <div className="flex justify-between py-0.5">
                    <span className="text-muted-foreground">For</span>
                    <span className="font-medium">{summary.recipient}</span>
                  </div>
                  <div className="flex justify-between py-0.5">
                    <span className="text-muted-foreground">Respond by</span>
                    <span className="font-medium">{isoDay(summary.deadline)}</span>
                  </div>
                  {summary.document_checksum && (
                    <div className="flex justify-between gap-4 py-0.5">
                      <span className="text-muted-foreground">Document</span>
                      <code
                        className="truncate text-xs text-muted-foreground"
                        title={summary.document_checksum}
                      >
                        {summary.document_checksum.slice(0, 16)}…
                      </code>
                    </div>
                  )}
                </div>

                {done ? (
                  <div className="flex flex-col items-center gap-2 py-4 text-center">
                    <CheckCircle2 className="size-8 text-emerald-600 dark:text-emerald-400" />
                    <p className="text-sm font-medium">
                      Your acceptance has been recorded.
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Recorded {isoDay(done)} · you can close this page.
                    </p>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">
                      The policy document was sent to you as a secure message.
                      Please read it before accepting. By clicking below you
                      confirm: <em>I have read, understood, and accept this
                      policy.</em>
                    </p>
                    <Button onClick={() => void accept()} disabled={busy} className="w-full">
                      {busy ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <FileCheck />
                      )}
                      I have read and accept
                    </Button>
                    {error && (
                      <p className="text-center text-sm text-destructive">{error}</p>
                    )}
                  </>
                )}
              </CardContent>
            </>
          ) : null}
        </Card>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Your acceptance is recorded with a timestamp and tied to the exact
          document version you were sent.
        </p>
      </div>
    </main>
  );
}

export default function AcceptPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-svh items-center justify-center p-6">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </main>
      }
    >
      <AcceptInner />
    </Suspense>
  );
}
