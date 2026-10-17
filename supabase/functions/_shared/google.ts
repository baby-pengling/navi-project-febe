// Google OAuth tokens and API calls. The refresh token lives in Vault
// (`get_google_refresh_token`, service_role only); access tokens are kept in memory per worker.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./http.ts";

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";

const accessTokens = new Map<string, { token: string; expiresAt: number }>();

export interface TokenGrant {
  access_token: string;
  expires_in: number;
  scope?: string;
}

/// Exchanges a refresh token for an access token, or null when Google rejects it.
export async function refreshAccessToken(refreshToken: string): Promise<TokenGrant | null> {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set");
  }
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) {
    console.warn("google token refresh failed:", response.status);
    return null;
  }
  return await response.json();
}

export function forgetAccessToken(userId: string) {
  accessTokens.delete(userId);
}

/// A Google API client for one user. Throws GOOGLE_NOT_CONNECTED / GOOGLE_REAUTH_REQUIRED
/// when there is no usable credential.
export async function googleFor(admin: SupabaseClient, userId: string): Promise<Google> {
  const cached = accessTokens.get(userId);
  if (cached && cached.expiresAt > Date.now() + 60_000) return new Google(cached.token);

  const { data: refreshToken, error } = await admin.rpc("get_google_refresh_token", { target_user: userId });
  if (error) throw new Error(error.message);
  if (!refreshToken) {
    throw new HttpError(409, "GOOGLE_NOT_CONNECTED", "Google 계정이 연결되어 있지 않아요. 설정에서 연결해 주세요.");
  }

  const grant = await refreshAccessToken(refreshToken);
  if (!grant) {
    await admin.from("auth_status").update({
      status: "needs_reauth",
      last_error_at: new Date().toISOString(),
      last_error_code: "GOOGLE_REAUTH_REQUIRED",
    }).eq("user_id", userId);
    throw new HttpError(409, "GOOGLE_REAUTH_REQUIRED", "Google 연결이 만료됐어요. 설정에서 다시 연결해 주세요.");
  }

  accessTokens.set(userId, { token: grant.access_token, expiresAt: Date.now() + grant.expires_in * 1000 });
  return new Google(grant.access_token);
}

export class Google {
  constructor(private readonly accessToken: string) {}

  /// JSON request to a Google API. Maps Google errors to the app's envelope.
  async request<T>(method: string, url: string, body?: unknown): Promise<T> {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    if (!response.ok) {
      console.warn("google api error:", method, new URL(url).pathname, response.status, text.slice(0, 300));
      if (response.status === 401) {
        throw new HttpError(409, "GOOGLE_REAUTH_REQUIRED", "Google 연결이 만료됐어요. 설정에서 다시 연결해 주세요.");
      }
      if (response.status === 403 && text.includes("insufficient")) {
        throw new HttpError(403, "GOOGLE_SCOPE_MISSING", "Google 권한이 부족해요. 설정에서 Google을 다시 연결해 주세요.");
      }
      if (response.status === 404) {
        throw new HttpError(404, "GOOGLE_NOT_FOUND", "Google에서 항목을 찾을 수 없어요.");
      }
      throw new HttpError(502, "GOOGLE_API_ERROR", "Google 서버와 통신하지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }

  get<T>(url: string) {
    return this.request<T>("GET", url);
  }
}

/// Runs `work` over `items` with at most `limit` in flight, keeping order.
export async function mapLimit<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
