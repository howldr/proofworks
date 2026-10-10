"use client";

import { useMemo, useState } from "react";
import { FolderLock, Loader2, Plus, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { DataSourceBadge } from "@/components/data-source-badge";
import { EmptyState } from "@/components/empty-state";
import { AcceptanceBadge, RiskBandBadge } from "@/components/risk-badges";
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
import { useSearchQuery } from "@/lib/use-search";
import {
  RISK_CATEGORIES,
  TREATMENTS,
  type Risk,
  useRisks,
} from "@/lib/use-risks";

const WRITE_ROLES = new Set(["admin", "howldr_support", "governance_lead", "owner"]);

export const LIKELIHOOD_LABELS = ["Rare", "Unlikely", "Possible", "Likely", "Almost certain"];
export const IMPACT_LABELS = ["Negligible", "Minor", "Moderate", "Major", "Severe"];

const selectClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

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

export function ScaleSelect({
  value,
  onChange,
  labels,
  disabled,
}: {
  value: number;
  onChange: (n: number) => void;
  labels: string[];
  disabled?: boolean;
}) {
  return (
    <select
      className={selectClass}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      disabled={disabled}
    >
      {labels.map((l, i) => (
        <option key={i} value={i + 1}>
          {i + 1} — {l}
        </option>
      ))}
    </select>
  );
}

function isoDay(v: string | null): string {
  return v ? v.slice(0, 10) : "—";
}

/** Register a risk; optionally record the first assessment in the same pass. */
function RegisterCard({ onCreated }: { onCreated: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState(RISK_CATEGORIES[0]);
  const [acceptor, setAcceptor] = useState("");
  const [reviewDate, setReviewDate] = useState("");
  const [policyIdsText, setPolicyIdsText] = useState("");
  const [evidenceIdsText, setEvidenceIdsText] = useState("");
  const [assessNow, setAssessNow] = useState(true);
  const [il, setIl] = useState(3);
  const [ii, setIi] = useState(3);
  const [rl, setRl] = useState(2);
  const [ri, setRi] = useState(2);
  const [treatment, setTreatment] = useState("mitigate");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const parseIds = (text: string) =>
        [...new Set(text.split(",").map((s) => s.trim()).filter(Boolean))];
      const policyIds = parseIds(policyIdsText);
      const evidenceIds = parseIds(evidenceIdsText);
      const risk = await apiFetch<Risk>("/api/risks", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          category,
          acceptor: acceptor.trim() || undefined,
          nextReviewDate: reviewDate || undefined,
          policyIds: policyIds.length ? policyIds : undefined,
          evidenceIds: evidenceIds.length ? evidenceIds : undefined,
        }),
      });
      if (assessNow) {
        await apiFetch(`/api/risks/${encodeURIComponent(risk.risk_id)}/assess`, {
          method: "POST",
          body: JSON.stringify({
            inherentLikelihood: il,
            inherentImpact: ii,
            residualLikelihood: rl,
            residualImpact: ri,
            treatment,
            treatmentNotes: notes.trim() || undefined,
          }),
        });
      }
      router.push(`/risks/view?id=${encodeURIComponent(risk.risk_id)}`);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <Plus /> Register risk
      </Button>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-base">Register risk</CardTitle>
        <CardDescription>
          Assessed on a 5×5 likelihood × impact matrix — inherent (before
          treatment) and residual (after). The acceptor signs off the residual
          risk; each acceptance is a permanent receipt.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex max-w-2xl flex-col gap-4">
          <Field label="Title">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Unpatched public-facing servers"
              required
              disabled={busy}
            />
          </Field>
          <Field label="Description (optional)">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              disabled={busy}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category">
              <select
                className={selectClass}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                disabled={busy}
              >
                {RISK_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Next review (optional)">
              <Input
                type="date"
                value={reviewDate}
                onChange={(e) => setReviewDate(e.target.value)}
                disabled={busy}
              />
            </Field>
          </div>
          <Field
            label="Acceptor (optional)"
            hint="Who formally accepts the residual risk. Leave blank and the risk owner accepts."
          >
            <Input
              type="email"
              value={acceptor}
              onChange={(e) => setAcceptor(e.target.value)}
              placeholder="coo@yourcompany.com"
              disabled={busy}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Linked policies (optional)"
              hint="Comma-separated policy IDs — the controls treating this risk."
            >
              <Input
                value={policyIdsText}
                onChange={(e) => setPolicyIdsText(e.target.value)}
                placeholder="POL-2026-001"
                disabled={busy}
              />
            </Field>
            <Field
              label="Linked evidence (optional)"
              hint="Comma-separated evidence IDs — proof the treatment operates."
            >
              <Input
                value={evidenceIdsText}
                onChange={(e) => setEvidenceIdsText(e.target.value)}
                placeholder="EVD-2026-001"
                disabled={busy}
              />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={assessNow}
              onChange={(e) => setAssessNow(e.target.checked)}
              disabled={busy}
            />
            Record the first assessment now
          </label>

          {assessNow && (
            <div className="flex flex-col gap-4 rounded-lg border p-3">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Inherent likelihood" hint="Before any treatment.">
                  <ScaleSelect value={il} onChange={setIl} labels={LIKELIHOOD_LABELS} disabled={busy} />
                </Field>
                <Field label="Inherent impact">
                  <ScaleSelect value={ii} onChange={setIi} labels={IMPACT_LABELS} disabled={busy} />
                </Field>
                <Field label="Residual likelihood" hint="After the treatment below.">
                  <ScaleSelect value={rl} onChange={setRl} labels={LIKELIHOOD_LABELS} disabled={busy} />
                </Field>
                <Field label="Residual impact">
                  <ScaleSelect value={ri} onChange={setRi} labels={IMPACT_LABELS} disabled={busy} />
                </Field>
              </div>
              <Field label="Treatment">
                <select
                  className={selectClass}
                  value={treatment}
                  onChange={(e) => setTreatment(e.target.value)}
                  disabled={busy}
                >
                  {TREATMENTS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Treatment notes (optional)">
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Monthly patch cycle + WAF in front of legacy estate"
                  disabled={busy}
                />
              </Field>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={busy || !title.trim()}>
              {busy ? <Loader2 className="animate-spin" /> : <Plus />}
              Register
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

export function RisksView() {
  const { me } = useAuth();
  const { risks, source, loading, error, notEnabled, reload } = useRisks();
  const [filter, setFilter] = useSearchQuery();
  const [status, setStatus] = useState<"OPEN" | "CLOSED" | "all">("OPEN");

  const canWrite = me != null && WRITE_ROLES.has(me.role);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return risks
      .filter((r) => (status === "all" ? true : r.status === status))
      .filter(
        (r) =>
          !q ||
          [r.risk_id, r.title, r.category, r.owner_email]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q)),
      );
  }, [risks, filter, status]);

  if (notEnabled) {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">Risk Register</h1>
        <EmptyState
          icon={FolderLock}
          title="Not enabled for this workspace"
          description="The Risk Register module isn't enabled for this workspace. Ask whoever runs your ProofWorks to turn it on."
        />
      </>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Risk Register</h1>
            {!loading && <DataSourceBadge source={source} error={error} />}
          </div>
          <p className="text-sm text-muted-foreground">
            Know your risks, treat them, and hold a receipt for every
            acceptance.
          </p>
        </div>
      </div>

      {canWrite && source === "live" && <RegisterCard onCreated={reload} />}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by title, ID, category, owner…"
          className="max-w-xs"
        />
        {(["OPEN", "CLOSED", "all"] as const).map((s) => (
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
          icon={TriangleAlert}
          title="No risks registered"
          description="Register the risks your organization carries — then every assessment and acceptance builds the evidence trail."
        />
      ) : (
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Inherent</TableHead>
                  <TableHead>Residual</TableHead>
                  <TableHead>Acceptance</TableHead>
                  <TableHead>Review</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((r) => (
                  <TableRow key={r.risk_id}>
                    <TableCell className="font-mono text-xs">
                      <Link
                        href={`/risks/view?id=${encodeURIComponent(r.risk_id)}`}
                        className="underline-offset-2 hover:underline"
                      >
                        {r.risk_id}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-72">
                      <span className={r.status === "CLOSED" ? "text-muted-foreground line-through" : ""}>
                        {r.title}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.category ?? "—"}
                    </TableCell>
                    <TableCell>
                      <RiskBandBadge band={r.inherent_band} score={r.inherent_score} />
                    </TableCell>
                    <TableCell>
                      <RiskBandBadge band={r.residual_band} score={r.residual_score} />
                    </TableCell>
                    <TableCell>
                      <AcceptanceBadge state={r.acceptance_state} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {isoDay(r.next_review_date)}
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
          in to a workspace with this module enabled for live risks.
        </p>
      )}
    </>
  );
}
