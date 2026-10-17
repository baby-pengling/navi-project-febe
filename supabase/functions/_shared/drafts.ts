// Gmail drafts shared by `mail` (the user's own drafts) and `assistant` (drafts Claude writes).
// Nothing here sends mail: sending is always the user's explicit POST /mail/drafts/:id/send.

import { encodeBase64, encodeBase64Url } from "jsr:@std/encoding@1";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { check, HttpError, requireUUID } from "./http.ts";
import type { Google } from "./google.ts";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface DraftInput {
  to?: string[];
  subject?: string;
  body?: string;
  reply_to_message_id?: string | null;
}

export interface Draft {
  to: string[];
  subject: string;
  body: string;
  reply_to_message_id: string | null;
}

export function validDraft(input: DraftInput): Draft {
  const to = (input.to ?? []).map((a) => a.trim()).filter(Boolean);
  if (to.some((address) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))) {
    throw new HttpError(422, "INVALID_RECIPIENT", "받는 사람 이메일 주소를 확인해 주세요.");
  }
  return {
    to,
    subject: input.subject ?? "",
    body: input.body ?? "",
    reply_to_message_id: input.reply_to_message_id ? requireUUID(input.reply_to_message_id, "원본 메일") : null,
  };
}

/// Gmail `message` for drafts.create/update: RFC 822 text, threaded when replying.
export async function mimeMessage(admin: SupabaseClient, userId: string, draft: Draft) {
  const headers = [
    `To: ${draft.to.join(", ")}`,
    `Subject: =?UTF-8?B?${encodeBase64(new TextEncoder().encode(draft.subject))}?=`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ];
  let threadId: string | undefined;
  if (draft.reply_to_message_id) {
    const original = check(
      await admin.from("mail_messages_cache").select("payload")
        .eq("user_id", userId).eq("id", draft.reply_to_message_id).maybeSingle(),
    ) as { payload: { thread_id: string; message_id_header: string | null; references: string | null } } | null;
    if (!original) throw new HttpError(404, "MAIL_NOT_FOUND", "메일을 찾을 수 없어요.");
    threadId = original.payload.thread_id;
    const messageId = original.payload.message_id_header;
    if (messageId) {
      headers.push(`In-Reply-To: ${messageId}`);
      headers.push(`References: ${[original.payload.references, messageId].filter(Boolean).join(" ")}`);
    }
  }
  const body = encodeBase64(new TextEncoder().encode(draft.body)).replace(/.{76}/g, "$&\r\n");
  const raw = encodeBase64Url(new TextEncoder().encode(`${headers.join("\r\n")}\r\n\r\n${body}`));
  return threadId ? { raw, threadId } : { raw };
}

/// Creates the Gmail draft and its pending `mail_drafts` row.
export async function createDraft(
  google: Google,
  admin: SupabaseClient,
  userId: string,
  draft: Draft,
  originalCommand: string | null = null,
) {
  const message = await mimeMessage(admin, userId, draft);
  const created = await google.request<{ id: string }>("POST", `${GMAIL}/drafts`, { message });
  return check(
    await admin.from("mail_drafts").insert({
      user_id: userId,
      gmail_draft_id: created.id,
      draft_payload: draft,
      original_command: originalCommand,
    }).select("id, draft_payload, updated_at").single(),
  ) as { id: string; draft_payload: Draft; updated_at: string };
}
