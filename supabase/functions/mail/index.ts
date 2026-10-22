// mail: Gmail through `mail_messages_cache`. The app only sees the cache's internal UUIDs.
//   GET   /mail/messages?filter=all|starred|label&label_id=&q=
//   GET   /mail/messages/:id
//   PATCH /mail/messages/:id/star-state {starred} → 204
//   PATCH /mail/messages/:id/read-state {read}    → 204
//   GET   /mail/labels
//   GET   /mail/briefing?date=YYYY-MM-DD   (important/unread mail of that day; no LLM yet)
//   GET   /mail/drafts, POST /mail/drafts, PATCH /mail/drafts/:id, POST /mail/drafts/:id/send
//   GET   /mail/messages/:id/summary   (Claude; cached per message in mail_message_summaries)

import { decodeBase64Url } from "jsr:@std/encoding@1";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { check, empty, HttpError, json, match, requireUUID, serve } from "../_shared/http.ts";
import { Google, googleFor, mapLimit } from "../_shared/google.ts";
import { createDraft, type Draft, type DraftInput, mimeMessage, validDraft } from "../_shared/drafts.ts";
import { addDays, dayIn, isDay, startOfDay, userTimezone } from "../_shared/time.ts";
import { structured } from "../_shared/llm.ts";
import { MAIL_SUMMARY_SYSTEM, SUMMARY_TOOL, SUMMARY_VERSION } from "../_shared/prompts.ts";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const PAGE_SIZE = 30;
const BODY_LIMIT = 20_000;

/// What the cache keeps per message (`mail_messages_cache.payload`).
interface CachedMail {
  thread_id: string;
  from: { name: string | null; email: string };
  to: string[];
  subject: string | null;
  snippet: string | null;
  body_text: string | null;
  received_at: string;
  message_id_header: string | null;
  references: string | null;
}

interface GmailPart {
  mimeType?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string };
  parts?: GmailPart[];
}

interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate: string;
  payload: GmailPart;
}

