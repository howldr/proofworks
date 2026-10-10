/**
 * Supabase browser client (ADR 0001: the web app signs users in; the API
 * only verifies the JWT). Built lazily from NEXT_PUBLIC_* env baked in at
 * build time — when those aren't set the client is null and the app runs
 * in signed-out demo mode.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null | undefined;

export function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  client = url && key ? createClient(url, key) : null;
  return client;
}
