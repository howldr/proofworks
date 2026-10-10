"use client";

/**
 * "My tasks" hook — the calling user's action queue from GET /api/tasks, with
 * the usual demo fallback while signed out or unreachable.
 */

import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/use-auth";
import { type DataSource, isSignedOut } from "@/lib/use-register";

export type TaskKind =
  | "revise"
  | "approve"
  | "sign-off"
  | "accept"
  | "distribute"
  | "review"
  | "draft";

export type TaskItem = {
  /** Present on policy tasks; risk-acceptance tasks carry risk_id instead. */
  policy_id?: string;
  risk_id?: string;
  title: string;
  status: string;
  version?: string;
  kind: TaskKind;
  reason: string;
};

export type TasksState = {
  tasks: TaskItem[];
  count: number;
  source: DataSource;
  loading: boolean;
  error: string | null;
};

const DEMO_TASKS: TaskItem[] = [
  {
    policy_id: "POL-2025-004",
    title: "Information Security Policy",
    status: "UNDER_REVIEW",
    version: "v1.3",
    kind: "approve",
    reason: "Awaiting your approval",
  },
  {
    policy_id: "POL-2026-002",
    title: "AI & Generative Tools Usage Policy",
    status: "DRAFT",
    version: "v0.4",
    kind: "draft",
    reason: "Draft — submit for approval when ready",
  },
];

export function useTasks(): TasksState {
  const { ready, contextKey } = useAuth();
  const [state, setState] = useState<TasksState>({
    tasks: DEMO_TASKS,
    count: DEMO_TASKS.length,
    source: "demo",
    loading: true,
    error: null,
  });

  useEffect(() => {
    if (!ready) return;
    let active = true;
    apiFetch<{ tasks: TaskItem[]; count: number }>("/api/tasks")
      .then((r) => {
        if (!active) return;
        setState({
          tasks: r.tasks,
          count: r.count,
          source: "live",
          loading: false,
          error: null,
        });
      })
      .catch((err: unknown) => {
        if (!active) return;
        setState({
          tasks: DEMO_TASKS,
          count: DEMO_TASKS.length,
          source: "demo",
          loading: false,
          error: isSignedOut(err)
            ? null
            : err instanceof Error
              ? err.message
              : String(err),
        });
      });
    return () => {
      active = false;
    };
  }, [ready, contextKey]);

  return state;
}
