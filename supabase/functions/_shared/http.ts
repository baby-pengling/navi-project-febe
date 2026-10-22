// Request routing and the `{error:{code,message}}` envelope shared by every Edge Function.
// `message` is shown to the user as-is, so it is written in Korean.

import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function empty(status = 204): Response {
  return new Response(null, { status });
}

export interface Context {
  req: Request;
  url: URL;
  /// Path after the function name: `/functions/v1/mail/messages/x` → ["messages", "x"].
  route: string[];
  user: User;
  /// Service-role client; every query must filter by `user.id` itself.
  admin: SupabaseClient;
  body<T>(): Promise<T>;
}

export type Handler = (ctx: Context) => Promise<Response | null>;

export const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

/// Serves `handler` under `/<name>/...`. A handler returning null means "no such route",
/// answered with a plain 404 (no envelope) — the app treats that as "not available yet".
export function serve(name: string, handler: Handler) {
  Deno.serve(async (req) => {
    try {
      const url = new URL(req.url);
      const parts = url.pathname.split("/").filter(Boolean);
      const at = parts.indexOf(name);
      const route = at >= 0 ? parts.slice(at + 1) : parts;
      const user = await authenticate(req);
      const response = await handler({
        req,
        url,
        route,
        user,
        admin,
        body: async <T>() => {
          try {
            return (await req.json()) as T;
          } catch {
            throw new HttpError(400, "INVALID_BODY", "요청 형식이 올바르지 않아요.");
          }
        },
      });
      return response ?? new Response("Not Found", { status: 404 });
    } catch (error) {
      if (error instanceof HttpError) {
        return json({ error: { code: error.code, message: error.message } }, error.status);
      }
      console.error(`${name}:`, error instanceof Error ? error.message : error);
      return json({ error: { code: "INTERNAL", message: "요청을 처리하지 못했어요." } }, 500);
    }
  });
}

async function authenticate(req: Request): Promise<User> {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "UNAUTHENTICATED", "로그인이 필요해요.");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "UNAUTHENTICATED", "로그인이 필요해요.");
  return data.user;
}

/// Matches `route` against a pattern like "messages/:id/star-state"; returns the params or null.
export function match(route: string[], pattern: string): Record<string, string> | null {
  const expected = pattern.split("/").filter(Boolean);
  if (expected.length !== route.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < expected.length; i++) {
    if (expected[i].startsWith(":")) params[expected[i].slice(1)] = decodeURIComponent(route[i]);
    else if (expected[i] !== route[i]) return null;
  }
  return params;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUUID(value: string | undefined, what: string): string {
  if (!value || !uuidPattern.test(value)) {
    throw new HttpError(404, "NOT_FOUND", `${what}을(를) 찾을 수 없어요.`);
  }
  return value.toLowerCase();
}

/// Throws a 500 for a Supabase query error (details go to the log, not the client).
export function check<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
