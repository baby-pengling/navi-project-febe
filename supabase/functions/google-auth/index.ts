// google-auth: register the Google refresh token after linking, and disconnect.
//   POST   /google-auth/credentials {provider_refresh_token, granted_scopes[]} → 204
//   DELETE /google-auth/disconnect → 202

import { check, empty, HttpError, match, serve } from "../_shared/http.ts";
import { CALENDAR_SCOPE, forgetAccessToken, GMAIL_SCOPE, refreshAccessToken } from "../_shared/google.ts";

serve("google-auth", async ({ req, route, user, admin, body }) => {
  if (req.method === "POST" && match(route, "credentials")) {
    const input = await body<{ provider_refresh_token?: string; granted_scopes?: string[] }>();
    const refreshToken = input.provider_refresh_token?.trim();
    if (!refreshToken) {
      throw new HttpError(422, "GOOGLE_REFRESH_TOKEN_MISSING", "Google 연결 정보를 받지 못했어요. 다시 연결해 주세요.");
    }

    // Google's answer is the source of truth for scopes, not the client's list.
    const grant = await refreshAccessToken(refreshToken);
    if (!grant) {
      throw new HttpError(422, "GOOGLE_CREDENTIAL_INVALID", "Google 연결 정보가 올바르지 않아요. 다시 연결해 주세요.");
    }
    const scopes = (grant.scope ?? "").split(" ");
    const mailConnected = scopes.includes(GMAIL_SCOPE);
    const calendarConnected = scopes.includes(CALENDAR_SCOPE);
    if (!mailConnected && !calendarConnected) {
      throw new HttpError(422, "GOOGLE_SCOPE_MISSING", "Gmail·캘린더 권한을 허용해 주세요.");
    }

    const identity = user.identities?.find((i) => i.provider === "google");
    const googleEmail = identity?.identity_data?.email as string | undefined;
    const googleSubject = (identity?.identity_data?.sub ?? identity?.id) as string | undefined;
    if (!googleEmail || !googleSubject) {
      throw new HttpError(422, "GOOGLE_IDENTITY_MISSING", "Google 계정 정보를 찾지 못했어요. 다시 연결해 주세요.");
    }

    const { error: profileError } = await admin.from("users")
      .update({ google_email: googleEmail, google_subject: googleSubject, last_login_at: new Date().toISOString() })
      .eq("id", user.id);
    if (profileError?.code === "23505") {
      throw new HttpError(409, "GOOGLE_ACCOUNT_IN_USE", "이 Google 계정은 다른 Navi 계정에 연결되어 있어요.");
    }
    if (profileError) throw new Error(profileError.message);

    check(await admin.rpc("store_google_refresh_token", { target_user: user.id, token: refreshToken }));
    forgetAccessToken(user.id);

    check(await admin.from("auth_status").upsert({
      user_id: user.id,
      status: "connected",
      mail_connected: mailConnected,
      calendar_connected: calendarConnected,
      last_refresh_at: new Date().toISOString(),
      last_error_at: null,
      last_error_code: null,
      disconnected_at: null,
    }, { onConflict: "user_id" }));

    return empty(204);
  }

  if (req.method === "DELETE" && match(route, "disconnect")) {
    const { data: refreshToken } = await admin.rpc("get_google_refresh_token", { target_user: user.id });
    if (refreshToken) {
      // Best effort: the token is dropped from Vault even if Google can't be reached.
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: refreshToken }),
      }).catch(() => undefined);
    }
    check(await admin.rpc("delete_google_refresh_token", { target_user: user.id }));
    forgetAccessToken(user.id);

    // Cached mail/calendar data stays as of the last sync.
    check(await admin.from("auth_status").upsert({
      user_id: user.id,
      status: "disconnected",
      mail_connected: false,
      calendar_connected: false,
      disconnected_at: new Date().toISOString(),
    }, { onConflict: "user_id" }));

    return empty(202);
  }

  return null;
});
