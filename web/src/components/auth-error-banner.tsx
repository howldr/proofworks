"use client";

import { TriangleAlert } from "lucide-react";

import { useAuth } from "@/lib/use-auth";

/** Shows OAuth callback failures (Supabase reports them only via redirect-URL
 *  params, so without this they fail silently and the user just looks
 *  signed out). */
export function AuthErrorBanner() {
  const { authError } = useAuth();
  if (!authError) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <span>Sign-in failed: {authError}</span>
    </div>
  );
}
