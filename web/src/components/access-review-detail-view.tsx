"use client";

import { useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  FileQuestion,
  Loader2,
  RotateCcw,
  Stamp,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { DecisionBadge, ProgressBadge } from "@/components/access-review-badges";
import { EmptyState } from "@/components/empty-state";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiFetch } from "@/lib/api";
import {
  useAccessReviewDetail,
  type LineDecision,
} from "@/lib/use-access-reviews";
import { useAuth } from "@/lib/use-auth";

const MANAGE_ROLES = new Set(["admin", "howldr_support", "governance_lead"]);
const DECISIONS: LineDecision[] = ["keep", "flag", "remove"];

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

export function AccessReviewDetailView() {
  const params = useSearchParams();
  const id = params.get("id");
  const { me, email } = useAuth();
  const { review, source, loading, error, notFound, reload } = useAccessReviewDetail(id);

  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [attesting, setAttesting] = useState(false);
  const [attestNotes, setAttestNotes] = useState("");

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (notFound || !review) {
    return (
      <EmptyState
        icon={FileQuestion}
        title="Access review not found"
        description={id ? `No review ${id} is visible to you.` : "No review ID was provided."}
      />
    );
  }

  const isOpen = review.status === "OPEN";
  const canReview =
    source === "live" &&
    me != null &&
    (MANAGE_ROLES.has(me.role) || email === review.reviewer_email);
  const canReopen = source === "live" && me != null && MANAGE_ROLES.has(me.role);
  const undecided = review.lines.filter((l) => l.decision == null).length;

  async function post(label: string, path: string, body?: object) {
    setBusy(label);
    setActionError(null);
    try {
      await apiFetch(`/api/access-reviews/${encodeURIComponent(review!.review_id)}${path}`, {
        method: "POST",
        body: JSON.stringify(body ?? {}),
      });
      setAttesting(false);
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div>
        <Button
          render={<Link href="/access-reviews" />}
          nativeButton={false}
          variant="ghost"
          size="sm"
          className="-ml-2 mb-2"
        >
          <ArrowLeft /> Back to Access Reviews
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{review.title}</h1>
          <ProgressBadge state={review.progress_state} />
        </div>
        <p className="mt-1 font-mono text-sm text-muted-foreground">{review.review_id}</p>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
          {review.description && <CardDescription>{review.description}</CardDescription>}
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetaItem label="System" value={review.system} />
          <MetaItem label="Reviewer" value={review.reviewer_email} />
          <MetaItem label="Due" value={isoDay(review.due_date)} />
          <MetaItem label="Next review" value={isoDay(review.next_review_date)} />
          <MetaItem
            label="Progress"
            value={`${review.lines_decided}/${review.lines_total} decided`}
          />
          <MetaItem label="Flagged" value={review.lines_flag} />
          <MetaItem label="To remove" value={review.lines_remove} />
        </CardContent>
      </Card>

      {/* Attest / reopen actions */}
      {(canReview || canReopen) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Attestation</CardTitle>
            <CardDescription>
              {isOpen
                ? "Decide every line, then certify the list. The attestation is a permanent receipt."
                : "This review has been attested. Reopening it starts a fresh decision pass."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {isOpen && canReview && !attesting && (
              <div>
                <Button
                  onClick={() => setAttesting(true)}
                  disabled={busy !== null || undecided > 0}
                >
                  <Stamp /> Attest this review
                </Button>
                {undecided > 0 && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {undecided} line{undecided === 1 ? "" : "s"} still need a decision.
                  </p>
                )}
              </div>
            )}
            {isOpen && canReview && attesting && (
              <div className="flex flex-col gap-3 rounded-lg border p-3">
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">Notes (optional)</span>
                  <Input
                    value={attestNotes}
                    onChange={(e) => setAttestNotes(e.target.value)}
                    placeholder="e.g. Reviewed with HR; two leavers removed"
                    disabled={busy !== null}
                  />
                </label>
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => post("attest", "/attest", { notes: attestNotes.trim() || undefined })}
                    disabled={busy !== null}
                  >
                    {busy === "attest" ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
                    Confirm attestation
                  </Button>
                  <Button variant="ghost" onClick={() => setAttesting(false)} disabled={busy !== null}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
            {!isOpen && canReopen && (
              <div>
                <Button
                  variant="outline"
                  onClick={() => post("reopen", "/reopen")}
                  disabled={busy !== null}
                >
                  {busy === "reopen" ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                  Reopen review
                </Button>
              </div>
            )}
            {actionError && <p className="text-sm text-destructive">{actionError}</p>}
          </CardContent>
        </Card>
      )}

      {/* Lines */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Access list</CardTitle>
          <CardDescription>
            {review.lines.length} line{review.lines.length === 1 ? "" : "s"}
            {isOpen && canReview ? " — decide each one." : "."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {review.lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">No lines on this review.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subject</TableHead>
                  <TableHead>Resource</TableHead>
                  <TableHead>Access</TableHead>
                  <TableHead>Decision</TableHead>
                  {isOpen && canReview && <TableHead className="text-right">Decide</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {review.lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-mono text-xs">{l.subject}</TableCell>
                    <TableCell className="text-sm">{l.resource}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {l.access_detail ?? "—"}
                    </TableCell>
                    <TableCell>
                      <DecisionBadge decision={l.decision} />
                    </TableCell>
                    {isOpen && canReview && (
                      <TableCell className="text-right">
                        <div className="inline-flex gap-1">
                          {DECISIONS.map((d) => (
                            <Button
                              key={d}
                              size="sm"
                              variant={l.decision === d ? "secondary" : "ghost"}
                              className="h-7 px-2 text-xs capitalize"
                              disabled={busy !== null}
                              onClick={() =>
                                post(`decide-${l.id}-${d}`, `/lines/${l.id}/decide`, { decision: d })
                              }
                            >
                              {busy === `decide-${l.id}-${d}` ? (
                                <Loader2 className="animate-spin" />
                              ) : (
                                d
                              )}
                            </Button>
                          ))}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Attestation receipts */}
      {review.attestations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Attestation receipts</CardTitle>
            <CardDescription>Append-only — every certification of this list.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {review.attestations.map((a) => (
              <div key={a.id} className="rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{a.reviewer_email}</span>
                  <span className="text-xs text-muted-foreground">
                    {String(a.created_at).slice(0, 10)}
                  </span>
                </div>
                <p className="mt-1 text-muted-foreground">
                  {a.lines_total} lines · {a.lines_keep} keep · {a.lines_flag} flag ·{" "}
                  {a.lines_remove} remove
                </p>
                {a.notes && <p className="mt-1">{a.notes}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}
