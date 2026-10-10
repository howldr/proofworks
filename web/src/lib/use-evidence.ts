"use client";

/**
 * Evidence Locker hooks — items from GET /api/evidence with the usual demo
 * fallback while signed out or unreachable. Mutations are issued from the
 * views via apiFetch/apiUpload.
 */

import { useCallback, useEffect, useState } from "react";

import { ApiError, apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/use-auth";
import { type DataSource, isSignedOut } from "@/lib/use-register";
import type { LinkedRisk } from "@/lib/use-risks";

/** held — file on the share; fingerprinted — SHA-256 only, bytes not stored;
 *  declared — locator/attestation only. Derived server-side. */
export type EvidenceStrength = "held" | "fingerprinted" | "declared";

export type EvidenceItem = {
  evidence_id: string;
  title: string;
  description: string | null;
  category: string | null;
  tags: string[];
  control_label: string | null;
  owner_email: string;
  collected_at: string | null;
  expires_at: string | null;
  locator: string | null;
  file_name: string | null;
  file_size: number | null;
  checksum: string | null;
  status: "ACTIVE" | "RETIRED";
  superseded_by: string | null;
  strength: EvidenceStrength;
  created_by: string;
  created_at: string;
};

export type EvidenceEvent = {
  id: number;
  event: string;
  actor_email: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export const EVIDENCE_CATEGORIES = [
  "Access Control",
  "Security Testing",
  "Training & Awareness",
  "Vendor Assurance",
  "Backup & Recovery",
  "Incident Response",
  "Governance",
  "Other",
];

const DEMO_ITEMS: EvidenceItem[] = [
  {
    evidence_id: "EVD-2026-003",
    title: "Q2 user access review — core systems",
    description: "Quarterly review of joiner/mover/leaver access.",
    category: "Access Control",
    tags: ["quarterly"],
    control_label: "ISO 27001 A.9.2",
    owner_email: "it.director@acme.example",
    collected_at: "2026-06-30",
    expires_at: "2026-09-30",
    locator: null,
    file_name: "q2-access-review.xlsx",
    file_size: 48213,
    checksum: "3f8e…demo",
    status: "ACTIVE",
    superseded_by: null,
    strength: "held",
    created_by: "it.director@acme.example",
    created_at: "2026-07-01T09:00:00Z",
  },
  {
    evidence_id: "EVD-2026-002",
    title: "Vendor SOC 2 Type II — CRM provider",
    description: "Report held in the vendor's trust portal (NDA).",
    category: "Vendor Assurance",
    tags: ["annual", "vendor"],
    control_label: null,
    owner_email: "ciso@acme.example",
    collected_at: "2026-05-12",
    expires_at: "2027-05-12",
    locator: "Vendor trust portal → Reports → SOC 2 2026",
    file_name: "soc2-2026.pdf",
    file_size: null,
    checksum: "a91c…demo",
    status: "ACTIVE",
    superseded_by: null,
    strength: "fingerprinted",
    created_by: "ciso@acme.example",
    created_at: "2026-05-12T14:00:00Z",
  },
  {
    evidence_id: "EVD-2026-001",
    title: "Annual security awareness training completions",
    description: null,
    category: "Training & Awareness",
    tags: ["annual"],
    control_label: null,
    owner_email: "hr.lead@acme.example",
    collected_at: "2026-02-01",
    expires_at: "2027-02-01",
    locator: "LMS → Reports → 2026 completions",
    file_name: null,
    file_size: null,
    checksum: null,
    status: "ACTIVE",
    superseded_by: null,
    strength: "declared",
    created_by: "hr.lead@acme.example",
    created_at: "2026-02-01T10:00:00Z",
  },
];

export type EvidenceListState = {
  items: EvidenceItem[];
  source: DataSource;
  loading: boolean;
  error: string | null;
  /** 403 module_not_enabled — the workspace doesn't have the locker enabled. */
  notEnabled: boolean;
  reload: () => void;
};

export function useEvidence(): EvidenceListState {
  const { ready, contextKey } = useAuth();
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const [state, setState] = useState<Omit<EvidenceListState, "reload">>({
    items: DEMO_ITEMS,
    source: "demo",
    loading: true,
    error: null,
    notEnabled: false,
  });

  useEffect(() => {
    if (!ready) return;
    let active = true;
    apiFetch<EvidenceItem[]>("/api/evidence")
      .then((rows) => {
        if (!active) return;
        setState({ items: rows, source: "live", loading: false, error: null, notEnabled: false });
      })
      .catch((err: unknown) => {
        if (!active) return;
        const notEnabled =
          err instanceof ApiError &&
          err.status === 403 &&
          /module is not enabled/i.test(err.message);
        setState({
          items: DEMO_ITEMS,
          source: "demo",
          loading: false,
          notEnabled,
          error: notEnabled || isSignedOut(err)
            ? null
            : err instanceof Error
              ? err.message
              : String(err),
        });
      });
    return () => {
      active = false;
    };
  }, [ready, contextKey, tick]);

  return { ...state, reload };
}

export type EvidenceDetail = EvidenceItem & {
  events: EvidenceEvent[];
  /** Risks in the register citing this item as supporting evidence. */
  linked_risks?: LinkedRisk[];
};

export type EvidenceDetailState = {
  item: EvidenceDetail | null;
  source: DataSource;
  loading: boolean;
  error: string | null;
  notFound: boolean;
  reload: () => void;
};

export function useEvidenceDetail(id: string | null): EvidenceDetailState {
  const { ready, contextKey } = useAuth();
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const [state, setState] = useState<Omit<EvidenceDetailState, "reload">>({
    item: null,
    source: "demo",
    loading: true,
    error: null,
    notFound: false,
  });

  useEffect(() => {
    if (!id || !ready) return;
    let active = true;
    apiFetch<EvidenceDetail>(
      `/api/evidence/${encodeURIComponent(id)}`,
    )
      .then((item) => {
        if (!active) return;
        setState({ item, source: "live", loading: false, error: null, notFound: false });
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof ApiError && err.status === 404) {
          setState((s) => ({ ...s, loading: false, notFound: true }));
          return;
        }
        const demo = DEMO_ITEMS.find((d) => d.evidence_id === id) ?? null;
        setState({
          item: demo ? { ...demo, events: [] } : null,
          source: "demo",
          loading: false,
          error: isSignedOut(err) ? null : err instanceof Error ? err.message : String(err),
          notFound: !demo,
        });
      });
    return () => {
      active = false;
    };
  }, [id, ready, contextKey, tick]);

  if (!id) {
    return { item: null, source: "demo", loading: false, error: null, notFound: true, reload };
  }
  return { ...state, reload };
}
