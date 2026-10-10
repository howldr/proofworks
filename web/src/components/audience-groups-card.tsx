"use client";

import { useState } from "react";
import { Loader2, Pencil, Plus, Save, Trash2, Users, X } from "lucide-react";

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
import {
  type DistributionGroupDetail,
  type GroupMember,
  fetchGroup,
  useGroups,
} from "@/lib/use-groups";
import { ROLE_LABELS } from "@/lib/use-staff";

/** Roles an audience may target — mirrors the API's AUDIENCE_ROLES. Role
 *  membership resolves against the staff directory at send time, so it only
 *  covers people with app accounts. */
const AUDIENCE_ROLES = [
  "admin",
  "owner",
  "authoriser",
  "governance_lead",
  "acceptor",
  "staff",
  "viewer",
] as const;

/**
 * Members are edited as plain text, one recipient per line:
 *   jane@company.com
 *   sam@company.com, manager@company.com   ← optional escalation manager
 */
function parseMembers(text: string): { members: GroupMember[]; bad: string[] } {
  const members: GroupMember[] = [];
  const bad: string[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\n+/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [emailRaw, managerRaw] = trimmed.split(/[,;]/).map((s) => s.trim());
    const email = (emailRaw ?? "").toLowerCase();
    const manager = managerRaw ? managerRaw.toLowerCase() : null;
    if (!email.includes("@") || (manager !== null && !manager.includes("@"))) {
      bad.push(trimmed);
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    members.push({ email, manager_email: manager });
  }
  return { members, bad };
}

function membersToText(members: GroupMember[]): string {
  return members
    .map((m) => (m.manager_email ? `${m.email}, ${m.manager_email}` : m.email))
    .join("\n");
}

/** Named recipient lists ("audiences") reusable at distribution time. */
export function AudienceGroupsCard({ canEdit }: { canEdit: boolean }) {
  const { groups, loading, reload } = useGroups();
  // null = closed; "new" = creating; number = editing that group
  const [editing, setEditing] = useState<"new" | number | null>(null);
  const [name, setName] = useState("");
  const [membersText, setMembersText] = useState("");
  const [roles, setRoles] = useState<string[]>([]);
  const [excludedText, setExcludedText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setEditing(null);
    setName("");
    setMembersText("");
    setRoles([]);
    setExcludedText("");
    setError(null);
  }

  async function openEdit(id: number) {
    setError(null);
    setBusy(true);
    try {
      const g: DistributionGroupDetail = await fetchGroup(id);
      setEditing(id);
      setName(g.name);
      setMembersText(membersToText(g.members));
      setRoles(g.roles ?? []);
      setExcludedText((g.excluded_emails ?? []).join("\n"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Give the audience a name.");
      return;
    }
    const { members, bad } = parseMembers(membersText);
    if (bad.length) {
      setError(`These lines aren't valid emails: ${bad.join(" · ")}`);
      return;
    }
    const excludedEmails: string[] = [];
    for (const raw of excludedText.split(/[\n,;]+/)) {
      const email = raw.trim().toLowerCase();
      if (!email) continue;
      if (!email.includes("@")) {
        setError(`This exclusion isn't a valid email: ${raw.trim()}`);
        return;
      }
      if (!excludedEmails.includes(email)) excludedEmails.push(email);
    }
    setBusy(true);
    try {
      const body = JSON.stringify({ name: trimmedName, members, roles, excludedEmails });
      if (editing === "new") {
        await apiFetch("/api/groups", { method: "POST", body });
      } else {
        await apiFetch(`/api/groups/${editing}`, { method: "PUT", body });
      }
      close();
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number, groupName: string) {
    if (!window.confirm(`Delete audience "${groupName}"? Policies already distributed to it are unaffected.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/groups/${id}`, { method: "DELETE" });
      if (editing === id) close();
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="size-4 text-muted-foreground" />
          Distribution audiences
        </CardTitle>
        <CardDescription>
          Named recipient lists for policy distribution — pick an audience
          instead of pasting emails. The register still records exactly who
          was sent each version.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading audiences…</p>
        ) : groups.length === 0 && editing === null ? (
          <p className="text-sm text-muted-foreground">
            No audiences yet{canEdit ? " — create one below." : "."}
          </p>
        ) : (
          <div className="divide-y">
            {groups.map((g) => (
              <div
                key={g.id}
                className="flex items-center justify-between gap-4 py-2"
              >
                <div className="min-w-0">
                  <span className="text-sm font-medium">{g.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {g.member_count} recipient{g.member_count === 1 ? "" : "s"}
                    {(g.roles?.length ?? 0) > 0 &&
                      ` + roles: ${g.roles!.map((r) => ROLE_LABELS[r] ?? r).join(", ")}`}
                    {(g.excluded_emails?.length ?? 0) > 0 &&
                      ` − ${g.excluded_emails!.length} excluded`}
                  </span>
                </div>
                {canEdit && (
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void openEdit(g.id)}
                      disabled={busy}
                    >
                      <Pencil />
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => void remove(g.id, g.name)}
                      disabled={busy}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {canEdit && editing === null && (
          <div>
            <Button variant="outline" onClick={() => setEditing("new")}>
              <Plus />
              New audience
            </Button>
          </div>
        )}

        {canEdit && editing !== null && (
          <div className="flex flex-col gap-3 rounded-md border p-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Audience name</span>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="All staff"
                disabled={busy}
              />
            </label>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Include roles</span>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {AUDIENCE_ROLES.map((r) => (
                  <label key={r} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={roles.includes(r)}
                      onChange={(e) =>
                        setRoles((prev) =>
                          e.target.checked
                            ? [...prev, r]
                            : prev.filter((x) => x !== r),
                        )
                      }
                      disabled={busy}
                      className="size-4 accent-[var(--brand)]"
                    />
                    {ROLE_LABELS[r] ?? r}
                  </label>
                ))}
              </div>
              <span className="text-xs text-muted-foreground">
                Everyone in the staff directory holding a ticked role is
                included when the policy is sent — membership follows the
                directory, no list to maintain. Covers people with app
                accounts; add anyone else under Recipients.
              </span>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Recipients</span>
              <textarea
                value={membersText}
                onChange={(e) => setMembersText(e.target.value)}
                placeholder={"One per line. Add an escalation manager after a comma:\njane@company.com\nsam@company.com, manager@company.com"}
                rows={5}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                disabled={busy}
              />
              <span className="text-xs text-muted-foreground">
                Optional second email per line is the recipient&apos;s manager,
                used for overdue-acknowledgement escalation.
              </span>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Exclude</span>
              <textarea
                value={excludedText}
                onChange={(e) => setExcludedText(e.target.value)}
                placeholder="Addresses to leave out of this audience — one per line (optional)"
                rows={2}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                disabled={busy}
              />
              <span className="text-xs text-muted-foreground">
                Removed from this audience&apos;s roles and recipients at send
                time — e.g. a role member on long-term leave.
              </span>
            </label>
            <div className="flex items-center gap-2">
              <Button onClick={() => void save()} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Save />}
                {editing === "new" ? "Create audience" : "Save changes"}
              </Button>
              <Button variant="ghost" onClick={close} disabled={busy}>
                <X />
                Cancel
              </Button>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
