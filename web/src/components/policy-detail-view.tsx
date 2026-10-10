"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  Download,
  Eye,
  FileQuestion,
  Files,
  FileUp,
  HelpCircle,
  History,
  Loader2,
  MessageSquare,
  Pencil,
  RefreshCw,
  Send,
  Undo2,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { DataSourceBadge } from "@/components/data-source-badge";
import { EmptyState } from "@/components/empty-state";
import { LinkedObligationsCard } from "@/components/linked-obligations-card";
import { LinkedRisksCard } from "@/components/linked-risks-card";
import { PolicyActions } from "@/components/policy-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiDownload, apiFetch, apiUpload } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { daysUntil, STATUS_STYLES } from "@/lib/policies";
import { useAuth } from "@/lib/use-auth";
import {
  type AuthorisationStage,
  type Comment,
  type DocumentFile,
  type ReaderStat,
  usePolicyDetail,
} from "@/lib/use-register";

function MetaItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-medium">{value}</p>
    </div>
  );
}

function isoDay(value: string | null): string {
  return value ? value.slice(0, 10) : "—";
}

/** One authoriser's standing — shared by the flat (demo) list and the stage
 *  view. `decision` null renders as pending. */
function AuthoriserRow({
  email,
  decision,
  decidedAt,
}: {
  email: string;
  decision: "approved" | "returned" | null;
  decidedAt: string | null;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-2.5 text-sm">
      <span className="truncate">{email}</span>
      {decision === "approved" ? (
        <span className="flex shrink-0 items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="size-3.5" />
          approved {isoDay(decidedAt)}
        </span>
      ) : decision === "returned" ? (
        <span className="flex shrink-0 items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
          <Undo2 className="size-3.5" />
          returned {isoDay(decidedAt)}
        </span>
      ) : (
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <CircleDashed className="size-3.5" />
          pending
        </span>
      )}
    </div>
  );
}

/** The authorisation route with live per-stage progress. The active stage is
 *  the first one not yet satisfied; earlier stages are cleared, later ones are
 *  still waiting to open. A single-stage route renders as a plain list. */
