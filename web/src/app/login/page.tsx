"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth, type OAuthProvider } from "@/lib/use-auth";

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="#4285F4"
        d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.09 3.57-5.16 3.57-8.81Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.93-2.91l-3.87-3a7.18 7.18 0 0 1-10.71-3.77H1.35v3.1A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.35 14.32a7.21 7.21 0 0 1 0-4.62V6.6H1.35a12.02 12.02 0 0 0 0 10.81l4-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.77 0 3.35.61 4.6 1.8l3.43-3.43A11.97 11.97 0 0 0 1.35 6.6l4 3.1A7.18 7.18 0 0 1 12 4.77Z"
      />
    </svg>
  );
}

function MicrosoftMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path fill="#F25022" d="M1 1h10v10H1z" />
      <path fill="#7FBA00" d="M13 1h10v10H13z" />
      <path fill="#00A4EF" d="M1 13h10v10H1z" />
      <path fill="#FFB900" d="M13 13h10v10H13z" />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const { status, signIn, signInWithEmail, authError } = useAuth();
  const [busy, setBusy] = useState<OAuthProvider | "email" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linkEmail, setLinkEmail] = useState("");
  const [linkSent, setLinkSent] = useState(false);
  const shownError = error ?? authError;

  // Already signed in (or coming back from the OAuth redirect with a
  // session) — straight to the app.
  useEffect(() => {
    if (status === "signed-in") router.replace("/dashboard");
  }, [status, router]);

  const disabled = status === "disabled";

  const start = async (provider: OAuthProvider) => {
    setBusy(provider);
    setError(null);
    try {
      await signIn(provider); // navigates away on success
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <ShieldCheck className="size-6" />
          </div>
          <CardTitle className="mt-2 text-xl">howldr ProofWorks</CardTitle>
          <CardDescription>
            Sign in with your work account to access your workspace.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button
            variant="outline"
            className="w-full justify-center gap-2"
            disabled={disabled || busy !== null}
            onClick={() => start("google")}
          >
            <GoogleMark />
            {busy === "google" ? "Redirecting…" : "Continue with Google"}
          </Button>
          <Button
            variant="outline"
            className="w-full justify-center gap-2"
            disabled={disabled || busy !== null}
            onClick={() => start("azure")}
          >
            <MicrosoftMark />
            {busy === "azure" ? "Redirecting…" : "Continue with Microsoft"}
          </Button>
          <div className="flex items-center gap-3 py-1">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">or</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          {linkSent ? (
            <p className="text-center text-sm text-muted-foreground">
              Check your inbox — we&apos;ve emailed a one-time sign-in link to{" "}
              <span className="font-medium text-foreground">{linkEmail}</span>.
            </p>
          ) : (
            <form
              className="flex flex-col gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy("email");
                setError(null);
                try {
                  await signInWithEmail(linkEmail.trim());
                  setLinkSent(true);
                } catch (err) {
                  const m = err instanceof Error ? err.message : String(err);
                  setError(
                    /signups not allowed|not found/i.test(m)
                      ? "That email hasn't been invited yet — ask your admin for an invite."
                      : m,
                  );
                } finally {
                  setBusy(null);
                }
              }}
            >
              <Input
                type="email"
                value={linkEmail}
                onChange={(e) => setLinkEmail(e.target.value)}
                placeholder="you@yourcompany.com"
                disabled={disabled || busy !== null}
                required
              />
              <Button
                type="submit"
                variant="outline"
                className="w-full"
                disabled={disabled || busy !== null || !linkEmail.trim()}
              >
                {busy === "email" ? "Sending…" : "Email me a sign-in link"}
              </Button>
            </form>
          )}

          {shownError && (
            <p className="text-center text-xs text-destructive">
              {shownError}
            </p>
          )}
          {disabled && (
            <p className="text-center text-xs text-muted-foreground">
              Sign-in isn&apos;t configured in this build — the app runs on
              demo data. Set NEXT_PUBLIC_SUPABASE_URL and
              NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and rebuild.
            </p>
          )}
          <Button
            variant="ghost"
            className="w-full text-muted-foreground"
            onClick={() => router.push("/dashboard")}
          >
            Continue without signing in (demo)
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
