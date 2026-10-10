"use client";

import { useState } from "react";
import { ArrowLeft, FileUp, Loader2, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

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
  AuthorisationRouteBuilder,
  toAuthorisationRoute,
  type RouteStageInput,
} from "@/components/authorisation-route-builder";
import { apiFetch, apiUpload } from "@/lib/api";
import { useAuth } from "@/lib/use-auth";

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

type CreateResponse = {
  policy_id: string;
  storage: "ready" | "pending";
};

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

const selectClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

export function NewPolicyView() {
  const router = useRouter();
  const { me, status } = useAuth();
  const canCreate = me?.role === "admin" || me?.role === "howldr_support";

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("IT");
  const [owner, setOwner] = useState("");
  const [stages, setStages] = useState<RouteStageInput[]>([
    { members: "", threshold: "all" },
  ]);
  const [exec, setExec] = useState("");
  const [frequency, setFrequency] = useState(12);
  const [roles, setRoles] = useState("all-staff");
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<"idle" | "creating" | "uploading">("idle");
  const [error, setError] = useState<string | null>(null);

  const ownerEmail = owner || me?.email || "";
  const busy = phase !== "idle";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPhase("creating");

    let created: CreateResponse;
    try {
      created = await apiFetch<CreateResponse>("/api/policies", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          category,
          owner: ownerEmail.trim(),
          authorisationRoute: toAuthorisationRoute(stages),
          exec: exec.trim() || undefined,
          reviewFrequencyMonths: frequency,
          applicableRoles: roles
            .split(/[,;]+/)
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
    } catch (err) {
      setPhase("idle");
      setError(err instanceof Error ? err.message : String(err));
      return;
    }

    if (file) {
      setPhase("uploading");
      try {
        await apiUpload(`/api/policies/${encodeURIComponent(created.policy_id)}/document`, file);
      } catch (err) {
        // The policy exists — don't strand the user on the form over the file.
        setPhase("idle");
        router.push(
          `/policies/view?id=${encodeURIComponent(created.policy_id)}&uploadError=${encodeURIComponent(
            err instanceof Error ? err.message : String(err),
          )}`,
        );
        return;
      }
    }

    router.push(`/policies/view?id=${encodeURIComponent(created.policy_id)}`);
  }

  if (status !== "loading" && !canCreate) {
    return (
      <>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">New policy</h1>
        </div>
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-10 text-center">
          <ShieldAlert className="size-8 text-muted-foreground" />
          <p className="max-w-sm text-sm text-muted-foreground">
            Creating policies requires the admin role.
            {status === "signed-out" || status === "disabled"
              ? " Sign in with an admin account to continue."
              : ""}
          </p>
          <Button
            variant="outline"
            render={<Link href="/policies" />}
            nativeButton={false}
          >
            <ArrowLeft /> Back to register
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New policy</h1>
        <p className="text-sm text-muted-foreground">
          Put an existing policy under management, or register one to draft
          now and attach the document later.
        </p>
      </div>

      <form onSubmit={submit} className="max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Policy details</CardTitle>
            <CardDescription>
              The policy starts as a DRAFT at v0.1 — nothing is distributed
              until it has been approved.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <Field label="Title">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Acceptable Use Policy"
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

              <Field
                label="Review frequency"
                hint="Owners get a 30-day advance warning before each review."
              >
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
              hint="Drafts, submits for approval, and distributes. Must sign in to act — invite them if they aren't a user yet."
            >
              <Input
                type="email"
                value={ownerEmail}
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
              hint="A final sign-off after the approvers, required for categories your workspace flags as needing executive approval. Assign the named executive here."
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

            <Field
              label="Policy document (optional)"
              hint="Upload what you have — Word or PDF. It's stored on your secure file appliance as v0.1. Skip this to draft later."
            >
              <Input
                type="file"
                accept=".pdf,.doc,.docx"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                disabled={busy}
              />
            </Field>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={busy || !title.trim() || !ownerEmail.trim()}>
                {phase === "creating" ? (
                  <>
                    <Loader2 className="animate-spin" /> Registering…
                  </>
                ) : phase === "uploading" ? (
                  <>
                    <Loader2 className="animate-spin" /> Uploading document…
                  </>
                ) : (
                  <>
                    <FileUp /> Create policy
                  </>
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                render={<Link href="/policies" />}
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
