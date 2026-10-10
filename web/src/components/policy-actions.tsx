"use client";

import { useState } from "react";
import {
  Archive,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Send,
  Undo2,
  Workflow,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api";
import { type Policy } from "@/lib/policies";
import { useAuth } from "@/lib/use-auth";
import { useGroups } from "@/lib/use-groups";
import { type Authoriser, type ExecSummary } from "@/lib/use-register";

type ActionResponse = {
  message: string;
  notifications?: { notified: string[]; failed: string[] };
};

function isoDaysFromNow(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/**
 * Status- and role-aware lifecycle actions. Only the legal next steps for
 * this user are shown; every action re-fetches the policy when done.
 */
export function PolicyActions({
  policy,
  authorisers,
  exec,
  onChanged,
}: {
  policy: Policy;
  authorisers: Authoriser[];
  exec: ExecSummary;
  onChanged: () => void;
}) {
  const { me, email } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deadline, setDeadline] = useState(() => isoDaysFromNow(14));
  const [feedback, setFeedback] = useState("");
  const [returning, setReturning] = useState(false);
  const [recipientsText, setRecipientsText] = useState("");
  const [ackDeadline, setAckDeadline] = useState(() => isoDaysFromNow(14));
  const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>([]);

  const isAdmin = me?.role === "admin" || me?.role === "howldr_support";
  const isOwner = isAdmin || (email != null && email === policy.owner);
  const canDistribute = policy.status === "PENDING ACCEPTANCE" && isOwner;
  const { groups } = useGroups(canDistribute);
  const myAuthoriserEntry = authorisers.find((a) => a.email === email) ?? null;
  const isAuthoriser = isAdmin || myAuthoriserEntry !== null;
  const alreadyApproved = myAuthoriserEntry?.approved_at != null;
  const isExec = isAdmin || (email != null && email === exec.email);

  async function run(label: string, path: string, body?: object) {
    setBusy(label);
    setError(null);
    setResult(null);
    try {
      const res = await apiFetch<ActionResponse>(
        `/api/policies/${encodeURIComponent(policy.policy_id)}${path}`,
        { method: "POST", body: JSON.stringify(body ?? {}) },
      );
      let summary = res.message;
      if (res.notifications) {
        const { notified, failed } = res.notifications;
        if (notified.length) summary += ` Notified: ${notified.join(", ")}.`;
        if (failed.length) summary += ` Could not notify: ${failed.join(", ")}.`;
      }
      setResult(summary);
      setReturning(false);
      setFeedback("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const actions: React.ReactNode[] = [];

  if (policy.status === "DRAFT" && isOwner) {
    actions.push(
      <div key="submit" className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">
            Approval deadline
          </span>
          <Input
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className="w-44"
            disabled={busy !== null}
          />
        </label>
        <Button
          onClick={() => run("submit", "/submit", { expiresAt: deadline })}
          disabled={busy !== null || !deadline}
        >
          {busy === "submit" ? <Loader2 className="animate-spin" /> : <Send />}
          Submit for approval
        </Button>
      </div>,
    );
  }

  if (policy.status === "UNDER REVIEW" && isAuthoriser && !alreadyApproved) {
    actions.push(
      <div key="approve" className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => run("approve", "/approve")}
            disabled={busy !== null}
          >
            {busy === "approve" ? (
              <Loader2 className="animate-spin" />
            ) : (
              <CheckCircle2 />
            )}
            Approve
          </Button>
          <Button
            variant="outline"
            onClick={() => setReturning((r) => !r)}
            disabled={busy !== null}
          >
            <Undo2 />
            Return for revision
          </Button>
        </div>
        {returning && (
          <div className="flex flex-col gap-2">
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="What needs to change before you can approve?"
              rows={3}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              disabled={busy !== null}
            />
            <div>
              <Button
                variant="destructive"
                onClick={() => run("return", "/return", { feedback })}
                disabled={busy !== null || !feedback.trim()}
              >
                {busy === "return" ? <Loader2 className="animate-spin" /> : <Undo2 />}
                Return with feedback
              </Button>
            </div>
          </div>
        )}
      </div>,
    );
  }

  if (policy.status === "UNDER REVIEW" && alreadyApproved) {
    actions.push(
      <p key="approved" className="text-sm text-muted-foreground">
        You have approved this version. Waiting for the remaining approvers.
      </p>,
    );
  }

  if (policy.status === "OWNER ACCEPTANCE" && isOwner) {
    actions.push(
      <div key="accept" className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          All approvers have approved. Accept the approved version to advance
          it{" "}
          {/* onward routing (exec gate or distribution) is decided server-side */}
          for distribution.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => run("accept", "/accept")}
            disabled={busy !== null}
          >
            {busy === "accept" ? (
              <Loader2 className="animate-spin" />
            ) : (
              <CheckCircle2 />
            )}
            Accept approved version
          </Button>
          <Button
            variant="outline"
            onClick={() => setReturning((r) => !r)}
            disabled={busy !== null}
          >
            <Undo2 />
            Return for revision
          </Button>
        </div>
        {returning && (
          <div className="flex flex-col gap-2">
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="What needs to change before you can accept?"
              rows={3}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              disabled={busy !== null}
            />
            <div>
              <Button
                variant="destructive"
                onClick={() => run("accept-return", "/accept-return", { feedback })}
                disabled={busy !== null || !feedback.trim()}
              >
                {busy === "accept-return" ? <Loader2 className="animate-spin" /> : <Undo2 />}
                Return with feedback
              </Button>
            </div>
          </div>
        )}
      </div>,
    );
  }

  if (policy.status === "OWNER ACCEPTANCE" && !isOwner) {
    actions.push(
      <p key="accept-waiting" className="text-sm text-muted-foreground">
        Awaiting the owner&apos;s acceptance of the approved version.
      </p>,
    );
  }

  if (policy.status === "EXEC REVIEW" && isExec) {
    actions.push(
      <div key="exec" className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          All approvers have approved. Your executive sign-off releases this
          policy for distribution.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => run("exec-authorise", "/exec-authorise")}
            disabled={busy !== null}
          >
            {busy === "exec-authorise" ? (
              <Loader2 className="animate-spin" />
            ) : (
              <CheckCircle2 />
            )}
            Approve for distribution
          </Button>
          <Button
            variant="outline"
            onClick={() => setReturning((r) => !r)}
            disabled={busy !== null}
          >
            <Undo2 />
            Return for revision
          </Button>
        </div>
        {returning && (
          <div className="flex flex-col gap-2">
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="What needs to change before you can approve?"
              rows={3}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              disabled={busy !== null}
            />
            <div>
              <Button
                variant="destructive"
                onClick={() => run("exec-return", "/exec-return", { feedback })}
                disabled={busy !== null || !feedback.trim()}
              >
                {busy === "exec-return" ? <Loader2 className="animate-spin" /> : <Undo2 />}
                Return with feedback
              </Button>
            </div>
          </div>
        )}
      </div>,
    );
  }

  if (policy.status === "EXEC REVIEW" && !isExec) {
    actions.push(
      <p key="exec-waiting" className="text-sm text-muted-foreground">
        Awaiting executive sign-off
        {exec.email ? ` from ${exec.email}` : ""} before distribution.
      </p>,
    );
  }

  if (canDistribute) {
    // Staff emails, separated by newlines/commas/semicolons; deduplicated.
    const recipientEmails = Array.from(
      new Set(
        recipientsText
          .split(/[\s,;]+/)
          .map((e) => e.trim().toLowerCase())
          .filter((e) => e.includes("@")),
      ),
    );
    const hasRecipients =
      recipientEmails.length > 0 || selectedGroupIds.length > 0;
    const summary = [
      selectedGroupIds.length > 0 &&
        `${selectedGroupIds.length} audience${selectedGroupIds.length === 1 ? "" : "s"}`,
      recipientEmails.length > 0 &&
        `${recipientEmails.length} email${recipientEmails.length === 1 ? "" : "s"}`,
    ]
      .filter(Boolean)
      .join(" + ");
    actions.push(
      <div key="distribute" className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Send the approved document to staff as an authenticated secure
          message. Each recipient&apos;s download is their acknowledgement
          record.
        </p>
        {groups.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {groups.map((g) => {
              const selected = selectedGroupIds.includes(g.id);
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() =>
                    setSelectedGroupIds((ids) =>
                      selected ? ids.filter((id) => id !== g.id) : [...ids, g.id],
                    )
                  }
                  disabled={busy !== null}
                  className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input text-muted-foreground hover:border-ring"
                  }`}
                >
                  {g.name}
                  <span
                    className="ml-1.5 text-xs opacity-70"
                    title={
                      (g.roles?.length ?? 0) > 0
                        ? "Also includes everyone holding the audience's roles at send time"
                        : undefined
                    }
                  >
                    {g.member_count}
                    {(g.roles?.length ?? 0) > 0 && "+"}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <textarea
          value={recipientsText}
          onChange={(e) => setRecipientsText(e.target.value)}
          placeholder={
            groups.length > 0
              ? "Additional emails — one per line or comma-separated (optional)"
              : "Recipient emails — one per line or comma-separated\njane@company.com\nsam@company.com"
          }
          rows={groups.length > 0 ? 2 : 4}
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          disabled={busy !== null}
        />
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              Acknowledgement deadline
            </span>
            <Input
              type="date"
              value={ackDeadline}
              onChange={(e) => setAckDeadline(e.target.value)}
              className="w-44"
              disabled={busy !== null}
            />
          </label>
          <Button
            onClick={() =>
              run("distribute", "/distribute", {
                recipients: recipientEmails.map((email) => ({ email })),
                groupIds: selectedGroupIds,
                expiresAt: ackDeadline,
              })
            }
            disabled={busy !== null || !hasRecipients || !ackDeadline}
          >
            {busy === "distribute" ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Send />
            )}
            Distribute
            {summary && ` to ${summary}`}
          </Button>
        </div>
      </div>,
    );
  }

  if (policy.status === "ACTIVE" && isOwner) {
    actions.push(
      <Button
        key="review"
        variant="outline"
        onClick={() => run("review", "/review")}
        disabled={busy !== null}
      >
        {busy === "review" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        Trigger review cycle
      </Button>,
    );
  }

  if (policy.status !== "RETIRED" && isAdmin) {
    actions.push(
      <Button
        key="retire"
        variant="ghost"
        className="text-destructive hover:text-destructive"
        onClick={() => {
          if (window.confirm(`Retire ${policy.policy_id}? It will leave the active register.`)) {
            void run("retire", "/retire");
          }
        }}
        disabled={busy !== null}
      >
        {busy === "retire" ? <Loader2 className="animate-spin" /> : <Archive />}
        Retire policy
      </Button>,
    );
  }

  if (actions.length === 0 && !result && !error) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Workflow className="size-4 text-muted-foreground" />
          Actions
        </CardTitle>
        <CardDescription>
          Available next steps for your role at this lifecycle stage.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {actions}
        {result && (
          <p className="text-sm text-emerald-700 dark:text-emerald-400">
            {result}
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
