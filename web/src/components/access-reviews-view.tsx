"use client";

import { useMemo, useState } from "react";
import { FolderLock, Loader2, Plus, UserCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ProgressBadge } from "@/components/access-review-badges";
import { DataSourceBadge } from "@/components/data-source-badge";
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
  parseAccessLines,
  useAccessReviews,
  type AccessReview,
} from "@/lib/use-access-reviews";
import { useAuth } from "@/lib/use-auth";
import { useSearchQuery } from "@/lib/use-search";

const WRITE_ROLES = new Set(["admin", "howldr_support", "governance_lead", "owner"]);

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

function isoDay(v: string | null): string {
  return v ? v.slice(0, 10) : "—";
}

/** Open a review by naming the system + reviewer and pasting the access list. */
function OpenReviewCard({ onCreated }: { onCreated: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [system, setSystem] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lines = useMemo(() => parseAccessLines(paste), [paste]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const review = await apiFetch<AccessReview>("/api/access-reviews", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          system: system.trim(),
          reviewer: reviewer.trim() || undefined,
          dueDate: dueDate || undefined,
          lines,
        }),
      });
      router.push(`/access-reviews/view?id=${encodeURIComponent(review.review_id)}`);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <Plus /> Open review
      </Button>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-base">Open an access review</CardTitle>
        <CardDescription>
          Name the system and the reviewer, then paste the access list — one row
          per line as <code>subject, resource, access</code> (CSV or tab).
          Export it straight from the system and drop it in.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex max-w-2xl flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Title">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. M365 quarterly admin review"
                required
                disabled={busy}
              />
            </Field>
            <Field label="System">
              <Input
                value={system}
                onChange={(e) => setSystem(e.target.value)}
                placeholder="e.g. Microsoft 365"
                required
                disabled={busy}
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Reviewer (optional)"
              hint="Who certifies the list. Leave blank and it's you."
            >
              <Input
                type="email"
                value={reviewer}
                onChange={(e) => setReviewer(e.target.value)}
                placeholder="it-lead@yourcompany.com"
                disabled={busy}
              />
            </Field>
            <Field label="Due date (optional)">
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                disabled={busy}
              />
            </Field>
          </div>
          <Field
            label="Access list"
            hint={`${lines.length} line${lines.length === 1 ? "" : "s"} detected — subject and resource are required per row.`}
          >
            <textarea
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              rows={6}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              placeholder={"jsmith@acme.com, Global Admins, member\nalee@acme.com, Billing Admins, owner"}
              disabled={busy}
            />
          </Field>

          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={busy || !title.trim() || !system.trim() || lines.length === 0}>
              {busy ? <Loader2 className="animate-spin" /> : <Plus />}
              Open review ({lines.length})
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function AccessReviewsView() {
  const { me } = useAuth();
  const { reviews, source, loading, error, notEnabled, reload } = useAccessReviews();
  const [filter, setFilter] = useSearchQuery();
  const [status, setStatus] = useState<"OPEN" | "ATTESTED" | "all">("OPEN");

  const canWrite = me != null && WRITE_ROLES.has(me.role);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return reviews
      .filter((r) => (status === "all" ? true : r.status === status))
      .filter(
        (r) =>
          !q ||
          [r.review_id, r.title, r.system, r.reviewer_email]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q)),
      );
  }, [reviews, filter, status]);

  if (notEnabled) {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">Access Reviews</h1>
        <EmptyState
          icon={FolderLock}
          title="Not enabled for this workspace"
          description="The Access Reviews module isn't enabled for this workspace. Ask whoever runs your ProofWorks to turn it on."
        />
      </>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Access Reviews</h1>
            {!loading && <DataSourceBadge source={source} error={error} />}
          </div>
          <p className="text-sm text-muted-foreground">
            Certify who has access to what — and hold a signed receipt for every
            review.
          </p>
        </div>
      </div>

      {canWrite && source === "live" && <OpenReviewCard onCreated={reload} />}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by title, ID, system, reviewer…"
          className="max-w-xs"
        />
        {(["OPEN", "ATTESTED", "all"] as const).map((s) => (
          <Button
            key={s}
            size="sm"
            variant={status === s ? "secondary" : "ghost"}
            onClick={() => setStatus(s)}
          >
            {s === "all" ? "All" : s.toLowerCase()}
          </Button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={UserCheck}
          title="No access reviews"
          description="Open a review, paste an access export, and certify it — each attestation becomes evidence a reviewer signed off the list."
        />
      ) : (
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>System</TableHead>
                  <TableHead>Reviewer</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((r) => (
                  <TableRow key={r.review_id}>
                    <TableCell className="font-mono text-xs">
                      <Link
                        href={`/access-reviews/view?id=${encodeURIComponent(r.review_id)}`}
                        className="underline-offset-2 hover:underline"
                      >
                        {r.review_id}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-72 truncate">{r.title}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.system}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.reviewer_email}</TableCell>
                    <TableCell className="text-sm tabular-nums text-muted-foreground">
                      {r.lines_decided}/{r.lines_total}
                    </TableCell>
                    <TableCell>
                      <ProgressBadge state={r.progress_state} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{isoDay(r.due_date)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
