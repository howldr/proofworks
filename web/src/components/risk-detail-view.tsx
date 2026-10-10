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
  Stamp,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { LinkedObligationsCard } from "@/components/linked-obligations-card";
import { AcceptanceBadge, RiskBandBadge } from "@/components/risk-badges";
import {
  IMPACT_LABELS,
  LIKELIHOOD_LABELS,
  ScaleSelect,
} from "@/components/risks-view";
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
import { TREATMENTS, useRiskDetail } from "@/lib/use-risks";

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

export function RiskDetailView() {
  const params = useSearchParams();
  const id = params.get("id");
  const { me, email } = useAuth();
  const { risk, source, loading, error, notFound, reload } = useRiskDetail(id);

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
  const [acceptNotes, setAcceptNotes] = useState("");
  const [editingLinks, setEditingLinks] = useState(false);
  const [linksPolicyText, setLinksPolicyText] = useState("");
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

  if (notFound || !risk) {
    return (
      <EmptyState
        icon={FileQuestion}
        title="Risk not found"
        description={id ? `No risk ${id} is visible to you.` : "No risk ID was provided."}
      />
    );
  }

  const canMutate =
    source === "live" &&
    me != null &&
    (MANAGE_ROLES.has(me.role) || (me.role === "owner" && email === risk.owner_email));
  const canAccept =
    source === "live" &&
    me != null &&
    (MANAGE_ROLES.has(me.role) || email === risk.effective_acceptor);

  async function run(label: string, path: string, body?: object, done?: string) {
    setBusy(label);
    setMessage(null);
    setActionError(null);
    try {
      await apiFetch(`/api/risks/${encodeURIComponent(risk!.risk_id)}${path}`, {
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
    setLinksPolicyText(risk!.policy_ids.join(", "));
    setLinksEvidenceText(risk!.evidence_ids.join(", "));
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
      await apiFetch(`/api/risks/${encodeURIComponent(risk!.risk_id)}`, {
        method: "PUT",
        body: JSON.stringify({
          policyIds: parseIds(linksPolicyText),
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

  const latest = risk.assessments[risk.assessments.length - 1] ?? null;

  return (
    <>
      <div>
        <Button
          render={<Link href="/risks" />}
          nativeButton={false}
          variant="ghost"
          size="sm"
          className="-ml-2 mb-2"
        >
          <ArrowLeft /> Back to Risk Register
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{risk.title}</h1>
          <AcceptanceBadge state={risk.acceptance_state} />
          {risk.status === "CLOSED" && (
            <Badge variant="outline" className="text-muted-foreground line-through">
              CLOSED
            </Badge>
          )}
        </div>
        <p className="mt-1 font-mono text-sm text-muted-foreground">{risk.risk_id}</p>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
          {risk.description && <CardDescription>{risk.description}</CardDescription>}
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetaItem label="Category" value={risk.category ?? "—"} />
          <MetaItem label="Owner" value={risk.owner_email} />
          <MetaItem
            label="Acceptor"
            value={
              risk.acceptor_email ?? `${risk.owner_email} (owner)`
            }
          />
          <MetaItem label="Next review" value={isoDay(risk.next_review_date)} />
          {risk.policy_ids.length > 0 && (
            <MetaItem
              label="Linked policies"
              value={risk.policy_ids.map((p, i) => (
                <span key={p}>
                  {i > 0 && ", "}
                  <Link
                    className="underline-offset-2 hover:underline"
                    href={`/policies/view?id=${encodeURIComponent(p)}`}
                  >
                    {p}
                  </Link>
                </span>
              ))}
            />
          )}
          {risk.evidence_ids.length > 0 && (
            <MetaItem
              label="Linked evidence"
              value={risk.evidence_ids.map((e, i) => (
                <span key={e}>
                  {i > 0 && ", "}
                  <Link
                    className="underline-offset-2 hover:underline"
                    href={`/evidence/view?id=${encodeURIComponent(e)}`}
                  >
                    {e}
                  </Link>
                </span>
              ))}
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
                    hint="Comma-separated policy IDs (the controls treating this risk). Each must exist in the register."
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
                    hint="Comma-separated evidence IDs (the proof the treatment operates)."
                  >
                    <Input
                      value={linksEvidenceText}
                      onChange={(e) => setLinksEvidenceText(e.target.value)}
                      placeholder="EVD-2026-001"
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

      <LinkedObligationsCard
        obligations={risk.linked_obligations ?? []}
        description="Why this risk matters — the obligations it threatens."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Current position{latest ? ` — round ${latest.round}` : ""}
          </CardTitle>
          <CardDescription>
            Inherent (before treatment) → residual (after). Acceptance pins to
            this round; re-assessing requires fresh acceptance.
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

          {canAccept && risk.status === "OPEN" && risk.acceptance_state === "awaiting_acceptance" && (
            <div className="flex flex-col gap-2 rounded-lg border p-3">
              <p className="text-sm text-muted-foreground">
                Accepting records a permanent receipt in your name, pinned to
                round {latest?.round}.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={acceptNotes}
                  onChange={(e) => setAcceptNotes(e.target.value)}
                  placeholder="Notes (optional), e.g. Accepted for FY26"
                  className="max-w-sm"
                  disabled={busy !== null}
                />
                <Button
                  onClick={() =>
                    run("accept", "/accept", { notes: acceptNotes.trim() || undefined }, "Acceptance recorded.")
                  }
                  disabled={busy !== null}
                >
                  {busy === "accept" ? <Loader2 className="animate-spin" /> : <Stamp />}
                  Accept residual risk
                </Button>
              </div>
            </div>
          )}

          {canMutate && risk.status === "OPEN" && (
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
                  if (window.confirm(`Close ${risk.risk_id}? It stays on record.`)) {
                    void run("close", "/close", {}, "Risk closed.");
                  }
                }}
                disabled={busy !== null}
              >
                {busy === "close" ? <Loader2 className="animate-spin" /> : <Archive />}
                Close
              </Button>
            </div>
          )}
          {canMutate && risk.status === "CLOSED" && (
            <div>
              <Button variant="outline" onClick={() => run("reopen", "/reopen", {}, "Risk reopened.")} disabled={busy !== null}>
                {busy === "reopen" ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                Reopen
              </Button>
            </div>
          )}

          {reassessing && (
            <div className="flex flex-col gap-4 rounded-lg border p-3">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Inherent likelihood" hint="Before any treatment.">
                  <ScaleSelect value={il} onChange={setIl} labels={LIKELIHOOD_LABELS} disabled={busy !== null} />
                </Field>
                <Field label="Inherent impact">
                  <ScaleSelect value={ii} onChange={setIi} labels={IMPACT_LABELS} disabled={busy !== null} />
                </Field>
                <Field label="Residual likelihood" hint="After the treatment below.">
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
              <Field label="Treatment notes (optional)">
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
                    }, "Assessment recorded — a new round is open for acceptance.")
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
            <CardDescription>Append-only rounds; acceptances pin to a round.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {risk.assessments.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {source === "demo"
                  ? "History is available when connected to the API."
                  : "No assessments recorded."}
              </p>
            ) : (
              [...risk.assessments].reverse().map((a) => {
                const acceptance = risk.acceptances.find((x) => x.round === a.round);
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
                    {acceptance ? (
                      <span className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
                        <CheckCircle2 className="size-3.5" />
                        accepted by {acceptance.acceptor_email} ·{" "}
                        {String(acceptance.created_at).slice(0, 10)}
                        {acceptance.notes ? ` — ${acceptance.notes}` : ""}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">not accepted</span>
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
            <CardDescription>Append-only — the risk&apos;s chain of custody.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {risk.events.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {source === "demo"
                  ? "Event history is available when connected to the API."
                  : "No events recorded."}
              </p>
            ) : (
              risk.events.map((e) => (
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