serve("mail", async ({ req, url, route, user, admin, body }) => {
  const method = req.method;
  let params: Record<string, string> | null;

  if (method === "GET" && match(route, "messages")) {
    const filter = url.searchParams.get("filter") ?? "all";
    const labelId = url.searchParams.get("label_id");
    const q = url.searchParams.get("q")?.trim();
    const labelIds = filter === "starred" ? ["STARRED"] : filter === "label" && labelId ? [labelId] : ["INBOX"];
    const google = await googleFor(admin, user.id);
    const messages = await listMessages(google, admin, user.id, { labelIds, q });
    return json({ messages });
  }

  if (method === "GET" && (params = match(route, "messages/:id"))) {
    const row = await cachedMessage(admin, user.id, params.id);
    return json(present(row));
  }

  if (method === "GET" && (params = match(route, "messages/:id/summary"))) {
    const row = await cachedMessage(admin, user.id, params.id);
    return json(await summarize(admin, user.id, row));
  }

  if (method === "PATCH" && (params = match(route, "messages/:id/star-state"))) {
    const { starred } = await body<{ starred?: boolean }>();
    if (typeof starred !== "boolean") throw new HttpError(422, "INVALID_BODY", "starred 값이 필요해요.");
    await modifyLabels(admin, user.id, params.id, starred ? { add: ["STARRED"] } : { remove: ["STARRED"] });
    return empty(204);
  }

  if (method === "PATCH" && (params = match(route, "messages/:id/read-state"))) {
    const { read } = await body<{ read?: boolean }>();
    if (typeof read !== "boolean") throw new HttpError(422, "INVALID_BODY", "read 값이 필요해요.");
    await modifyLabels(admin, user.id, params.id, read ? { remove: ["UNREAD"] } : { add: ["UNREAD"] });
    return empty(204);
  }

  if (method === "GET" && match(route, "labels")) {
    const google = await googleFor(admin, user.id);
    const response = await google.get<{ labels?: { id: string; name: string; type: string }[] }>(`${GMAIL}/labels`);
    const labels = (response.labels ?? [])
      .filter((label) => label.type === "user")
      .map(({ id, name }) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
    return json({ labels });
  }

  if (method === "GET" && match(route, "briefing")) {
    const tz = await userTimezone(admin, user.id);
    const requested = url.searchParams.get("date");
    const day = isDay(requested) ? requested : dayIn(tz);
    const after = Math.floor(startOfDay(day, tz).getTime() / 1000);
    const before = Math.floor(startOfDay(addDays(day, 1), tz).getTime() / 1000);
    const google = await googleFor(admin, user.id);
    const messages = await listMessages(google, admin, user.id, {
      labelIds: ["INBOX"],
      q: `after:${after} before:${before} (is:important OR is:unread)`,
      max: 10,
    });
    return json({ date: day, categories: messages.length ? [{ name: "중요 메일", messages }] : [] });
  }

  if (method === "GET" && match(route, "drafts")) {
    const rows = check(
      await admin.from("mail_drafts").select("id, draft_payload, updated_at")
        .eq("user_id", user.id).eq("status", "pending").order("updated_at", { ascending: false }).limit(50),
    ) ?? [];
    return json({ drafts: rows.map(presentDraft) });
  }

  if (method === "POST" && match(route, "drafts")) {
    const draft = validDraft(await body<DraftInput>());
    const google = await googleFor(admin, user.id);
    return json(presentDraft(await createDraft(google, admin, user.id, draft)), 201);
  }

  if (method === "PATCH" && (params = match(route, "drafts/:id"))) {
    const existing = await pendingDraft(admin, user.id, params.id);
    const draft = validDraft(await body<DraftInput>());
    const google = await googleFor(admin, user.id);
    const message = await mimeMessage(admin, user.id, draft);
    await google.request("PUT", `${GMAIL}/drafts/${existing.gmail_draft_id}`, { id: existing.gmail_draft_id, message });
    const row = check(
      await admin.from("mail_drafts").update({ draft_payload: draft })
        .eq("user_id", user.id).eq("id", existing.id)
        .select("id, draft_payload, updated_at").single(),
    );
    return json(presentDraft(row!));
  }

  if (method === "POST" && (params = match(route, "drafts/:id/send"))) {
    const existing = await pendingDraft(admin, user.id, params.id);
    const google = await googleFor(admin, user.id);
    try {
      await google.request("POST", `${GMAIL}/drafts/send`, { id: existing.gmail_draft_id });
    } catch (error) {
      await admin.from("mail_drafts").update({
        status: "failed",
        failed_at: new Date().toISOString(),
        error_code: error instanceof HttpError ? error.code : "INTERNAL",
      }).eq("user_id", user.id).eq("id", existing.id);
      throw error;
    }
    check(
      await admin.from("mail_drafts").update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("user_id", user.id).eq("id", existing.id),
    );
    return empty(202);
  }

  return null;
});

// MARK: Messages

async function listMessages(
  google: Google,
  admin: SupabaseClient,
  userId: string,
  options: { labelIds: string[]; q?: string; max?: number },
) {
  const query = new URLSearchParams({ maxResults: String(options.max ?? PAGE_SIZE) });
  options.labelIds.forEach((id) => query.append("labelIds", id));
  if (options.q) query.set("q", options.q);
  const list = await google.get<{ messages?: { id: string }[] }>(`${GMAIL}/messages?${query}`);
  const ids = (list.messages ?? []).map((m) => m.id);
  if (ids.length === 0) return [];

  const messages = await mapLimit(ids, 10, (id) => google.get<GmailMessage>(`${GMAIL}/messages/${id}?format=full`));
  const rows = check(
    await admin.from("mail_messages_cache").upsert(
      messages.map((message) => ({
        user_id: userId,
        gmail_message_id: message.id,
        label_ids: message.labelIds ?? [],
        payload: normalize(message),
        cached_at: new Date().toISOString(),
      })),
      { onConflict: "user_id,gmail_message_id" },
    ).select("id, gmail_message_id, label_ids, payload"),
  ) ?? [];

  const byGmailId = new Map(rows.map((row) => [row.gmail_message_id, row]));
  return ids.flatMap((id) => {
    const row = byGmailId.get(id);
    return row ? [present(row)] : [];
  });
}

interface CacheRow {
  id: string;
  gmail_message_id: string;
  label_ids: string[];
  payload: CachedMail;
}

async function cachedMessage(admin: SupabaseClient, userId: string, id: string): Promise<CacheRow> {
  const row = check(
    await admin.from("mail_messages_cache").select("id, gmail_message_id, label_ids, payload")
      .eq("user_id", userId).eq("id", requireUUID(id, "메일")).maybeSingle(),
  );
  if (!row) throw new HttpError(404, "MAIL_NOT_FOUND", "메일을 찾을 수 없어요.");
  return row as CacheRow;
}

function present(row: CacheRow) {
  const mail = row.payload;
  return {
    id: row.id,
    from: mail.from,
    to: mail.to,
    subject: mail.subject,
    snippet: mail.snippet,
    body_text: mail.body_text,
    received_at: mail.received_at,
    starred: row.label_ids.includes("STARRED"),
    unread: row.label_ids.includes("UNREAD"),
    label_ids: row.label_ids,
  };
}

async function modifyLabels(
  admin: SupabaseClient,
  userId: string,
  id: string,
  change: { add?: string[]; remove?: string[] },
) {
  const row = await cachedMessage(admin, userId, id);
  const google = await googleFor(admin, userId);
  const updated = await google.request<{ labelIds?: string[] }>(
    "POST",
    `${GMAIL}/messages/${row.gmail_message_id}/modify`,
    { addLabelIds: change.add ?? [], removeLabelIds: change.remove ?? [] },
  );
  check(
    await admin.from("mail_messages_cache").update({ label_ids: updated.labelIds ?? [] })
      .eq("user_id", userId).eq("id", row.id),
  );
}

function normalize(message: GmailMessage): CachedMail {
  const header = (name: string) =>
    message.payload.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;
  return {
    thread_id: message.threadId,
    from: parseAddress(header("From") ?? ""),
    to: (header("To") ?? "").split(",").map((a) => parseAddress(a).email).filter(Boolean),
    subject: header("Subject"),
    snippet: message.snippet ? decodeEntities(message.snippet) : null,
    body_text: bodyText(message.payload)?.slice(0, BODY_LIMIT) ?? null,
    received_at: new Date(Number(message.internalDate)).toISOString(),
    message_id_header: header("Message-ID") ?? header("Message-Id"),
    references: header("References"),
  };
}

function parseAddress(value: string): { name: string | null; email: string } {
  const angled = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/);
  if (angled) return { name: angled[1].trim() || null, email: angled[2].trim() };
  return { name: null, email: value.trim() };
}

