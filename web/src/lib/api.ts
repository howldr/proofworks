/**
 * API client for the ProofWorks backend (Express on Railway).
 *
 * Auth model (ADR 0001): the web app will obtain a Supabase JWT via OAuth and
 * attach it as a Bearer token; the backend only verifies. Until the auth flow
 * lands, `getAccessToken()` returns null and protected endpoints respond 401 —
 * callers treat that as the signed-out state, not an error.
 */

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "https://plms-production-9d35.up.railway.app";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

type TokenProvider = () => Promise<string | null>;

let tokenProvider: TokenProvider | null = null;
let tenantSlug: string | null = null;

/** Tenant the signed-in user belongs to (from GET /api/me). When set, API
 *  paths are prefixed /t/{slug}/... so the backend resolves the tenant —
 *  the SPA's own origin never matches a tenant custom domain. */
export function setTenantSlug(slug: string | null) {
  tenantSlug = slug;
}

/** Seam for the Supabase auth layer: register a function that yields the
 *  current session's access token. Until called, requests go out anonymous. */
export function setAccessTokenProvider(provider: TokenProvider) {
  tokenProvider = provider;
}

export async function getAccessToken(): Promise<string | null> {
  if (!tokenProvider) return null;
  try {
    return await tokenProvider();
  } catch {
    return null;
  }
}

/** Fetch a JSON endpoint on the API. Throws ApiError on non-2xx. */
export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const token = await getAccessToken();
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  if (init?.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const prefixed = tenantSlug ? `/t/${tenantSlug}${path}` : path;
  const res = await fetch(`${API_BASE}${prefixed}`, {
    ...init,
    headers,
    cache: "no-store",
  });

  return parseOrThrow<T>(res);
}

async function parseOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) detail = body.error;
    } catch {
      // non-JSON error body — keep the status text
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

/** Fetch a file endpoint with auth and trigger a browser download. */
export async function apiDownload(path: string, filename: string): Promise<void> {
  const token = await getAccessToken();
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const prefixed = tenantSlug ? `/t/${tenantSlug}${path}` : path;
  const res = await fetch(`${API_BASE}${prefixed}`, {
    headers,
    cache: "no-store",
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) detail = body.error;
    } catch {
      // non-JSON error body
    }
    throw new ApiError(res.status, detail);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Upload a raw document body (e.g. POST /api/policies/:id/document). The
 *  original filename travels as a query param; the body is the file bytes. */
export async function apiUpload<T>(path: string, file: File): Promise<T> {
  const token = await getAccessToken();
  const headers = new Headers();
  headers.set("Accept", "application/json");
  headers.set("Content-Type", file.type || "application/octet-stream");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const prefixed = tenantSlug ? `/t/${tenantSlug}${path}` : path;
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(
    `${API_BASE}${prefixed}${sep}filename=${encodeURIComponent(file.name)}`,
    { method: "POST", headers, body: file, cache: "no-store" },
  );

  return parseOrThrow<T>(res);
}
