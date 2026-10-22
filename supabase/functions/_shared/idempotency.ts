// `Idempotency-Key` handling through `api_idempotency_keys`: a retried request with the same
// key and body gets the first response back instead of running twice.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { encodeHex } from "jsr:@std/encoding@1";
import { check, HttpError, json } from "./http.ts";

const TTL_HOURS = 24;

export async function idempotent(
  admin: SupabaseClient,
  req: Request,
  userId: string,
  operation: string,
  input: unknown,
  work: () => Promise<{ status: number; body: unknown }>,
): Promise<Response> {
  const key = req.headers.get("Idempotency-Key");
  if (!key) {
    const result = await work();
    return json(result.body, result.status);
  }

  const hash = encodeHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(input))));
  const { error } = await admin.from("api_idempotency_keys").insert({
    user_id: userId,
    operation,
    idempotency_key: key,
    request_hash: hash,
    expires_at: new Date(Date.now() + TTL_HOURS * 3_600_000).toISOString(),
  });
  if (error?.code === "23505") {
    const previous = check(
      await admin.from("api_idempotency_keys").select("request_hash, status, response_status, response_payload")
        .eq("user_id", userId).eq("operation", operation).eq("idempotency_key", key).single(),
    ) as { request_hash: string; status: string; response_status: number; response_payload: unknown };
    if (previous.request_hash !== hash) {
      throw new HttpError(422, "IDEMPOTENCY_KEY_REUSED", "같은 요청 키로 다른 요청을 보냈어요.");
    }
    if (previous.status === "completed") return json(previous.response_payload, previous.response_status);
    throw new HttpError(409, "REQUEST_IN_PROGRESS", "이전 요청을 처리하고 있어요.");
  }
  if (error) throw new Error(error.message);

  try {
    const result = await work();
    await admin.from("api_idempotency_keys")
      .update({ status: "completed", response_status: result.status, response_payload: result.body })
      .eq("user_id", userId).eq("operation", operation).eq("idempotency_key", key);
    return json(result.body, result.status);
  } catch (error) {
    // A failed attempt frees the key so the user can retry.
    await admin.from("api_idempotency_keys").delete()
      .eq("user_id", userId).eq("operation", operation).eq("idempotency_key", key);
    throw error;
  }
}