function AuthorisationStages({ route }: { route: AuthorisationStage[] }) {
  const multi = route.length > 1;
  const activeIndex = route.findIndex((s) => !s.satisfied);

  return (
    <>
      {route.map((stage, i) => {
        const state = stage.satisfied
          ? "cleared"
          : i === activeIndex
            ? "open"
            : "waiting";
        return (
          <div key={stage.position} className="flex flex-col gap-2">
            {multi && (
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Stage {stage.position}
                  {state === "open" && " · open"}
                  {state === "waiting" && " · waiting"}
                  {state === "cleared" && " · cleared"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {stage.threshold == null
                    ? "all must approve"
                    : `any ${stage.threshold} of ${stage.memberCount}`}
                  {" — "}
                  {stage.approved}/{stage.required}
                </span>
              </div>
            )}
            {stage.members.map((m) => (
              <AuthoriserRow
                key={m.email}
                email={m.email}
                decision={m.decision}
                decidedAt={m.decidedAt}
              />
            ))}
          </div>
        );
      })}
    </>
  );
}

/** Upload (or re-upload) the draft document — owner/admin only. Stored on
 *  the file appliance as an explicit versioned file; each upload is also
 *  recorded in the changelog. */
function DocumentUploadCard({ policyId }: { policyId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await apiUpload<{ file: { name: string } }>(
        `/api/policies/${encodeURIComponent(policyId)}/document`,
        file,
      );
      setDone(res.file.name);
      setFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileUp className="size-4 text-muted-foreground" />
          Draft document
        </CardTitle>
        <CardDescription>
          Word or PDF, stored on the secure file appliance as a versioned
          file and recorded in the audit trail.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="file"
            accept=".pdf,.doc,.docx"
            className="max-w-xs"
            disabled={busy}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setDone(null);
              setError(null);
            }}
          />
          <Button onClick={upload} disabled={busy || !file}>
            {busy ? (
              <>
                <Loader2 className="animate-spin" /> Uploading…
              </>
            ) : (
              "Upload"
            )}
          </Button>
        </div>
        {done && (
          <p className="text-sm text-emerald-700 dark:text-emerald-400">
            Stored as {done}.
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

/** Pull download receipts from the file appliance on demand — owner/admin.
 *  (The server also polls every 15 minutes.) */
function CheckReceiptsButton({
  policyId,
  onChanged,
}: {
  policyId: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function check() {
    setBusy(true);
    setNote(null);
    try {
      const res = await apiFetch<{ recorded: number; activated: boolean }>(
        `/api/policies/${encodeURIComponent(policyId)}/receipts/poll`,
        { method: "POST", body: "{}" },
      );
      setNote(
        res.recorded === 0
          ? "No new acknowledgements yet."
          : `${res.recorded} new acknowledgement${res.recorded === 1 ? "" : "s"} recorded` +
              (res.activated ? " — policy is now active." : "."),
      );
      if (res.recorded > 0) onChanged();
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {note && <span className="text-xs text-muted-foreground">{note}</span>}
      <Button variant="outline" size="sm" onClick={check} disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        Check for receipts
      </Button>
    </div>
  );
}

const AREA_LABEL: Record<DocumentFile["area"], string> = {
  current: "Current",
  drafts: "Drafts",
  archive: "Archive",
};

function formatBytes(n: number): string {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Every stored document version with its checksum, grouped by folder, with
 *  authenticated downloads. */
function DocumentVersionsCard({
  policyId,
  documents,
}: {
  policyId: string;
  documents: DocumentFile[];
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(d: DocumentFile) {
    setBusy(d.id);
    setError(null);
    try {
      await apiDownload(
        `/api/policies/${encodeURIComponent(policyId)}/documents/download` +
          `?area=${d.area}&file=${encodeURIComponent(d.id)}&name=${encodeURIComponent(d.name)}`,
        d.name,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const areas: DocumentFile["area"][] = ["current", "drafts", "archive"];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Files className="size-4 text-muted-foreground" />
          Document versions
        </CardTitle>
        <CardDescription>
          Every stored version with its checksum — the evidence trail. Download
          any version.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No documents stored yet.
          </p>
        ) : (
          areas
            .filter((a) => documents.some((d) => d.area === a))
            .map((a) => (
              <div key={a} className="flex flex-col gap-2">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {AREA_LABEL[a]}
                </p>
                {documents
                  .filter((d) => d.area === a)
                  .map((d) => (
                    <div
                      key={d.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-2.5 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{d.name}</p>
                        <p className="font-mono text-xs text-muted-foreground">
                          {isoDay(d.created_at)} · {formatBytes(d.size)}
                          {d.checksum ? ` · ${d.checksum.slice(0, 12)}…` : ""}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => download(d)}
                        disabled={busy !== null}
                      >
                        {busy === d.id ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <Download />
                        )}
                        Download
                      </Button>
                    </div>
                  ))}
              </div>
            ))
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

/** Comments + questions raised during review, plus per-reviewer read counts. */
function ReviewActivityCard({
  policyId,
  version,
  comments,
  reads,
  canPost,
  source,
  onPosted,
}: {
  policyId: string;
  version: string;
  comments: Comment[];
  reads: ReaderStat[];
  canPost: boolean;
  source: "live" | "demo";
  onPosted: () => void;
}) {
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<"comment" | "question">("comment");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentReads = reads
    .filter((r) => r.version === version)
    .sort((a, b) => b.read_count - a.read_count);

  async function post() {
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/policies/${encodeURIComponent(policyId)}/comments`, {
        method: "POST",
        body: JSON.stringify({ kind, body: body.trim() }),
      });
      setBody("");
      setKind("comment");
      onPosted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquare className="size-4 text-muted-foreground" />
          Review activity
        </CardTitle>
        <CardDescription>
          Comments and questions raised during review, and who has reviewed
          this version.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {source === "demo" ? (
          <p className="text-sm text-muted-foreground">
            Review discussion is available when connected to the API.
          </p>
        ) : (
          <>
            {currentReads.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <Eye className="size-3.5 text-muted-foreground" />
                {currentReads.map((r) => (
                  <span
                    key={r.reader_email}
                    className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
                  >
                    {r.reader_email} ×{r.read_count}
                  </span>
                ))}
              </div>
            )}

            {comments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No comments yet.</p>
            ) : (
              <ol className="flex flex-col gap-3">
                {comments.map((c) => (
                  <li key={c.id} className="rounded-lg border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      {c.kind === "question" ? (
                        <HelpCircle className="size-3.5 text-amber-600 dark:text-amber-400" />
                      ) : (
                        <MessageSquare className="size-3.5 text-muted-foreground" />
                      )}
                      <span className="font-medium">{c.author_email}</span>
                      <span className="text-xs text-muted-foreground">
                        {c.version} · {isoDay(c.created_at)}
                      </span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap">{c.body}</p>
                  </li>
                ))}
              </ol>
            )}

            {canPost && (
              <div className="flex flex-col gap-2 border-t pt-3">
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Add a comment or ask a question…"
                  rows={3}
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  disabled={busy}
                />
                <div className="flex items-center gap-2">
                  <select
                    value={kind}
                    onChange={(e) =>
                      setKind(e.target.value as "comment" | "question")
                    }
                    disabled={busy}
                    className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <option value="comment">Comment</option>
                    <option value="question">Question</option>
                  </select>
                  <Button onClick={post} disabled={busy || !body.trim()}>
                    {busy ? <Loader2 className="animate-spin" /> : <Send />}
                    Post
                  </Button>
                  {error && (
                    <span className="text-sm text-destructive">{error}</span>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function PolicyDetailView() {
  const params = useSearchParams();
  const { me, email } = useAuth();
  const id = params.get("id");
  // Set by /policies/new when the register entry saved but the document
  // upload failed — the policy exists, the file needs re-uploading.
  const uploadError = params.get("uploadError");
  const {
    policy,
    authorisers,
    authorisationRoute,
    exec,
    ownerAcceptance,
    acknowledgements,
    changelog,
    comments,
    reads,
    documents,
    linkedRisks,
    linkedObligations,
    source,
    loading,
    error,
    notFound,
    reload,
  } = usePolicyDetail(id);

  // Staff (workforce) read the published policy — the governance around it
  // (workflow actions, authorisers, changelog, acceptance tracking) is hidden,
  // and the API denies those sub-resources for the role regardless.
  const isStaff = me?.role === "staff";

  // Record a deliberate view once per policy per mount (fire-and-forget) so the
  // review activity can show "reviewed ×N". No state set here. Skipped for
  // staff — read tracking belongs to the review workflow they're not part of.
  const readRecorded = useRef<string | null>(null);
  useEffect(() => {
    if (isStaff) return;
    if (source === "live" && policy && readRecorded.current !== policy.policy_id) {
      readRecorded.current = policy.policy_id;
      void apiFetch(`/api/policies/${encodeURIComponent(policy.policy_id)}/read`, {
        method: "POST",
        body: "{}",
      }).catch(() => {});
    }
  }, [source, policy, isStaff]);

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (notFound || !policy) {
    return (
      <EmptyState
        icon={FileQuestion}
        title="Policy not found"
        description={
          id
            ? `No policy with ID ${id} is visible to you.`
            : "No policy ID was provided. Pick a policy from the register."
        }
      />
    );
  }

  const ackPct =
    policy.acknowledgement_total > 0
      ? Math.round(
          (policy.acknowledgement_count / policy.acknowledgement_total) * 100,
        )
      : null;
  const reviewDays = policy.next_review_date
    ? daysUntil(policy.next_review_date)
    : null;
  const canEditDetails =
    source === "live" &&
    (me?.role === "admin" ||
      me?.role === "howldr_support" ||
      (email != null && email === policy.owner));

  return (
    <>
      {uploadError && (
        <div className="rounded-lg border border-amber-600/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-400">
          Policy registered, but the document upload failed: {uploadError}.
          The document can be uploaded again later.
        </div>
      )}
      <div>
        <Button
          render={<Link href="/policies" />}
          nativeButton={false}
          variant="ghost"
          size="sm"
          className="-ml-2 mb-2"
        >
          <ArrowLeft />
          Register
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {policy.title}
          </h1>
          <Badge variant="outline" className={STATUS_STYLES[policy.status]}>
            {policy.status}
          </Badge>
          <DataSourceBadge source={source} error={error} />
          {canEditDetails && (
            <Button
              render={
                <Link
                  href={`/policies/edit?id=${encodeURIComponent(policy.policy_id)}`}
                />
              }
              nativeButton={false}
              variant="outline"
              size="sm"
              className="ml-auto"
            >
              <Pencil /> Edit details
            </Button>
          )}
        </div>
        <p className="mt-1 font-mono text-sm text-muted-foreground">
          {policy.policy_id} · {policy.current_version}
        </p>
      </div>

      <Card>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-3 lg:grid-cols-5">
          <MetaItem label="Owner" value={policy.owner} />
          <MetaItem label="Category" value={policy.category} />
          <MetaItem
            label="Next review"
            value={
              policy.next_review_date ? (
                <span className="flex items-center gap-1.5">
                  <CalendarClock className="size-3.5 text-muted-foreground" />
                  {policy.next_review_date}
                  {reviewDays !== null && (
                    <span
                      className={
                        "text-xs " +
                        (reviewDays < 0
                          ? "text-destructive"
                          : reviewDays <= 30
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-muted-foreground")
                      }
                    >
                      {reviewDays < 0
                        ? `${Math.abs(reviewDays)}d overdue`
                        : `in ${reviewDays}d`}
                    </span>
                  )}
                </span>
              ) : (
                "—"
              )
            }
          />
          <MetaItem
            label="Applies to"
            value={
              policy.applicable_roles.length
                ? policy.applicable_roles.join(", ")
                : "—"
            }
          />
          <MetaItem
            label="Acceptance"
            value={
              ackPct === null
                ? "Not distributed"
                : `${policy.acknowledgement_count}/${policy.acknowledgement_total} (${ackPct}%)`
            }
          />
        </CardContent>
      </Card>

      {source === "live" && !isStaff && (
        <PolicyActions
          policy={policy}
          authorisers={authorisers}
          exec={exec}
          onChanged={reload}
        />
      )}

      {!isStaff && (
        <ReviewActivityCard
          policyId={policy.policy_id}
          version={policy.current_version}
          comments={comments}
          reads={reads}
          canPost={source === "live" && me != null}
          source={source}
          onPosted={reload}
        />
      )}

      {source === "live" &&
        (me?.role === "admin" ||
          me?.role === "howldr_support" ||
          (email != null && email === policy.owner)) && (
          <DocumentUploadCard policyId={policy.policy_id} />
        )}

      {source === "live" && (
        <DocumentVersionsCard
          policyId={policy.policy_id}
          documents={documents}
        />
      )}

      {!isStaff && (
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="size-4 text-muted-foreground" />
              Approvers
            </CardTitle>
            <CardDescription>
              Sign-off is recorded per approver; each stage clears by its
              threshold before the next opens.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {authorisationRoute.length > 0 ? (
              <AuthorisationStages route={authorisationRoute} />
            ) : authorisers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {source === "demo"
                  ? "Approver detail is available when connected to the API."
                  : "No approvers assigned yet."}
              </p>
            ) : (
              authorisers.map((a) => (
                <AuthoriserRow
                  key={a.email}
                  email={a.email}
                  decision={
                    a.approved_at
                      ? "approved"
                      : a.returned_at
                        ? "returned"
                        : null
                  }
                  decidedAt={a.approved_at ?? a.returned_at}
                />
              ))
            )}

            {ownerAcceptance.required && (
              <div className="flex flex-col gap-2 border-t pt-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Owner acceptance
                  {policy.status === "OWNER ACCEPTANCE" && " · open"}
                </span>
                <AuthoriserRow
                  email={policy.owner}
                  decision={ownerAcceptance.decision}
                  decidedAt={ownerAcceptance.decidedAt}
                />
              </div>
            )}

            {exec.required && (
              <div className="flex flex-col gap-2 border-t pt-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Executive sign-off
                  {policy.status === "EXEC REVIEW" && " · open"}
                </span>
                {exec.email ? (
                  <AuthoriserRow
                    email={exec.email}
                    decision={exec.decision}
                    decidedAt={exec.decidedAt}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    This category requires executive approval — no
                    executive is assigned yet.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="size-4 text-muted-foreground" />
              Changelog
            </CardTitle>
            <CardDescription>
              Full audit trail of lifecycle events.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {changelog.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {source === "demo"
                  ? "The audit trail is available when connected to the API."
                  : "No events recorded yet."}
              </p>
            ) : (
              <ol className="relative flex flex-col gap-4 border-l pl-4">
                {changelog.map((entry, i) => (
                  <li key={entry.id ?? i} className="relative">
                    <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-border" />
                    <p className="text-sm font-medium">{entry.event}</p>
                    <p className="text-xs text-muted-foreground">
                      {isoDay(entry.created_at)}
                      {entry.actor_email ? ` · ${entry.actor_email}` : ""}
                      {entry.from_version && entry.to_version
                        ? ` · ${entry.from_version} → ${entry.to_version}`
                        : ""}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
      )}

      <LinkedObligationsCard
        obligations={linkedObligations}
        description="Why this policy exists — the obligations it answers."
      />

      <LinkedRisksCard
        risks={linkedRisks}
        description="Register risks that name this policy as a treating control."
      />

      {!isStaff && (
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1.5">
              <CardTitle className="text-base">Acceptance tracking</CardTitle>
              <CardDescription>
                Per-recipient acknowledgement status for{" "}
                {policy.current_version}.
              </CardDescription>
            </div>
            {source === "live" &&
              acknowledgements.some((a) => !a.acknowledged_at) &&
              (me?.role === "admin" ||
                me?.role === "howldr_support" ||
                (email != null && email === policy.owner)) && (
                <CheckReceiptsButton
                  policyId={policy.policy_id}
                  onChanged={reload}
                />
              )}
          </div>
        </CardHeader>
        <CardContent>
          {acknowledgements.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {source === "demo"
                ? "Acceptance records are available when connected to the API."
                : "This version has not been distributed yet."}
            </p>
          ) : (
            <div className="overflow-hidden rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Recipient</TableHead>
                    <TableHead className="hidden md:table-cell">
                      Distributed
                    </TableHead>
                    <TableHead className="hidden sm:table-cell">
                      Expires
                    </TableHead>
                    <TableHead className="hidden lg:table-cell">
                      Document hash
                    </TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {acknowledgements.map((a) => (
                    <TableRow key={`${a.version}:${a.recipient_email}`}>
                      <TableCell className="font-medium">
                        {a.recipient_email}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-muted-foreground">
                        {isoDay(a.distributed_at)}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-muted-foreground">
                        {isoDay(a.expires_at)}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {a.document_checksum ? (
                          <code
                            className="text-xs text-muted-foreground"
                            title={a.document_checksum}
                          >
                            {a.document_checksum.length > 14
                              ? `${a.document_checksum.slice(0, 10)}…`
                              : a.document_checksum}
                          </code>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {a.attested_at ? (
                          <span
                            className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400"
                            title="Explicitly accepted via the read-and-accept link"
                          >
                            <CheckCircle2 className="size-3.5" />
                            accepted {isoDay(a.attested_at)}
                          </span>
                        ) : a.acknowledged_at ? (
                          <span
                            className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400"
                            title="Authenticated download receipt"
                          >
                            <CheckCircle2 className="size-3.5" />
                            downloaded {isoDay(a.acknowledged_at)}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <CircleDashed className="size-3.5" />
                            outstanding
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      )}
    </>
  );
}
