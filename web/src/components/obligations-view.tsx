"use client";

import { useMemo, useState } from "react";
import { FolderLock, Plus, Scale } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { DataSourceBadge } from "@/components/data-source-badge";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/use-auth";
import {
  type Obligation,
  SOURCE_TYPE_LABELS,
  SOURCE_TYPES,
  useObligations,
} from "@/lib/use-obligations";
import { useSearchQuery } from "@/lib/use-search";

const WRITE_ROLES = new Set(["admin", "howldr_support", "governance_lead", "owner"]);

const SELECT_CLASS =
  "h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

function isoDay(v: string | null): string {
  return v ? v.slice(0, 10) : "—";
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

/** Record an obligation — the commitment, its source, and (optionally) what
 *  already answers it. */
function RecordCard({ onCreated }: { onCreated: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sourceType, setSourceType] = useState(SOURCE_TYPES[1].value);
  const [sourceName, setSourceName] = useState("");
  const [sourceRef, setSourceRef] = useState("");
  const [owner, setOwner] = useState("");
  const [reviewDate, setReviewDate] = useState("");
  const [policyIdsText, setPolicyIdsText] = useState("");
  const [riskIdsText, setRiskIdsText] = useState("");
  const [evidenceIdsText, setEvidenceIdsText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const parseIds = (text: string) =>
        [...new Set(text.split(",").map((s) => s.trim()).filter(Boolean))];
      const obligation = await apiFetch<Obligation>("/api/obligations", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          sourceType,
          sourceName: sourceName.trim(),
          sourceRef: sourceRef.trim() || undefined,
          owner: owner.trim() || undefined,
          nextReviewDate: reviewDate || undefined,
          policyIds: parseIds(policyIdsText),
          riskIds: parseIds(riskIdsText),
          evidenceIds: parseIds(evidenceIdsText),
        }),
      });
      router.push(`/obligations/view?id=${encodeURIComponent(obligation.obligation_id)}`);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <Plus /> Record obligation
      </Button>
    );
  }

  const typeHint = SOURCE_TYPES.find((s) => s.value === sourceType)?.hint;

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-base">Record obligation</CardTitle>
        <CardDescription>
          A commitment your organization must honor, named by its source.
          Link the policies, risks, and evidence that answer it — an
          obligation nothing answers shows as unanswered.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex max-w-2xl flex-col gap-4">
          <Field label="Obligation">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Notify the ICO of a personal data breach within 72 hours"
              required
              disabled={busy}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Source type" hint={typeHint}>
              <select
                value={sourceType}
                onChange={(e) => setSourceType(e.target.value as typeof sourceType)}
                className={SELECT_CLASS}
                disabled={busy}
              >
                {SOURCE_TYPES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Source">
              <Input
                value={sourceName}
                onChange={(e) => setSourceName(e.target.value)}
                placeholder="e.g. UK GDPR"
                required
                disabled={busy}
              />
            </Field>
            <Field label="Clause / article">
              <Input
                value={sourceRef}
                onChange={(e) => setSourceRef(e.target.value)}
                placeholder="e.g. Art. 33"
                disabled={busy}
              />
            </Field>
          </div>
          <Field label="Notes">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this requires in practice, and what happens if it isn't met."
              rows={2}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              disabled={busy}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Owner" hint="Accountable person — defaults to you.">
              <Input
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                placeholder="coo@yourcompany.com"
                disabled={busy}
              />
            </Field>
            <Field label="Next review" hint="When the source renews or gets re-checked.">
              <Input
                type="date"
                value={reviewDate}
                onChange={(e) => setReviewDate(e.target.value)}
                disabled={busy}
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Linked policies" hint="Comma-separated IDs (optional).">
              <Input
                value={policyIdsText}
                onChange={(e) => setPolicyIdsText(e.target.value)}
                placeholder="POL-2026-001"
                disabled={busy}
              />
            </Field>
            <Field label="Linked risks" hint="Comma-separated IDs (optional).">
              <Input
                value={riskIdsText}
                onChange={(e) => setRiskIdsText(e.target.value)}
                placeholder="RSK-2026-001"
                disabled={busy}
              />
            </Field>
            <Field label="Linked evidence" hint="Comma-separated IDs (optional).">
              <Input
                value={evidenceIdsText}
                onChange={(e) => setEvidenceIdsText(e.target.value)}
                placeholder="EVD-2026-001"
                disabled={busy}
              />
            </Field>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              Record obligation
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

export function ObligationsView() {
  const { me } = useAuth();
  const { obligations, source, loading, error, notEnabled, reload } = useObligations();
  const [filter, setFilter] = useSearchQuery();
  const [status, setStatus] = useState<"ACTIVE" | "RETIRED" | "all">("ACTIVE");

  const canWrite = me != null && WRITE_ROLES.has(me.role);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return obligations
      .filter((o) => (status === "all" ? true : o.status === status))
      .filter(
        (o) =>
          !q ||
          [o.obligation_id, o.title, o.source_name, o.source_ref, o.owner_email]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q)),
      );
  }, [obligations, filter, status]);

  if (notEnabled) {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">Obligations</h1>
        <EmptyState
          icon={FolderLock}
          title="Not enabled for this workspace"
          description="The Obligations module isn't enabled for this workspace. Ask whoever runs your ProofWorks to turn it on."
        />
      </>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Obligations</h1>
            {!loading && <DataSourceBadge source={source} error={error} />}
          </div>
          <p className="text-sm text-muted-foreground">
            What you must honor, and why — every policy, risk, and receipt
            traces back to an obligation and its source.
          </p>
        </div>
      </div>

      {canWrite && source === "live" && <RecordCard onCreated={reload} />}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by title, ID, source, owner…"
          className="max-w-xs"
        />
        {(["ACTIVE", "RETIRED", "all"] as const).map((s) => (
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
          icon={Scale}
          title="No obligations recorded"
          description="Record what your organization must honor — laws, contract clauses, insurance conditions — and link what answers each one."
        />
      ) : (
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Obligation</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Coverage</TableHead>
                  <TableHead>Review</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((o) => (
                  <TableRow key={o.obligation_id}>
                    <TableCell className="font-mono text-xs">
                      <Link
                        href={`/obligations/view?id=${encodeURIComponent(o.obligation_id)}`}
                        className="underline-offset-2 hover:underline"
                      >
                        {o.obligation_id}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-96">
                      <span className={o.status === "RETIRED" ? "text-muted-foreground line-through" : ""}>
                        {o.title}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      <span className="flex flex-col">
                        <span>{o.source_name}{o.source_ref ? ` · ${o.source_ref}` : ""}</span>
                        <span className="text-xs">{SOURCE_TYPE_LABELS[o.source_type]}</span>
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {o.owner_email}
                    </TableCell>
                    <TableCell>
                      <CoverageBadge state={o.coverage_state} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {isoDay(o.next_review_date)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {source === "demo" && !loading && (
        <p className="text-xs text-muted-foreground">
          Showing sample data{" "}
          <Badge variant="outline" className="align-middle">demo</Badge> — sign
          in to a workspace with this module enabled for live obligations.
        </p>
      )}
    </>
  );
}
