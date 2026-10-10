"use client";

import { useMemo, useState } from "react";
import {
  Download,
  FolderLock,
  Loader2,
  Plus,
  Vault,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { DataSourceBadge } from "@/components/data-source-badge";
import { EmptyState } from "@/components/empty-state";
import { EvidenceStrengthBadge } from "@/components/evidence-strength-badge";
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
import { apiDownload, apiFetch, apiUpload } from "@/lib/api";
import { useAuth } from "@/lib/use-auth";
import { useSearchQuery } from "@/lib/use-search";
import {
  EVIDENCE_CATEGORIES,
  type EvidenceItem,
  useEvidence,
} from "@/lib/use-evidence";

const WRITE_ROLES = new Set(["admin", "howldr_support", "governance_lead", "owner"]);
const PACK_ROLES  = new Set(["admin", "howldr_support", "governance_lead", "viewer"]);

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

/** Register a new evidence item; optionally attach the file in the same pass. */
function RegisterCard({ onCreated }: { onCreated: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState(EVIDENCE_CATEGORIES[0]);
  const [controlLabel, setControlLabel] = useState("");
  const [tags, setTags] = useState("");
  const [locator, setLocator] = useState("");
  const [collectedAt, setCollectedAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const item = await apiFetch<EvidenceItem>("/api/evidence", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          category,
          controlLabel: controlLabel.trim() || undefined,
          tags: tags.split(/[,;]+/).map((t) => t.trim()).filter(Boolean),
          locator: locator.trim() || undefined,
          collectedAt: collectedAt || undefined,
          expiresAt: expiresAt || undefined,
        }),
      });
      if (file) {
        await apiUpload(
          `/api/evidence/${encodeURIComponent(item.evidence_id)}/file`,
          file,
        );
      }
      router.push(`/evidence/view?id=${encodeURIComponent(item.evidence_id)}`);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <Plus /> Register evidence
      </Button>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-base">Register evidence</CardTitle>
        <CardDescription>
          Attach the file to hold it here, or leave it where it lives and record
          a locator — you can capture a verifiable fingerprint from the detail
          page without storing the bytes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex max-w-2xl flex-col gap-4">
          <Field label="Title">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Q2 user access review — core systems"
              required
              disabled={busy}
            />
          </Field>
          <Field
            label="Description / method (optional)"
            hint="For query- or database-derived evidence, record the exact extraction method (the query, ordering, and format) — a fingerprint is only re-verifiable with its recipe."
          >
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder={"What this evidences, and how it was produced.\ne.g. SELECT UserId, Role, GrantedAt FROM dbo.UserAccess ORDER BY UserId FOR JSON AUTO — hashed with HASHBYTES('SHA2_256', …)"}
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
                {EVIDENCE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Control label (optional)" hint="Declared mapping, e.g. ISO 27001 A.9.2">
              <Input
                value={controlLabel}
                onChange={(e) => setControlLabel(e.target.value)}
                disabled={busy}
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Collected on">
              <Input
                type="date"
                value={collectedAt}
                onChange={(e) => setCollectedAt(e.target.value)}
                disabled={busy}
              />
            </Field>
            <Field label="Valid until (optional)" hint="When this evidence goes stale.">
              <Input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                disabled={busy}
              />
            </Field>
          </div>
          <Field label="Tags" hint="Comma-separated.">
            <Input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="quarterly, external"
              disabled={busy}
            />
          </Field>
          <Field
            label="Locator (optional)"
            hint="Where the artifact lives if it isn't uploaded here."
          >
            <Input
              value={locator}
              onChange={(e) => setLocator(e.target.value)}
              placeholder="Vendor trust portal → Reports → SOC 2 2026"
              disabled={busy}
            />
          </Field>
          <Field label="File (optional)" hint="Uploading stores and hash-pins it — strength: held.">
            <Input
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={busy}
            />
          </Field>
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

export function EvidenceView() {
  const { me } = useAuth();
  const { items, source, loading, error, notEnabled, reload } = useEvidence();
  const [filter, setFilter] = useSearchQuery();
  const [status, setStatus] = useState<"ACTIVE" | "RETIRED" | "all">("ACTIVE");
  const [packBusy, setPackBusy] = useState(false);
  const [packError, setPackError] = useState<string | null>(null);

  const canWrite = me != null && WRITE_ROLES.has(me.role);
  const canPack  = me != null && PACK_ROLES.has(me.role);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return items
      .filter((i) => (status === "all" ? true : i.status === status))
      .filter((i) =>
        !q ||
        [i.evidence_id, i.title, i.category, i.control_label, i.owner_email]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      );
  }, [items, filter, status]);

  async function downloadPack() {
    setPackBusy(true);
    setPackError(null);
    try {
      const today = new Date().toISOString().slice(0, 10);
      await apiDownload("/api/evidence/pack", `audit-pack-${today}.zip`);
    } catch (err) {
      setPackError(err instanceof Error ? err.message : String(err));
    } finally {
      setPackBusy(false);
    }
  }

  if (notEnabled) {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">Evidence Locker</h1>
        <EmptyState
          icon={FolderLock}
          title="Not enabled for this workspace"
          description="The Evidence Locker module isn't enabled for this workspace. Ask whoever runs your ProofWorks to turn it on."
        />
      </>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Evidence Locker</h1>
            {!loading && <DataSourceBadge source={source} error={error} />}
          </div>
          <p className="text-sm text-muted-foreground">
            Attributed, hash-pinned evidence records — and the pack you hand to
            an auditor.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canPack && (
            <Button variant="outline" onClick={downloadPack} disabled={packBusy || source !== "live"}>
              {packBusy ? <Loader2 className="animate-spin" /> : <Download />}
              Audit pack
            </Button>
          )}
        </div>
      </div>
      {packError && <p className="text-sm text-destructive">{packError}</p>}

      {canWrite && source === "live" && <RegisterCard onCreated={reload} />}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by title, ID, category, owner…"
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
          icon={Vault}
          title="No evidence registered"
          description="Register access reviews, pen-test reports, training completions, vendor attestations — anything an auditor will ask for."
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
                  <TableHead>Proof</TableHead>
                  <TableHead>Valid until</TableHead>
                  <TableHead>Owner</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((i) => (
                  <TableRow key={i.evidence_id}>
                    <TableCell className="font-mono text-xs">
                      <Link
                        href={`/evidence/view?id=${encodeURIComponent(i.evidence_id)}`}
                        className="underline-offset-2 hover:underline"
                      >
                        {i.evidence_id}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-72">
                      <span className={i.status === "RETIRED" ? "text-muted-foreground line-through" : ""}>
                        {i.title}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {i.category ?? "—"}
                    </TableCell>
                    <TableCell>
                      <EvidenceStrengthBadge strength={i.strength} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {isoDay(i.expires_at)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {i.owner_email}
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
          in to a workspace with this module enabled for live evidence.
        </p>
      )}
    </>
  );
}
