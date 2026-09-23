// ─── HTTP plumbing for B2B edge functions ────────────────────────────────────
// Unlike some B2C functions, errors return real HTTP status codes so the client's
// `res.ok` check is meaningful.
import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

/** Resolve the caller from their JWT, or throw 401. */
export async function requireUser(req: Request): Promise<User> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) throw new HttpError(401, "UNAUTHENTICATED", "Please sign in.");
  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new HttpError(401, "UNAUTHENTICATED", "Please sign in again.");
  return data.user;
}

/** Wrap a handler: CORS preflight, JSON body parsing, uniform error responses. */
export function handle(
  name: string,
  fn: (req: Request, body: Record<string, unknown>) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    if (req.method !== "POST") return json({ error: "Method not allowed", code: "METHOD" }, 405);
    let body: Record<string, unknown>;
    try {
      body = await req.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    } catch {
      return json({ error: "Invalid JSON body", code: "BAD_REQUEST" }, 400);
    }
    try {
      return await fn(req, body);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, code: e.code }, e.status);
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[${name}] unhandled:`, msg, e instanceof Error ? e.stack : "");
      if (/FORBIDDEN|insufficient_privilege/.test(msg)) return json({ error: "Not allowed", code: "FORBIDDEN" }, 403);
      return json({ error: "Something went wrong. Please try again.", code: "INTERNAL" }, 500);
    }
  };
}

export function str(v: unknown, field: string, max = 500): string {
  if (typeof v !== "string" || !v.trim()) throw new HttpError(400, "BAD_REQUEST", `${field} is required`);
  if (v.length > max) throw new HttpError(400, "BAD_REQUEST", `${field} is too long`);
  return v.trim();
}

export function uuid(v: unknown, field: string): string {
  const s = str(v, field, 64);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
    throw new HttpError(400, "BAD_REQUEST", `${field} must be a UUID`);
  }
  return s;
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 256-bit URL-safe random token. */
export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function appBaseUrl(): string {
  return (Deno.env.get("APP_BASE_URL") || "https://hiresume.in").replace(/\/+$/, "");
}
