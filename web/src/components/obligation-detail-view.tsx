"use client";

import { useState } from "react";
import {
  ArrowLeft,
  FileQuestion,
  History,
  Loader2,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { CoverageBadge } from "@/components/obligation-badges";
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
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/use-auth";
import { SOURCE_TYPE_LABELS, useObligationDetail } from "@/lib/use-obligations";

const MANAGE_ROLES = new Set(["admin", "howldr_support", "governance_lead"]);

function isoDay(v: string | null): string {
  return v ? v.slice(0, 10) : "—";
}

function MetaItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

function IdLinks({ ids, base }: { ids: string[]; base: string }) {
  return (
    <>
      {ids.map((x, i) => (
        <span key={x}>
          {i > 0 && ", "}
          <Link
            className="underline-offset-2 hover:underline"
            href={`${base}?id=${encodeURIComponent(x)}`}
          >
            {x}
          </Link>
        </span>
      ))}
    </>
  );
}

export function ObligationDetailView() {
  const params = useSearchParams();
  const id = params.get("id");
  const { me, email } = useAuth();
  const { obligation, source, loading, error, notFound, reload } = useObligationDetail(id);

  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reviewDate, setReviewDate] = useState("");
  const [reviewNotes, setReviewNotes] = useState("");
  const [editingLinks, setEditingLinks] = useState(false);
  const [linksPolicyText, setLinksPolicyText] = useState("");
  const [linksRiskText, setLinksRiskText] = useState("");
  const [linksEvidenceText, setLinksEvidenceText] = useState("");
  const [linksError, setLinksError] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (notFound || !obligation) {
    return (
      <EmptyState
        icon={FileQuestion}
        title="Obligation not found"
        description={id ? `No obligation ${id} is visible to you.` : "No obligation ID was provided."}
      />
    );
  }

  const canMutate =
    source === "live" &&
    me != null &&
    (MANAGE_ROLES.has(me.role) || (me.role === "owner" && email === obligation.owner_email));

  async function run(label: string, path: string, body?: object, done?: string) {
    setBusy(label);
    setMessage(null);
    setActionError(null);
    try {
      await apiFetch(`/api/obligations/${encodeURIComponent(obligation!.obligation_id)}${path}`, {
        method: "POST",
        body: JSON.stringify(body ?? {}),
      });
      if (done) setMessage(done);
      setReviewDate("");
      setReviewNotes("");
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  function openLinkEditor() {
    setLinksPolicyText(obligation!.policy_ids.join(", "));
    setLinksRiskText(obligation!.risk_ids.join(", "));
    setLinksEvidenceText(obligation!.evidence_ids.join(", "));
    setLinksError(null);
    setEditingLinks(true);
  }

  function parseIds(text: string): string[] {
    return [...new Set(text.split(",").map((s) => s.trim()).filter(Boolean))];
  }

  async function saveLinks() {
    setBusy("links");
    setLinksError(null);
    try {
      await apiFetch(`/api/obligations/${encodeURIComponent(obligation!.obligation_id)}`, {
        method: "PUT",
        body: JSON.stringify({
          policyIds: parseIds(linksPolicyText),
          riskIds: parseIds(linksRiskText),
          evidenceIds: parseIds(linksEvidenceText),
        }),
      });
      setEditingLinks(false);
      reload();
    } catch (err) {
      setLinksError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div>
        <Button
          render={<Link href="/obligations" />}
          nativeButton={false}
          variant="ghost"
          size="sm"
          className="-ml-2 mb-2"
        >
          <ArrowLeft /> Back to Obligations
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{obligation.title}</h1>
          <CoverageBadge state={obligation.coverage_state} />
          {obligation.status === "RETIRED" && (
            <Badge variant="outline" className="text-muted-foreground line-through">
              RETIRED
            </Badge>
          )}
        </div>
        <p className="mt-1 font-mono text-sm text-muted-foreground">{obligation.obligation_id}</p>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
          {obligation.description && <CardDescription>{obligation.description}</CardDescription>}
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetaItem
            label="Source"
            value={`${obligation.source_name}${obligation.source_ref ? ` · ${obligation.source_ref}` : ""}`}
          />
          <MetaItem label="Source type" value={SOURCE_TYPE_LABELS[obligation.source_type]} />
          <MetaItem label="Owner" value={obligation.owner_email} />
          <MetaItem label="Next review" value={isoDay(obligation.next_review_date)} />
          {obligation.policy_ids.length > 0 && (
            <MetaItem
              label="Answered by policies"
              value={<IdLinks ids={obligation.policy_ids} base="/policies/view" />}
            />
          )}
          {obligation.risk_ids.length > 0 && (
            <MetaItem
              label="Threatened by risks"
              value={<IdLinks ids={obligation.risk_ids} base="/risks/view" />}
            />
          )}
          {obligation.evidence_ids.length > 0 && (
            <MetaItem
              label="Proven by evidence"
              value={<IdLinks ids={obligation.evidence_ids} base="/evidence/view" />}
            />
          )}
          {canMutate && (
            <div className="sm:col-span-2 lg:col-span-3">
              {!editingLinks ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-2 text-muted-foreground"
                  onClick={openLinkEditor}
                  disabled={busy !== null}
                >
                  Edit links
                </Button>
              ) : (
                <div className="flex flex-col gap-3 rounded-md border p-3">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <label className="flex flex-col gap-1.5">
                      <span className="text-sm font-medium">Policies</span>
                      <Input
                        value={linksPolicyText}
                        onChange={(e) => setLinksPolicyText(e.target.value)}
                        placeholder="POL-2026-001, POL-2026-002"
                        disabled={busy !== null}
                      />
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-sm font-medium">Risks</span>
                      <Input
                        value={linksRiskText}
                        onChange={(e) => setLinksRiskText(e.target.value)}
                        placeholder="RSK-2026-001"
                        disabled={busy !== null}
                      />
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-sm font-medium">Evidence</span>
                      <Input
                        value={linksEvidenceText}
                        onChange={(e) => setLinksEvidenceText(e.target.value)}
                        placeholder="EVD-2026-001"
                        disabled={busy !== null}
                      />
                    </label>
                  </div>
                  {linksError && <p className="text-sm text-destructive">{linksError}</p>}
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => void saveLinks()} disabled={busy !== null}>
                      {busy === "links" ? <Loader2 className="animate-spin" /> : null}
                      Save links
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditingLinks(false)}
                      disabled={busy !== null}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {canMutate && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Actions</CardTitle>
            <CardDescription>
              Sources renew — a review records, in your name, that this
              obligation is still current. Retiring keeps the record; nothing
              is ever deleted.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {obligation.status === "ACTIVE" ? (
              <>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium">Next review</span>
                    <Input
                      type="date"
                      value={reviewDate}
                      onChange={(e) => setReviewDate(e.target.value)}
                      disabled={busy !== null}
                    />
                  </label>
                  <label className="flex min-w-64 flex-1 flex-col gap-1.5">
                    <span className="text-sm font-medium">Notes</span>
                    <Input
                      value={reviewNotes}
                      onChange={(e) => setReviewNotes(e.target.value)}
                      placeholder="e.g. Policy renewed, conditions unchanged"
                      disabled={busy !== null}
                    />
                  </label>
                  <Button
                    onClick={() =>
                      run("review", "/review", {
                        nextReviewDate: reviewDate || undefined,
                        notes: reviewNotes.trim() || undefined,
                      }, "Review recorded.")
                    }
                    disabled={busy !== null}
                  >
                    {busy === "review" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                    Record review
                  </Button>
                </div>
                <div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => run("retire", "/retire", {}, "Obligation retired.")}
                    disabled={busy !== null}
                  >
                    Retire obligation
                  </Button>
                </div>
              </>
            ) : (
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => run("reactivate", "/reactivate", {}, "Obligation reactivated.")}
                  disabled={busy !== null}
                >
                  Reactivate obligation
                </Button>
              </div>
            )}
            {message && (
              <p className="text-sm text-emerald-700 dark:text-emerald-400">{message}</p>
            )}
            {actionError && <p className="text-sm text-destructive">{actionError}</p>}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="size-4 text-muted-foreground" />
            History
          </CardTitle>
          <CardDescription>Append-only record of everything that happened.</CardDescription>
        </CardHeader>
        <CardContent>
          {obligation.events.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {source === "demo"
                ? "History is available when connected to the API."
                : "No events recorded yet."}
            </p>
          ) : (
            <ol className="relative flex flex-col gap-4 border-l pl-4">
              {obligation.events.map((e) => (
                <li key={e.id} className="relative">
                  <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-border" />
                  <p className="text-sm font-medium">{e.event}</p>
                  <p className="text-xs text-muted-foreground">
                    {isoDay(e.created_at)}
                    {e.actor_email ? ` · ${e.actor_email}` : ""}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </>
  );
}
