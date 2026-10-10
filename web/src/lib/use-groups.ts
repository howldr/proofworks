"use client";

/**
 * Distribution groups (audiences) — named recipient lists used when
 * distributing a policy. Reads are open to any tenant member; create/edit
 * is admin / governance_lead (enforced server-side).
 */

import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/use-auth";

export type DistributionGroup = {
  id: number;
  name: string;
  created_at: string;
  member_count: number;
  /** Roles whose directory members are included when the group is expanded
   *  at send time (in addition to the explicit members). */
  roles?: string[];
  /** Addresses removed from this group's expansion. */
  excluded_emails?: string[];
};

export type GroupMember = {
  email: string;
  manager_email: string | null;
};

export type DistributionGroupDetail = DistributionGroup & {
  members: GroupMember[];
};

export function useGroups(enabled = true) {
  const { ready, contextKey } = useAuth();
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const [groups, setGroups] = useState<DistributionGroup[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !enabled) return;
    let active = true;
    apiFetch<{ groups: DistributionGroup[] }>("/api/groups")
      .then((res) => {
        if (!active) return;
        setGroups(res.groups);
        setError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        // Signed-out / demo mode: just show no groups, not an error.
        setGroups([]);
        setError(null);
        setLoading(false);
        void err;
      });
    return () => {
      active = false;
    };
  }, [ready, contextKey, enabled, tick]);

  return { groups, loading, error, reload };
}

export async function fetchGroup(id: number): Promise<DistributionGroupDetail> {
  const res = await apiFetch<{ group: DistributionGroupDetail }>(
    `/api/groups/${id}`,
  );
  return res.group;
}
