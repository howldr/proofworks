"use client";

import { useState } from "react";
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileQuestion,
  History,
  Link2,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Stamp,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

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
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/use-auth";
import { TREATMENTS } from "@/lib/use-risks";
import { useVendorDetail } from "@/lib/use-vendors";

const MANAGE_ROLES = new Set(["admin", "howldr_support", "governance_lead"]);

const selectClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

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

function LinkedIds({ ids, base }: { ids: string[]; base: string }) {
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

export function VendorDetailView() {
  const params = useSearchParams();
  const id = params.get("id");
  const { me, email } = useAuth();
  const { vendor, source, loading, error, notFound, reload } = useVendorDetail(id);

  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reassessing, setReassessing] = useState(false);
  const [il, setIl] = useState(3);
  const [ii, setIi] = useState(3);
  const [rl, setRl] = useState(2);
  const [ri, setRi] = useState(2);
  const [treatment, setTreatment] = useState("mitigate");
  const [notes, setNotes] = useState("");
  const [decisionNotes, setDecisionNotes] = useState("");
  const [editingLinks, setEditingLinks] = useState(false);
  const [linksPolicyText, setLinksPolicyText] = useState("");
  const [linksEvidenceText, setLinksEvidenceText] = useState("");
  const [linksRiskText, setLinksRiskText] = useState("");
  const [linksError, setLinksError] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (notFound || !vendor) {
    return (
      <EmptyState
        icon={FileQuestion}
        title="Vendor not found"
        description={id ? `No vendor ${id} is visible to you.` : "No vendor ID was provided."}
      />
    );
  }

  const canMutate =
    source === "live" &&
    me != null &&
    (MANAGE_ROLES.has(me.role) || (me.role === "owner" && email === vendor.owner_email));
  const canDecide =
    source === "live" &&
    me != null &&
    (MANAGE_ROLES.has(me.role) ||
      (!vendor.tier_escalated && email === vendor.effective_approver));

  async function run(label: string, path: string, body?: object, done?: string) {
    setBusy(label);
    setMessage(null);
    setActionError(null);
    try {
      await apiFetch(`/api/vendors/${encodeURIComponent(vendor!.vendor_id)}${path}`, {
        method: "POST",
        body: JSON.stringify(body ?? {}),
      });
      if (done) setMessage(done);
      setReassessing(false);
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  function openLinkEditor() {
    setLinksPolicyText(vendor!.policy_ids.join(", "));
    setLinksEvidenceText(vendor!.evidence_ids.join(", "));
    setLinksRiskText(vendor!.risk_ids.join(", "));
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
      await apiFetch(`/api/vendors/${encodeURIComponent(vendor!.vendor_id)}`, {
        method: "PUT",
        body: JSON.stringify({
          policyIds: parseIds(linksPolicyText),
          evidenceIds: parseIds(linksEvidenceText),
          riskIds: parseIds(linksRiskText),
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

  const latest = vendor.assessments[vendor.assessments.length - 1] ?? null;

  return (
    <>
      <div>
        <Button
          render={<Link href="/vendors" />}
          nativeButton={false}
          variant="ghost"
          size="sm"
          className="-ml-2 mb-2"
        >
          <ArrowLeft /> Back to Vendor Assessments
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{vendor.name}</h1>
          <TierBadge tier={vendor.tier} />
          <DecisionBadge state={vendor.decision_state} />
          {vendor.status === "OFFBOARDED" && (
            <Badge variant="outline" className="text-muted-foreground line-through">
              OFFBOARDED
            </Badge>
          )}
        </div>
        <p className="mt-1 font-mono text-sm text-muted-foreground">{vendor.vendor_id}</p>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
          {vendor.description && <CardDescription>{vendor.description}</CardDescription>}
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetaItem label="Category" value={vendor.category ?? "—"} />
          <MetaItem label="Relationship owner" value={vendor.owner_email} />
          <MetaItem
            label="Approver"
            value={
              vendor.tier_escalated ? (
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="size-3.5 text-muted-foreground" />
                  admin / governance lead ({vendor.tier} tier)
                </span>
              ) : (
                vendor.approver_email ?? `${vendor.owner_email} (owner)`
              )
            }
          />
          <MetaItem label="Data scope" value={vendor.data_scope ?? "—"} />
          <MetaItem label="Next review" value={isoDay(vendor.next_review_date)} />
          {vendor.policy_ids.length > 0 && (
            <MetaItem
              label="Linked policies"
              value={<LinkedIds ids={vendor.policy_ids} base="/policies/view" />}
            />
          )}
          {vendor.evidence_ids.length > 0 && (
            <MetaItem
              label="Linked evidence"
              value={<LinkedIds ids={vendor.evidence_ids} base="/evidence/view" />}
            />
          )}
          {vendor.risk_ids.length > 0 && (
            <MetaItem
              label="Linked risks"
              value={<LinkedIds ids={vendor.risk_ids} base="/risks/view" />}
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
                  <Link2 /> Edit links
                </Button>
              ) : (
                <div className="flex flex-col gap-3 rounded-lg border p-3">
                  <Field
                    label="Linked policies"
                    hint="Comma-separated policy IDs (the controls governing this relationship). Each must exist in the register."
                  >
                    <Input
                      value={linksPolicyText}
                      onChange={(e) => setLinksPolicyText(e.target.value)}
                      placeholder="POL-2026-001, POL-2026-002"
                      disabled={busy !== null}
                    />
                  </Field>
                  <Field
                    label="Linked evidence"
                    hint="Comma-separated evidence IDs (their proof — SOC 2 fingerprint, DPA…)."
                  >
                    <Input
                      value={linksEvidenceText}
                      onChange={(e) => setLinksEvidenceText(e.target.value)}
                      placeholder="EVD-2026-001"
                      disabled={busy !== null}
                    />
                  </Field>
                  <Field
                    label="Linked risks"
                    hint="Comma-separated risk IDs (risks this vendor is a source of)."
                  >
                    <Input
                      value={linksRiskText}
                      onChange={(e) => setLinksRiskText(e.target.value)}
                      placeholder="RSK-2026-001"
                      disabled={busy !== null}
                    />
                  </Field>
                  {linksError && <p className="text-sm text-destructive">{linksError}</p>}
                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={saveLinks} disabled={busy !== null}>
                      {busy === "links" ? <Loader2 className="animate-spin" /> : <Link2 />}
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Current position{latest ? ` — round ${latest.round}` : ""}
          </CardTitle>
          <CardDescription>
            Inherent (before safeguards) → residual (after). The decision pins
            to this round; re-assessing reopens it.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!latest ? (
            <p className="text-sm text-muted-foreground">Not assessed yet.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Inherent</span>
                <RiskBandBadge band={latest.inherent_band} score={latest.inherent_score} />
                <span className="text-xs text-muted-foreground">
                  ({LIKELIHOOD_LABELS[latest.inherent_likelihood - 1]} ×{" "}
                  {IMPACT_LABELS[latest.inherent_impact - 1]})
                </span>
              </div>
              <ArrowRight className="size-4 text-muted-foreground" />
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Residual</span>
                <RiskBandBadge band={latest.residual_band} score={latest.residual_score} />
                <span className="text-xs text-muted-foreground">
                  ({LIKELIHOOD_LABELS[latest.residual_likelihood - 1]} ×{" "}
                  {IMPACT_LABELS[latest.residual_impact - 1]})
                </span>
              </div>
              <Badge variant="outline" className="capitalize">{latest.treatment}</Badge>
            </div>
          )}
          {latest?.treatment_notes && (
            <p className="text-sm text-muted-foreground">{latest.treatment_notes}</p>
          )}

          {canDecide && vendor.status === "OPEN" && vendor.decision_state === "awaiting_decision" && (
            <div className="flex flex-col gap-2 rounded-lg border p-3">
              <p className="text-sm text-muted-foreground">
                Deciding records a permanent receipt in your name, pinned to
                round {latest?.round}. Approve to engage (accepting the residual
                risk) — or decline to walk away; a decline is evidence of due
                diligence too.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={decisionNotes}
                  onChange={(e) => setDecisionNotes(e.target.value)}
                  placeholder="Notes (optional), e.g. DPA signed, engaged for FY27"
                  className="max-w-sm"
                  disabled={busy !== null}
                />
                <Button
                  onClick={() =>
                    run("approve", "/decide", {
                      decision: "approve",
                      notes: decisionNotes.trim() || undefined,
                    }, "Approval recorded.")
                  }
                  disabled={busy !== null}
                >
                  {busy === "approve" ? <Loader2 className="animate-spin" /> : <Stamp />}
                  Approve vendor
                </Button>
                <Button
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  onClick={() =>
                    run("decline", "/decide", {
                      decision: "decline",
                      notes: decisionNotes.trim() || undefined,
                    }, "Decline recorded — walking away, on the record.")
                  }
                  disabled={busy !== null}
                >
                  {busy === "decline" ? <Loader2 className="animate-spin" /> : <XCircle />}
                  Decline vendor
                </Button>
              </div>
            </div>
          )}

          {canMutate && vendor.status === "OPEN" && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => setReassessing((r) => !r)}
                disabled={busy !== null}
              >
                <RotateCcw />
                {latest ? "Re-assess" : "Assess"}
              </Button>
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => {
                  if (window.confirm(`Offboard ${vendor.vendor_id}? It stays on record.`)) {
                    void run("offboard", "/offboard", {}, "Vendor offboarded.");
                  }
                }}
                disabled={busy !== null}
              >
                {busy === "offboard" ? <Loader2 className="animate-spin" /> : <Archive />}
                Offboard
              </Button>
            </div>
          )}
          {canMutate && vendor.status === "OFFBOARDED" && (
            <div>
              <Button variant="outline" onClick={() => run("reactivate", "/reactivate", {}, "Vendor reactivated.")} disabled={busy !== null}>
                {busy === "reactivate" ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                Reactivate
              </Button>
            </div>
          )}

          {reassessing && (
            <div className="flex flex-col gap-4 rounded-lg border p-3">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Inherent likelihood" hint="Before any safeguards.">
                  <ScaleSelect value={il} onChange={setIl} labels={LIKELIHOOD_LABELS} disabled={busy !== null} />
                </Field>
                <Field label="Inherent impact">
                  <ScaleSelect value={ii} onChange={setIi} labels={IMPACT_LABELS} disabled={busy !== null} />
                </Field>
                <Field label="Residual likelihood" hint="After the safeguards below.">
                  <ScaleSelect value={rl} onChange={setRl} labels={LIKELIHOOD_LABELS} disabled={busy !== null} />
                </Field>
                <Field label="Residual impact">
                  <ScaleSelect value={ri} onChange={setRi} labels={IMPACT_LABELS} disabled={busy !== null} />
                </Field>
              </div>
              <Field label="Treatment">
                <select
                  className={selectClass}
                  value={treatment}
                  onChange={(e) => setTreatment(e.target.value)}
                  disabled={busy !== null}
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
                  disabled={busy !== null}
                />
              </Field>
              <div>
                <Button
                  onClick={() =>
                    run("assess", "/assess", {
                      inherentLikelihood: il,
                      inherentImpact: ii,
                      residualLikelihood: rl,
                      residualImpact: ri,
                      treatment,
                      treatmentNotes: notes.trim() || undefined,
                    }, "Assessment recorded — a new round is open for decision.")
                  }
                  disabled={busy !== null}
                >
                  {busy === "assess" ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
                  Record assessment
                </Button>
              </div>
            </div>
          )}

          {message && <p className="text-sm text-emerald-700 dark:text-emerald-400">{message}</p>}
          {actionError && <p className="text-sm text-destructive">{actionError}</p>}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Assessment history</CardTitle>
            <CardDescription>Append-only rounds; decisions pin to a round.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {vendor.assessments.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {source === "demo"
                  ? "History is available when connected to the API."
                  : "No assessments recorded."}
              </p>
            ) : (
              [...vendor.assessments].reverse().map((a) => {
                const decision = vendor.decisions.find((x) => x.round === a.round);
                return (
                  <div key={a.id} className="flex flex-col gap-1.5 rounded-lg border p-2.5 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Round {a.round}
                      </span>
                      <RiskBandBadge band={a.inherent_band} score={a.inherent_score} />
                      <ArrowRight className="size-3 text-muted-foreground" />
                      <RiskBandBadge band={a.residual_band} score={a.residual_score} />
                      <Badge variant="outline" className="capitalize">{a.treatment}</Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {a.assessed_by} · {String(a.created_at).slice(0, 10)}
                    </span>
                    {decision ? (
                      decision.decision === "approve" ? (
                        <span className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="size-3.5" />
                          approved by {decision.decider_email} ·{" "}
                          {String(decision.created_at).slice(0, 10)}
                          {decision.notes ? ` — ${decision.notes}` : ""}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-red-700 dark:text-red-400">
                          <XCircle className="size-3.5" />
                          declined by {decision.decider_email} ·{" "}
                          {String(decision.created_at).slice(0, 10)}
                          {decision.notes ? ` — ${decision.notes}` : ""}
                        </span>
                      )
                    ) : (
                      <span className="text-xs text-muted-foreground">not decided</span>
                    )}
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="size-4 text-muted-foreground" />
              Event history
            </CardTitle>
            <CardDescription>Append-only — the vendor&apos;s chain of custody.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {vendor.events.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {source === "demo"
                  ? "Event history is available when connected to the API."
                  : "No events recorded."}
              </p>
            ) : (
              vendor.events.map((e) => (
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
      </div>
    </>
  );
}
