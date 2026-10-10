"use client";

/**
 * Auth context: Supabase session + the backend's view of the user (/api/me).
 *
 * Lifecycle: "loading" until the persisted session is restored, then either
 * "signed-out" or "signed-in". On sign-in we fetch /api/me for the role and
 * tenant slug, and point the API client at /t/{slug}/... paths. "disabled"
 * means the Supabase env isn't baked into this build — demo mode only.
 *
 * Data hooks should wait for `ready` and re-fetch when `contextKey` changes.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";

import { apiFetch, setAccessTokenProvider, setTenantSlug } from "@/lib/api";
import { getSupabase } from "@/lib/supabase";
import { applyTenantTheme } from "@/lib/themes";

export type Me = {
  id: string;
  email: string;
  role: string;
  tenant: {
    slug: string;
    name: string;
    theme?: string;
    themeAccent?: string | null;
    /** Small data-URL logo set in Settings > Appearance. */
    logo?: string | null;
  } | null;
  /** Optional modules this workspace has enabled (e.g. "policy_hub"). */
  entitlements?: string[];
};

/** Whether the signed-in user's workspace has a module enabled. */
export function hasModule(me: Me | null, key: string): boolean {
  return me?.entitlements?.includes(key) ?? false;
}

export type AuthStatus = "disabled" | "loading" | "signed-out" | "signed-in";

export type OAuthProvider = "google" | "azure";

type AuthState = {
  status: AuthStatus;
  /** Email from the Supabase session (set as soon as signed in). */
  email: string | null;
  /** Backend identity — role + tenant. Null until /api/me resolves, and
   *  stays null if the user has no app_users row (signed in, no access). */
  me: Me | null;
  /** True once data hooks may fetch: session restored and, when signed in,
   *  /api/me settled (so the tenant prefix is in place). */
  ready: boolean;
  /** Changes whenever the auth/tenant context changes — use in effect deps. */
  contextKey: string;
  /** OAuth callback failure from the redirect URL (e.g. the provider's token
   *  exchange failed) — otherwise these errors vanish silently. */
  authError: string | null;
  signIn: (provider: OAuthProvider) => Promise<void>;
  /** Email a one-time sign-in link. Only works for invited users
   *  (shouldCreateUser is off) — the universal path for external
   *  authorisers without M365/Google accounts. */
  signInWithEmail: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({
  status: "disabled",
  email: null,
  me: null,
  ready: true,
  contextKey: "disabled",
  authError: null,
  signIn: async () => {},
  signInWithEmail: async () => {},
  signOut: async () => {},
});

/** Read error params Supabase appends to the OAuth redirect (query or hash),
 *  and strip them from the address bar so they don't linger. */
function consumeAuthErrorFromUrl(): string | null {
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  const description =
    url.searchParams.get("error_description") ?? hash.get("error_description");
  if (!description) return null;
  const code = url.searchParams.get("error_code") ?? hash.get("error_code");
  for (const k of ["error", "error_code", "error_description"]) {
    url.searchParams.delete(k);
    hash.delete(k);
  }
  url.hash = hash.toString();
  window.history.replaceState(null, "", url.toString());
  return code ? `${description} (${code})` : description;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = getSupabase();
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [meSettled, setMeSettled] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Tenant presentation: swap the --brand token set to the workspace's theme
  // as soon as we know who the user is (and back to default on sign-out).
  useEffect(() => {
    applyTenantTheme(me?.tenant?.theme, me?.tenant?.themeAccent);
  }, [me]);

  useEffect(() => {
    if (!supabase) return;

    setAccessTokenProvider(async () => {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    });

    // Read (and strip) any OAuth failure from the redirect URL now; the state
    // update happens in the session callback below to keep effects pure.
    const callbackError = consumeAuthErrorFromUrl();

    let active = true;
    let lastToken: string | null | undefined;

    // Single entry point for session changes (initial restore + auth events).
    // On a new token, ask the backend who this user is (role + tenant) before
    // marking the auth context settled.
    const apply = (s: Session | null) => {
      if (!active) return;
      setSession(s);
      setSessionLoaded(true);

      const token = s?.access_token ?? null;
      if (token === lastToken) return;
      lastToken = token;

      if (!token) {
        setTenantSlug(null);
        setMe(null);
        setMeSettled(false);
        return;
      }
      setMeSettled(false);
      apiFetch<Me>("/api/me")
        .then((resolved) => {
          if (!active || lastToken !== token) return;
          setTenantSlug(resolved.tenant?.slug ?? null);
          setMe(resolved);
          setMeSettled(true);
        })
        .catch(() => {
          // Signed in with Supabase but unknown to the backend (no app_users
          // row) — keep the session, surface "no access" via me === null.
          if (!active || lastToken !== token) return;
          setTenantSlug(null);
          setMe(null);
          setMeSettled(true);
        });
    };

    supabase.auth.getSession().then(({ data }) => {
      if (active && callbackError) setAuthError(callbackError);
      apply(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) =>
      apply(s),
    );
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  const signIn = useCallback(
    async (provider: OAuthProvider) => {
      if (!supabase) return;
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${window.location.origin}/dashboard` },
      });
      // Navigates away on success — reaching here with an error means the
      // provider isn't enabled or the redirect URL isn't allowed.
      if (error) throw error;
    },
    [supabase],
  );

  const signInWithEmail = useCallback(
    async (emailAddress: string) => {
      if (!supabase) return;
      const { error } = await supabase.auth.signInWithOtp({
        email: emailAddress,
        options: {
          emailRedirectTo: `${window.location.origin}/dashboard`,
          // Invited users only — a random address must not mint an account.
          shouldCreateUser: false,
        },
      });
      if (error) throw error;
    },
    [supabase],
  );

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setTenantSlug(null);
  }, [supabase]);

  const value = useMemo<AuthState>(() => {
    if (!supabase) {
      return {
        status: "disabled",
        email: null,
        me: null,
        ready: true,
        contextKey: "disabled",
        authError: null,
        signIn,
        signInWithEmail,
        signOut,
      };
    }
    const status: AuthStatus = !sessionLoaded
      ? "loading"
      : session
        ? "signed-in"
        : "signed-out";
    const ready =
      sessionLoaded && (status !== "signed-in" || meSettled);
    return {
      status,
      email: session?.user?.email ?? null,
      me,
      ready,
      contextKey: `${status}:${me?.tenant?.slug ?? ""}:${me?.role ?? ""}`,
      authError,
      signIn,
      signInWithEmail,
      signOut,
    };
  }, [supabase, session, sessionLoaded, me, meSettled, authError, signIn, signInWithEmail, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
