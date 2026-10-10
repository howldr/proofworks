"use client";

import { useState } from "react";
import { Copy, Loader2, Lock, Trash2, UserPlus } from "lucide-react";

import { DataSourceBadge } from "@/components/data-source-badge";
import { EmptyState } from "@/components/empty-state";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError, apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/use-auth";
import {
  ASSIGNABLE_ROLES,
  ROLE_HINTS,
  ROLE_LABELS,
  useStaff,
  type StaffUser,
} from "@/lib/use-staff";

const READ_ROLES = new Set(["admin", "governance_lead", "howldr_support"]);
const MANAGE_ROLES = new Set(["admin", "howldr_support"]);

const SELECT_CLASS =
  "rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50";

function isoDay(value: string | null): string {
  return value ? value.slice(0, 10) : "—";
}

function RoleBadge({ role }: { role: string }) {
  const admin = role === "admin" || role === "howldr_support";
  return (
    <Badge
      variant="outline"
      className={
        admin
          ? "border-primary/30 bg-primary/10 text-primary"
          : "text-muted-foreground"
      }
      title={ROLE_HINTS[role]}
    >
      {ROLE_LABELS[role] ?? role}
    </Badge>
  );
}

/** Invite form + the action link to forward after a successful invite. */
function InviteCard({ onInvited }: { onInvited: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("authoriser");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<
    { email: string; actionLink: string | null; reused: boolean } | null
  >(null);
  const [copied, setCopied] = useState(false);

  async function invite() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await apiFetch<{
        user: StaffUser;
        actionLink: string | null;
        reused: boolean;
      }>("/api/users", {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), role }),
      });
      setResult({ email: res.user.email, actionLink: res.actionLink, reused: res.reused });
      setEmail("");
      onInvited();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!result?.actionLink) return;
    try {
      await navigator.clipboard.writeText(result.actionLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the link is visible to select manually */
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserPlus className="size-4 text-muted-foreground" />
          Invite a person
        </CardTitle>
        <CardDescription>
          Creates their access and generates a one-time sign-in link to forward.
          No email is sent automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-1 flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Email</span>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="person@company.com"
              className="min-w-56"
              disabled={busy}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Role</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className={SELECT_CLASS}
              disabled={busy}
            >
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
          <Button onClick={invite} disabled={busy || !email.trim()}>
            {busy ? <Loader2 className="animate-spin" /> : <UserPlus />}
            Invite
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{ROLE_HINTS[role]}</p>

        {result && (
          <div className="rounded-lg border bg-muted/40 p-3 text-sm">
            {result.reused ? (
              <p>
                {result.email} already had an account — access updated. No new
                sign-in link is needed.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-emerald-700 dark:text-emerald-400">
                  Invited {result.email}. Forward this one-time sign-in link:
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded border bg-background px-2 py-1.5 text-xs">
                    {result.actionLink}
                  </code>
                  <Button variant="outline" size="sm" onClick={copyLink}>
                    <Copy />
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

export function StaffView() {
  const { me, status } = useAuth();
  const { users, source, loading, error, reload } = useStaff();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const canManage = me != null && MANAGE_ROLES.has(me.role);

  // Signed in but without directory access — be explicit rather than showing
  // demo rows that look like real colleagues.
  if (status === "signed-in" && me != null && !READ_ROLES.has(me.role)) {
    return (
      <>
        <Header source={source} error={error} loading={loading} />
        <EmptyState
          icon={Lock}
          title="Restricted"
          description="The staff directory is available to admins and governance leads. Ask an admin if you need access."
        />
      </>
    );
  }

  async function changeRole(user: StaffUser, role: string) {
    setBusyId(user.id);
    setRowError(null);
    try {
      await apiFetch(`/api/users/${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      reload();
    } catch (err) {
      setRowError(
        err instanceof ApiError ? err.message : `Could not change role: ${err}`,
      );
    } finally {
      setBusyId(null);
    }
  }

  async function remove(user: StaffUser) {
    if (
      !window.confirm(
        `Remove ${user.email}? They lose access to ProofWorks immediately.`,
      )
    ) {
      return;
    }
    setBusyId(user.id);
    setRowError(null);
    try {
      await apiFetch(`/api/users/${encodeURIComponent(user.id)}`, {
        method: "DELETE",
      });
      reload();
    } catch (err) {
      setRowError(
        err instanceof ApiError ? err.message : `Could not remove user: ${err}`,
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <Header source={source} error={error} loading={loading} />

      {source === "live" && canManage && <InviteCard onInvited={reload} />}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {source === "live" ? "Members" : "Members (sample)"}
          </CardTitle>
          <CardDescription>
            People with access to this workspace and the role that governs what
            they can do.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="hidden md:table-cell">Joined</TableHead>
                    {source === "live" && canManage && (
                      <TableHead className="text-right">Actions</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => {
                    const isSelf = me != null && u.id === me.id;
                    const editable =
                      source === "live" && canManage && !isSelf;
                    return (
                      <TableRow key={u.id}>
                        <TableCell className="font-medium">
                          <span className="flex items-center gap-2">
                            {u.email}
                            {isSelf && (
                              <Badge variant="secondary" className="text-[10px]">
                                you
                              </Badge>
                            )}
                          </span>
                        </TableCell>
                        <TableCell>
                          {editable && u.role !== "howldr_support" ? (
                            <select
                              value={u.role}
                              onChange={(e) => changeRole(u, e.target.value)}
                              className={SELECT_CLASS}
                              disabled={busyId === u.id}
                            >
                              {ASSIGNABLE_ROLES.map((r) => (
                                <option key={r} value={r}>
                                  {ROLE_LABELS[r]}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <RoleBadge role={u.role} />
                          )}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-muted-foreground">
                          {isoDay(u.created_at)}
                        </TableCell>
                        {source === "live" && canManage && (
                          <TableCell className="text-right">
                            {!isSelf && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                onClick={() => remove(u)}
                                disabled={busyId === u.id}
                              >
                                {busyId === u.id ? (
                                  <Loader2 className="animate-spin" />
                                ) : (
                                  <Trash2 />
                                )}
                                Remove
                              </Button>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          {rowError && (
            <p className="mt-3 text-sm text-destructive">{rowError}</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function Header({
  source,
  error,
  loading,
}: {
  source: "live" | "demo";
  error: string | null;
  loading: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Staff</h1>
        {!loading && <DataSourceBadge source={source} error={error} />}
      </div>
      <p className="text-sm text-muted-foreground">
        Roles, permissions, and people — who can do what across the workspace.
      </p>
    </div>
  );
}
