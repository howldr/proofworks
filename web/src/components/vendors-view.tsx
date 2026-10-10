"use client";

import { useMemo, useState } from "react";
import { FolderLock, Handshake, Loader2, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { DataSourceBadge } from "@/components/data-source-badge";
import { EmptyState } from "@/components/empty-state";
import { RiskBandBadge } from "@/components/risk-badges";
import {
  IMPACT_LABELS,
  LIKELIHOOD_LABELS,
  ScaleSelect,
} from "@/components/risks-view";
import { DecisionBadge, TierBadge } from "@/components/vendor-badges";
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
import { TREATMENTS } from "@/lib/use-risks";
import {
  VENDOR_CATEGORIES,
  VENDOR_TIERS,
  type Vendor,
  useVendors,
} from "@/lib/use-vendors";

const WRITE_ROLES = new Set(["admin", "howldr_support", "governance_lead", "owner"]);

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

function isoDay(v: string | null): string {
  return v ? v.slice(0, 10) : "—";
}

/** Register a vendor; optionally record the first assessment in the same pass. */
function RegisterCard({ onCreated }: { onCreated: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState(VENDOR_CATEGORIES[0]);
  const [tier, setTier] = useState("medium");
  const [dataScope, setDataScope] = useState("");
  const [approver, setApprover] = useState("");
  const [reviewDate, setReviewDate] = useState("");
  const [policyIdsText, setPolicyIdsText] = useState("");
  const [evidenceIdsText, setEvidenceIdsText] = useState("");
  const [riskIdsText, setRiskIdsText] = useState("");
  const [assessNow, setAssessNow] = useState(true);
  const [il, setIl] = useState(3);
  const [ii, setIi] = useState(3);
  const [rl, setRl] = useState(2);
  const [ri, setRi] = useState(2);
  const [treatment, setTreatment] = useState("mitigate");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const escalated = VENDOR_TIERS.find((t) => t.value === tier)?.escalated ?? false;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const parseIds = (text: string) =>
        [...new Set(text.split(",").map((s) => s.trim()).filter(Boolean))];
      const policyIds = parseIds(policyIdsText);
      const evidenceIds = parseIds(evidenceIdsText);
      const riskIds = parseIds(riskIdsText);
      const vendor = await apiFetch<Vendor>("/api/vendors", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          category,
          tier,
          dataScope: dataScope.trim() || undefined,
          approver: approver.trim() || undefined,
          nextReviewDate: reviewDate || undefined,
          policyIds: policyIds.length ? policyIds : undefined,
          evidenceIds: evidenceIds.length ? evidenceIds : undefined,
          riskIds: riskIds.length ? riskIds : undefined,
        }),
      });
      if (assessNow) {
        await apiFetch(`/api/vendors/${encodeURIComponent(vendor.vendor_id)}/assess`, {
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
      router.push(`/vendors/view?id=${encodeURIComponent(vendor.vendor_id)}`);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <Plus /> Register vendor
      </Button>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-base">Register vendor</CardTitle>
        <CardDescription>
          A vendor is a risk until understood: assess it on the same 5×5
          matrix as the Risk Register, then approve or decline — each decision
          is a permanent receipt pinned to the round it judged.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex max-w-2xl flex-col gap-4">
          <Field label="Vendor name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. CloudCRM Ltd"
              required
              disabled={busy}
            />
          </Field>
          <Field label="What they provide (optional)">
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
                {VENDOR_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Criticality tier"
              hint={
                escalated
                  ? "High/critical tier: only an admin or governance lead can decide."
                  : "Low/medium tier: the named approver (or owner) decides."
              }
            >
              <select
                className={selectClass}
                value={tier}
                onChange={(e) => setTier(e.target.value)}
                disabled={busy}
              >
                {VENDOR_TIERS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field
            label="Data scope (optional)"
            hint="What data of yours they touch — declared in your words, e.g. “customer contact records”."
          >
            <Input
              value={dataScope}
              onChange={(e) => setDataScope(e.target.value)}
              placeholder="e.g. Customer contact records"
              disabled={busy}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Approver (optional)"
              hint="Who decides approve/decline. Leave blank and the relationship owner decides (tier gate still applies)."
            >
              <Input
                type="email"
                value={approver}
                onChange={(e) => setApprover(e.target.value)}
                placeholder="coo@yourcompany.com"
                disabled={busy}
              />
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
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="Linked policies (optional)"
              hint="The controls governing this relationship."
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
              hint="Their proof — SOC 2 fingerprint, DPA…"
            >
              <Input
                value={evidenceIdsText}
                onChange={(e) => setEvidenceIdsText(e.target.value)}
                placeholder="EVD-2026-001"
                disabled={busy}
              />
            </Field>
            <Field
              label="Linked risks (optional)"
              hint="Risks this vendor is a source of."
            >
              <Input
                value={riskIdsText}
                onChange={(e) => setRiskIdsText(e.target.value)}
                placeholder="RSK-2026-001"
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
                <Field label="Inherent likelihood" hint="Before any safeguards.">
                  <ScaleSelect value={il} onChange={setIl} labels={LIKELIHOOD_LABELS} disabled={busy} />
                </Field>
                <Field label="Inherent impact">
                  <ScaleSelect value={ii} onChange={setIi} labels={IMPACT_LABELS} disabled={busy} />
                </Field>
                <Field label="Residual likelihood" hint="After the safeguards below.">
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
              <Field label="Safeguard notes (optional)">
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. DPA signed + SSO enforced + quarterly access review"
                  disabled={busy}
                />
              </Field>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={busy || !name.trim()}>
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

export function VendorsView() {
  const { me } = useAuth();
  const { vendors, source, loading, error, notEnabled, reload } = useVendors();
  const [filter, setFilter] = useSearchQuery();
  const [status, setStatus] = useState<"OPEN" | "OFFBOARDED" | "all">("OPEN");

  const canWrite = me != null && WRITE_ROLES.has(me.role);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return vendors
      .filter((v) => (status === "all" ? true : v.status === status))
      .filter(
        (v) =>
          !q ||
          [v.vendor_id, v.name, v.category, v.owner_email, v.data_scope]
            .filter(Boolean)
            .some((x) => String(x).toLowerCase().includes(q)),
      );
  }, [vendors, filter, status]);

  if (notEnabled) {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">Vendor Assessments</h1>
        <EmptyState
          icon={FolderLock}
          title="Not enabled for this workspace"
          description="The Vendor Assessments module isn't enabled for this workspace. Ask whoever runs your ProofWorks to turn it on."
        />
      </>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Vendor Assessments</h1>
            {!loading && <DataSourceBadge source={source} error={error} />}
          </div>
          <p className="text-sm text-muted-foreground">
            A vendor is a risk until understood — assess it, then approve or
            decline with a receipt. Declining is evidence too.
          </p>
        </div>
      </div>

      {canWrite && source === "live" && <RegisterCard onCreated={reload} />}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name, ID, category, owner…"
          className="max-w-xs"
        />
        {(["OPEN", "OFFBOARDED", "all"] as const).map((s) => (
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
          icon={Handshake}
          title="No vendors registered"
          description="Register the third parties you rely on — every assessment and decision builds the evidence trail, including the vendors you walked away from."
        />
      ) : (
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Inherent</TableHead>
                  <TableHead>Residual</TableHead>
                  <TableHead>Decision</TableHead>
                  <TableHead>Review</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((v) => (
                  <TableRow key={v.vendor_id}>
                    <TableCell className="font-mono text-xs">
                      <Link
                        href={`/vendors/view?id=${encodeURIComponent(v.vendor_id)}`}
                        className="underline-offset-2 hover:underline"
                      >
                        {v.vendor_id}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-72">
                      <span className={v.status === "OFFBOARDED" ? "text-muted-foreground line-through" : ""}>
                        {v.name}
                      </span>
                      {v.category && (
                        <span className="block text-xs text-muted-foreground">{v.category}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <TierBadge tier={v.tier} />
                    </TableCell>
                    <TableCell>
                      <RiskBandBadge band={v.inherent_band} score={v.inherent_score} />
                    </TableCell>
                    <TableCell>
                      <RiskBandBadge band={v.residual_band} score={v.residual_score} />
                    </TableCell>
                    <TableCell>
                      <DecisionBadge state={v.decision_state} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {isoDay(v.next_review_date)}
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
          in to a workspace with this module enabled for live vendors.
        </p>
      )}
    </>
  );
}
