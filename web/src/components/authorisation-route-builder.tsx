"use client";

/**
 * Builds an ordered authorisation route: stages run sequentially, members
 * within a stage in parallel, and each stage requires either every member
 * ("all") or a quorum of N. Used by the New and Edit policy forms.
 *
 * The value is a list of stage inputs (members kept as the raw comma-separated
 * text the rest of the form uses). `toAuthorisationRoute` normalises it into the
 * API payload; `parseMembers` is shared so callers can gate submit on emptiness.
 */

import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AuthorisationStage } from "@/lib/use-register";

export type RouteStageInput = { members: string; threshold: "all" | number };

const selectClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** Split the comma/semicolon/space-separated text into unique lowercased emails. */
export function parseMembers(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/[,;\s]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

/** Normalise the builder state into the API `authorisationRoute` payload,
 *  dropping stages with no members. Returns undefined when nothing is set, so
 *  the caller can omit the field entirely (authorisers stay optional). */
export function toAuthorisationRoute(
  stages: RouteStageInput[],
): { threshold: "all" | number; members: string[] }[] | undefined {
  const built = stages
    .map((s) => ({ threshold: s.threshold, members: parseMembers(s.members) }))
    .filter((s) => s.members.length > 0);
  return built.length ? built : undefined;
}

/** Seed the builder from a policy's live route, falling back to a single
 *  all-must-approve stage (optionally pre-filled with a flat email list). */
export function stagesFromRoute(
  route: AuthorisationStage[],
  fallbackEmails: string[] = [],
): RouteStageInput[] {
  if (route.length) {
    return route.map((s) => ({
      members: s.members.map((m) => m.email).join(", "),
      threshold: s.threshold == null ? "all" : s.threshold,
    }));
  }
  return [{ members: fallbackEmails.join(", "), threshold: "all" }];
}

export function AuthorisationRouteBuilder({
  stages,
  onChange,
  disabled,
}: {
  stages: RouteStageInput[];
  onChange: (next: RouteStageInput[]) => void;
  disabled?: boolean;
}) {
  const multi = stages.length > 1;

  function update(index: number, patch: Partial<RouteStageInput>) {
    onChange(stages.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }
  function addStage() {
    onChange([...stages, { members: "", threshold: "all" }]);
  }
  function removeStage(index: number) {
    onChange(stages.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <span className="text-sm font-medium">Approval route</span>
        <p className="text-xs text-muted-foreground">
          Stages are requested in order — the next only opens once the current
          one clears. Within a stage, members are asked in parallel.
        </p>
      </div>

      {stages.map((stage, i) => {
        const count = parseMembers(stage.members).length;
        return (
          <div key={i} className="flex flex-col gap-2 rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                {multi ? `Stage ${i + 1}` : "Approvers"}
              </span>
              {multi && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="-mr-1 h-6 px-1.5 text-muted-foreground"
                  disabled={disabled}
                  onClick={() => removeStage(i)}
                >
                  <X className="size-3.5" /> Remove
                </Button>
              )}
            </div>

            <Input
              value={stage.members}
              onChange={(e) => update(i, { members: e.target.value })}
              placeholder="ciso@yourcompany.com, legal@yourcompany.com"
              disabled={disabled}
            />

            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Requires</span>
              <select
                className={selectClass}
                value={String(stage.threshold)}
                onChange={(e) =>
                  update(i, {
                    threshold:
                      e.target.value === "all"
                        ? "all"
                        : Number(e.target.value),
                  })
                }
                disabled={disabled}
              >
                <option value="all">All must approve</option>
                {Array.from({ length: Math.max(0, count - 1) }, (_, k) => k + 1).map(
                  (n) => (
                    <option key={n} value={n}>
                      Any {n} of {count}
                    </option>
                  ),
                )}
              </select>
            </label>
          </div>
        );
      })}

      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addStage}
          disabled={disabled}
        >
          <Plus /> Add a stage
        </Button>
      </div>
    </div>
  );
}
