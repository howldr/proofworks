"use client";

import { useState } from "react";
import {
  Archive,
  ArrowLeft,
  CheckCircle2,
  FileQuestion,
  FileUp,
  Fingerprint,
  History,
  Loader2,
  ShieldQuestion,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { EvidenceStrengthBadge } from "@/components/evidence-strength-badge";
import { LinkedRisksCard } from "@/components/linked-risks-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch, apiUpload } from "@/lib/api";
import { useAuth } from "@/lib/use-auth";
import { useEvidenceDetail } from "@/lib/use-evidence";

const MANAGE_ROLES = new Set(["admin", "howldr_support", "governance_lead"]);

function isoDay(v: string | null): string {
  return v ? v.slice(0, 10) : "—";
}

function MetaItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-words text-sm font-medium">{value}</p>
    </div>
  );
}

export function EvidenceDetailView() {
  const params = useSearchParams();
  const id = params.get("id");
  const { me, email } = useAuth();
  const { item, source, loading, error, notFound, reload } = useEvidenceDetail(id);

  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<null | { match: boolean; expected: string; actual: string }>(null);
  const [digestOpen, setDigestOpen] = useState(false);
  const [digest, setDigest] = useState("");

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (notFound || !item) {
    return (
      <EmptyState
        icon={FileQuestion}
        title="Evidence not found"
        description={id ? `No evidence item ${id} is visible to you.` : "No evidence ID was provided."}
      />
    );
  }

  const canMutate =
    source === "live" &&
    me != null &&
    (MANAGE_ROLES.has(me.role) || (me.role === "owner" && email === item.owner_email));

  async function withBusy(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setMessage(null);
    setActionError(null);
    try {
      await fn();
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  function pickFile(accept: string, onPick: (f: File) => void) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => {
      const f = input.files?.[0];
      if (f) onPick(f);
    };
    input.click();
  }

  const attachFile = () =>
    pickFile("*/*", (f) =>
      withBusy("file", async () => {
        await apiUpload(`/api/evidence/${encodeURIComponent(item.evidence_id)}/file`, f);
        setMessage(`File attached and hash-pinned: ${f.name}`);
      }),
    );

  const fingerprint = () =>
    pickFile("*/*", (f) =>
      withBusy("fingerprint", async () => {
        await apiUpload(`/api/evidence/${encodeURIComponent(item.evidence_id)}/fingerprint`, f);
        setMessage(`Fingerprint captured from ${f.name} — the bytes were not stored.`);
      }),
    );

  const verify = () =>
    pickFile("*/*", (f) =>
      withBusy("verify", async () => {
        const result = await apiUpload<{ match: boolean; expected: string; actual: string }>(
          `/api/evidence/${encodeURIComponent(item.evidence_id)}/verify`,
          f,
        );
        setVerifyResult(result);
      }),
    );

  const verifyDigest = () =>
    withBusy("verify-digest", async () => {
      const result = await apiFetch<{ match: boolean; expected: string; actual: string }>(
        `/api/evidence/${encodeURIComponent(item.evidence_id)}/verify`,
        { method: "POST", body: JSON.stringify({ digest: digest.trim() }) },
      );
      setVerifyResult(result);
      setDigestOpen(false);
      setDigest("");
    });

  const retire = () => {
    if (!window.confirm(`Retire ${item.evidence_id}? It stays on record but leaves the active register.`)) return;
    void withBusy("retire", async () => {
      await apiFetch(`/api/evidence/${encodeURIComponent(item.evidence_id)}/retire`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setMessage("Evidence retired.");
    });
  };

  return (
    <>
      <div>
        <Button
          render={<Link href="/evidence" />}
          nativeButton={false}
          variant="ghost"
          size="sm"
          className="-ml-2 mb-2"
        >
          <ArrowLeft /> Back to Evidence Locker
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{item.title}</h1>
          <EvidenceStrengthBadge strength={item.strength} />
          {item.status === "RETIRED" && (
            <Badge variant="outline" className="text-muted-foreground line-through">
              RETIRED
            </Badge>
          )}
        </div>
        <p className="mt-1 font-mono text-sm text-muted-foreground">{item.evidence_id}</p>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
          {item.description && <CardDescription>{item.description}</CardDescription>}
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetaItem label="Category" value={item.category ?? "—"} />
          <MetaItem label="Control" value={item.control_label ?? "—"} />
          <MetaItem label="Owner" value={item.owner_email} />
          <MetaItem label="Collected" value={isoDay(item.collected_at)} />
          <MetaItem label="Valid until" value={isoDay(item.expires_at)} />
          <MetaItem
            label="Tags"
            value={item.tags.length ? item.tags.join(", ") : "—"}
          />
          {item.locator && <MetaItem label="Locator" value={item.locator} />}
          {item.file_name && <MetaItem label="File" value={item.file_name} />}
          {item.checksum && (
            <MetaItem
              label="SHA-256"
              value={<code className="text-xs">{item.checksum}</code>}
            />
          )}
          {item.superseded_by && (
            <MetaItem
              label="Superseded by"
              value={
                <Link
                  className="underline-offset-2 hover:underline"
                  href={`/evidence/view?id=${encodeURIComponent(item.superseded_by)}`}
                >
                  {item.superseded_by}
                </Link>
              }
            />
          )}
        </CardContent>
      </Card>

      {canMutate && item.status === "ACTIVE" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Actions</CardTitle>
            <CardDescription>
              Every action appends to this item&apos;s permanent event history.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {canMutate && item.strength !== "held" && (
                <Button onClick={attachFile} disabled={busy !== null}>
                  {busy === "file" ? <Loader2 className="animate-spin" /> : <FileUp />}
                  Attach file (hold it here)
                </Button>
              )}
              {canMutate && item.strength === "declared" && (
                <Button variant="outline" onClick={fingerprint} disabled={busy !== null}>
                  {busy === "fingerprint" ? <Loader2 className="animate-spin" /> : <Fingerprint />}
                  Capture fingerprint (don&apos;t store)
                </Button>
              )}
              {canMutate && item.strength === "fingerprinted" && (
                <Button variant="outline" onClick={fingerprint} disabled={busy !== null}>
                  {busy === "fingerprint" ? <Loader2 className="animate-spin" /> : <Fingerprint />}
                  Re-capture fingerprint
                </Button>
              )}
              {canMutate && item.checksum != null && (
                <Button variant="outline" onClick={verify} disabled={busy !== null}>
                  {busy === "verify" ? <Loader2 className="animate-spin" /> : <ShieldQuestion />}
                  Verify a copy
                </Button>
              )}
              {canMutate && item.checksum != null && (
                <Button
                  variant="outline"
                  onClick={() => setDigestOpen((o) => !o)}
                  disabled={busy !== null}
                >
                  <Fingerprint />
                  Verify a digest
                </Button>
              )}
              {canMutate && (
                <Button
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={retire}
                  disabled={busy !== null}
                >
                  {busy === "retire" ? <Loader2 className="animate-spin" /> : <Archive />}
                  Retire
                </Button>
              )}
            </div>

            {digestOpen && (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-muted-foreground">
                  Paste a SHA-256 computed at the source — e.g.{" "}
                  <code>HASHBYTES(&apos;SHA2_256&apos;, …)</code> run inside the
                  database — and it is compared against the recorded fingerprint
                  without the artifact leaving its home.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    value={digest}
                    onChange={(e) => setDigest(e.target.value)}
                    placeholder="64 hex characters"
                    className="max-w-md font-mono text-xs"
                    disabled={busy !== null}
                  />
                  <Button
                    onClick={verifyDigest}
                    disabled={busy !== null || !/^[a-f0-9]{64}$/i.test(digest.trim())}
                  >
                    {busy === "verify-digest" ? <Loader2 className="animate-spin" /> : <ShieldQuestion />}
                    Compare
                  </Button>
                </div>
              </div>
            )}

            {verifyResult && (
              <div
                className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
                  verifyResult.match
                    ? "border-emerald-600/30 text-emerald-700 dark:text-emerald-400"
                    : "border-destructive/40 text-destructive"
                }`}
              >
                {verifyResult.match ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                ) : (
                  <XCircle className="mt-0.5 size-4 shrink-0" />
                )}
                <div>
                  <p className="font-medium">
                    {verifyResult.match
                      ? "Match — this copy is byte-identical to the attested artifact."
                      : "Mismatch — this copy differs from the attested artifact."}
                  </p>
                  {!verifyResult.match && (
                    <p className="mt-1 text-xs">
                      Recorded {verifyResult.expected.slice(0, 16)}… · supplied{" "}
                      {verifyResult.actual.slice(0, 16)}… — if the source has been
                      legitimately updated, register the new artifact as a new item.
                    </p>
                  )}
                </div>
              </div>
            )}

            {message && (
              <p className="text-sm text-emerald-700 dark:text-emerald-400">{message}</p>
            )}
            {actionError && <p className="text-sm text-destructive">{actionError}</p>}
          </CardContent>
        </Card>
      )}

      <LinkedRisksCard
        risks={item.linked_risks ?? []}
        description="Register risks citing this item as supporting evidence."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="size-4 text-muted-foreground" />
            Event history
          </CardTitle>
          <CardDescription>Append-only — the item&apos;s chain of custody.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {item.events.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {source === "demo"
                ? "Event history is available when connected to the API."
                : "No events recorded."}
            </p>
          ) : (
            item.events.map((e) => (
              <div key={e.id} className="flex items-baseline justify-between gap-3 rounded-lg border p-2.5 text-sm">
                <span>{e.event}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {e.actor_email ? `${e.actor_email} · ` : ""}
                  {String(e.created_at).slice(0, 10)}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </>
  );
}