function bodyText(part: GmailPart): string | null {
  const plain = findPart(part, "text/plain");
  if (plain?.body?.data) return decodeText(plain.body.data).trim();
  const html = findPart(part, "text/html");
  if (html?.body?.data) return htmlToText(decodeText(html.body.data));
  return null;
}

function findPart(part: GmailPart, mimeType: string): GmailPart | null {
  if (part.mimeType === mimeType && part.body?.data) return part;
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType);
    if (found) return found;
  }
  return null;
}

function decodeText(data: string): string {
  return new TextDecoder().decode(decodeBase64Url(data));
}

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  ).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&");
}

// MARK: Summary

interface Summary {
  summary: string[];
  reply_suggestion: string;
  suggested_todos: { title: string; due_at?: string }[];
}

/// Cached per (message, prompt version); a miss waits for Claude and stores the result.
async function summarize(admin: SupabaseClient, userId: string, row: CacheRow) {
  const cached = check(
    await admin.from("mail_message_summaries").select("summary_data, reply_suggestion, suggested_todos")
      .eq("user_id", userId).eq("message_id", row.id).eq("source_version", SUMMARY_VERSION).maybeSingle(),
  );
  if (cached) {
    return { summary: cached.summary_data, reply_suggestion: cached.reply_suggestion, suggested_todos: cached.suggested_todos };
  }

  const tz = await userTimezone(admin, userId);
  const mail = row.payload;
  const now = new Intl.DateTimeFormat("ko-KR", { timeZone: tz, dateStyle: "full", timeStyle: "short" }).format(new Date());
  const result = await structured<Summary>({
    system: `${MAIL_SUMMARY_SYSTEM}\n\n지금: ${now} (${tz})`,
    messages: [{
      role: "user",
      content: `보낸 사람: ${mail.from.name ?? ""} <${mail.from.email}>\n받는 사람: ${mail.to.join(", ")}\n` +
        `받은 시각: ${mail.received_at}\n제목: ${mail.subject ?? "(제목 없음)"}\n\n` +
        `<mail_body>\n${(mail.body_text ?? mail.snippet ?? "").slice(0, 12_000)}\n</mail_body>`,
    }],
    tool: SUMMARY_TOOL,
    maxTokens: 1024,
  });
  const summary = {
    summary: (result.summary ?? []).map((line) => line.trim()).filter(Boolean),
    reply_suggestion: result.reply_suggestion?.trim() || null,
    suggested_todos: (result.suggested_todos ?? [])
      .filter((todo) => todo.title?.trim())
      .map((todo) => ({
        title: todo.title.trim(),
        due_at: todo.due_at && !Number.isNaN(Date.parse(todo.due_at)) ? new Date(todo.due_at).toISOString() : null,
      })),
  };
  check(
    await admin.from("mail_message_summaries").upsert({
      user_id: userId,
      message_id: row.id,
      summary_data: summary.summary,
      reply_suggestion: summary.reply_suggestion,
      suggested_todos: summary.suggested_todos,
      source_version: SUMMARY_VERSION,
      generated_at: new Date().toISOString(),
    }, { onConflict: "user_id,message_id,source_version" }),
  );
  return summary;
}

// MARK: Drafts

async function pendingDraft(admin: SupabaseClient, userId: string, id: string) {
  const row = check(
    await admin.from("mail_drafts").select("id, gmail_draft_id, status")
      .eq("user_id", userId).eq("id", requireUUID(id, "임시 보관 메일")).maybeSingle(),
  );
  if (!row) throw new HttpError(404, "DRAFT_NOT_FOUND", "임시 보관 메일을 찾을 수 없어요.");
  if (row.status !== "pending") throw new HttpError(409, "DRAFT_ALREADY_SENT", "이미 보낸 메일이에요.");
  return row as { id: string; gmail_draft_id: string };
}

function presentDraft(row: { id: string; draft_payload: Draft | null; updated_at: string }) {
  const draft = row.draft_payload;
  return {
    id: row.id,
    to: draft?.to ?? [],
    subject: draft?.subject ?? "",
    body: draft?.body ?? "",
    reply_to_message_id: draft?.reply_to_message_id ?? null,
    updated_at: row.updated_at,
  };
}
