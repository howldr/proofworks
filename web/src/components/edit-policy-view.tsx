"use client";

import { useState } from "react";
import {
  ArrowLeft,
  FileQuestion,
  Loader2,
  Save,
  ShieldAlert,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

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
  AuthorisationRouteBuilder,
  stagesFromRoute,
  toAuthorisationRoute,
  type RouteStageInput,
} from "@/components/authorisation-route-builder";
import { apiFetch } from "@/lib/api";
import { type Policy } from "@/lib/policies";
import { useAuth } from "@/lib/use-auth";
import {
  type Authoriser,
  type AuthorisationStage,
  usePolicyDetail,
} from "@/lib/use-register";

const CATEGORIES = [
  "IT",
  "Security",
  "Privacy",
  "HR",
  "Compliance",
  "Health & Safety",
  "Operations",
  "Other",
];

const REVIEW_FREQUENCIES = [
  { months: 6, label: "Every 6 months" },
  { months: 12, label: "Every 12 months (recommended)" },
  { months: 24, label: "Every 24 months" },
];

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

export function EditPolicyView() {
  const params = useSearchParams();
  const id = params.get("id");
  const { me, email } = useAuth();
  const { policy, authorisers, authorisationRoute, exec, source, loading, notFound } =
    usePolicyDetail(id);

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full max-w-2xl" />
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
            : "No policy ID was provided."
        }
      />
    );
  }

  const canEdit =
    source === "live" &&
    (me?.role === "admin" ||
      me?.role === "howldr_support" ||
      (email != null && email === policy.owner));

  if (!canEdit) {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">Edit policy</h1>
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-10 text-center">
          <ShieldAlert className="size-8 text-muted-foreground" />
          <p className="max-w-sm text-sm text-muted-foreground">
            Only the policy owner or an admin can edit policy details.
          </p>
          <Button
            variant="outline"
            render={<Link href={`/policies/view?id=${encodeURIComponent(policy.policy_id)}`} />}
            nativeButton={false}
          >
            <ArrowLeft /> Back to policy
          </Button>
        </div>
      </>
    );
  }

  // key remounts the form with fresh initial state once the policy is loaded —
  // avoids setting form state from data inside an effect.
  return (
    <EditForm
      key={policy.policy_id}
      policy={policy}
      authorisers={authorisers}
      route={authorisationRoute}
      execEmail={exec.email ?? ""}
    />
  );
}

function EditForm({
  policy,
  authorisers,
  route,
  execEmail,
}: {
  policy: Policy;
  authorisers: Authoriser[];
  route: AuthorisationStage[];
  execEmail: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(policy.title);
  const [category, setCategory] = useState(
    CATEGORIES.includes(policy.category) ? policy.category : "Other",
  );
  const [owner, setOwner] = useState(policy.owner);
  const [frequency, setFrequency] = useState(
    policy.review_frequency_months ?? 12,
  );
  const [stages, setStages] = useState<RouteStageInput[]>(() =>
    stagesFromRoute(
      route,
      authorisers.map((a) => a.email),
    ),
  );
  const [exec, setExec] = useState(execEmail);
  const [roles, setRoles] = useState(policy.applicable_roles.join(", "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiFetch(`/api/policies/${encodeURIComponent(policy.policy_id)}`, {
        method: "PUT",
        body: JSON.stringify({
          title: title.trim(),
          category,
          owner: owner.trim(),
          reviewFrequencyMonths: frequency,
          applicableRoles: roles
            .split(/[,;]+/)
            .map((s) => s.trim())
            .filter(Boolean),
          // Omitted when the builder is empty, so the field is left unchanged
          // rather than rejected as a zero-stage route.
          authorisationRoute: toAuthorisationRoute(stages),
          // Always sent ('' clears the assignment).
          exec: exec.trim(),
        }),
      });
      router.push(
        `/policies/view?id=${encodeURIComponent(policy.policy_id)}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <>
      <div>
        <Button
          render={<Link href={`/policies/view?id=${encodeURIComponent(policy.policy_id)}`} />}
          nativeButton={false}
          variant="ghost"
          size="sm"
          className="-ml-2 mb-2"
        >
          <ArrowLeft /> Back to policy
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">Edit policy</h1>
        <p className="mt-1 font-mono text-sm text-muted-foreground">
          {policy.policy_id} · {policy.current_version}
        </p>
      </div>

      <form onSubmit={submit} className="max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Policy details</CardTitle>
            <CardDescription>
              Edits the register only — the document, version, and lifecycle
              state are unchanged. Changing approvers during review resets
              their approvals for this version.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <Field label="Title">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                disabled={busy}
              />
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Category">
                <select
                  className={selectClass}
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  disabled={busy}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Review frequency">
                <select
                  className={selectClass}
                  value={frequency}
                  onChange={(e) => setFrequency(Number(e.target.value))}
                  disabled={busy}
                >
                  {REVIEW_FREQUENCIES.map((f) => (
                    <option key={f.months} value={f.months}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field
              label="Policy owner"
              hint="Drafts, submits, and distributes. Must be a user who can sign in."
            >
              <Input
                type="email"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                required
                disabled={busy}
              />
            </Field>

            <AuthorisationRouteBuilder
              stages={stages}
              onChange={setStages}
              disabled={busy}
            />

            <Field
              label="Executive approver (optional)"
              hint="Final sign-off after the approvers, required for categories your workspace flags. Leave blank for none."
            >
              <Input
                type="email"
                value={exec}
                onChange={(e) => setExec(e.target.value)}
                placeholder="ceo@yourcompany.com"
                disabled={busy}
              />
            </Field>

            <Field
              label="Applies to"
              hint="Comma-separated roles or groups used at distribution time."
            >
              <Input
                value={roles}
                onChange={(e) => setRoles(e.target.value)}
                disabled={busy}
              />
            </Field>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex items-center gap-3">
              <Button
                type="submit"
                disabled={busy || !title.trim() || !owner.trim()}
              >
                {busy ? <Loader2 className="animate-spin" /> : <Save />}
                Save changes
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                render={<Link href={`/policies/view?id=${encodeURIComponent(policy.policy_id)}`} />}
                nativeButton={false}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </>
  );
}
