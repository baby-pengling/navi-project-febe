// assistant: navi chat and prompt commands, answered by Claude in the background.
//   POST /assistant/conversations/:id/messages {content, context?{type,id}}
//        → 202 {user_message, assistant_message: null, command_id, status, approval_required}
//        The reply arrives as an `assistant_messages` insert (Realtime).
//   POST /assistant/command {text, context?} → 202 {command_id, status}
//        The result lands on `assistant_commands` (status, result_text, tool_calls; Realtime).
// Writes Claude makes: todos directly; mail only as a Gmail draft; calendar only as a pending
// `calendar_commands` row. Nothing reaches Google Mail/Calendar before the user approves.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { check, HttpError, match, requireUUID, serve } from "../_shared/http.ts";
import { idempotent } from "../_shared/idempotency.ts";
import { agent, type Message } from "../_shared/llm.ts";
import { attachment, snapshot } from "../_shared/context.ts";
import { ACTION_TOOLS, ASSISTANT_SYSTEM, REPLY_TOOL, TITLE_INSTRUCTION } from "../_shared/prompts.ts";
import { googleFor } from "../_shared/google.ts";
import { createDraft, validDraft } from "../_shared/drafts.ts";
import { dayIn, isDay } from "../_shared/time.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

const MAX_CONTENT = 4000;
const HISTORY = 20;
const CONTEXT_TYPES = ["mail_message", "calendar_event", "todo"];

interface Ref {
  type: string;
  id: string;
}

interface Reply {
  lead: string;
  items: string[];
  suggested_todos: string[];
  title?: string;
}

/// Union of the ACTION_TOOLS inputs, as Claude sent them (unvalidated).
interface ToolInput {
  title?: string;
  date?: string;
  due_at?: string;
  to?: string[];
  subject?: string;
  body?: string;
  reply_to_message_id?: string;
  action?: string;
  event_id?: string;
  start_at?: string;
  end_at?: string;
  all_day?: boolean;
  location?: string;
}

interface Action {
  tool: string;
  parameters: ToolInput | Record<string, unknown>;
  result_ref: { type: string; id: string } | null;
  approval_required: boolean;
}

serve("assistant", async ({ req, route, user, admin, body }) => {
  let params: Record<string, string> | null;

  if (req.method === "POST" && (params = match(route, "conversations/:id/messages"))) {
    const conversationId = requireUUID(params.id, "대화");
    const input = await body<{ content?: string; context?: Partial<Ref> | null }>();
    return idempotent(admin, req, user.id, "assistant.message.create", { conversationId, input }, async () => {
      const content = validContent(input.content);
      const conversation = check(
        await admin.from("assistant_conversations").select("id, title")
          .eq("user_id", user.id).eq("id", conversationId).maybeSingle(),
      ) as { id: string; title: string | null } | null;
      if (!conversation) throw new HttpError(404, "CONVERSATION_NOT_FOUND", "대화를 찾을 수 없어요.");
      const ref = await ownedRef(admin, user.id, input.context);

      const command = check(
        await admin.from("assistant_commands").insert({
          user_id: user.id, raw_input: content, status: "running", conversation_id: conversationId,
        }).select("id").single(),
      ) as { id: string };
      const message = check(
        await admin.from("assistant_messages").insert({
          conversation_id: conversationId, user_id: user.id, role: "user", content, context: ref, command_id: command.id,
        }).select("id, conversation_id, role, content, context, created_at").single(),
      ) as { created_at: string };
      check(
        await admin.from("assistant_conversations").update({ last_message_at: message.created_at })
          .eq("user_id", user.id).eq("id", conversationId),
      );

      background(respond(admin, user.id, command.id, content, ref, conversation));
      return {
        status: 202,
        body: { user_message: message, assistant_message: null, command_id: command.id, status: "running", approval_required: false },
      };
    });
  }

  if (req.method === "POST" && match(route, "command")) {
    const input = await body<{ text?: string; context?: Partial<Ref> | null }>();
    return idempotent(admin, req, user.id, "assistant.command.create", input, async () => {
      const text = validContent(input.text);
      const ref = await ownedRef(admin, user.id, input.context);
      const command = check(
        await admin.from("assistant_commands").insert({ user_id: user.id, raw_input: text, status: "running" })
          .select("id").single(),
      ) as { id: string };
      background(respond(admin, user.id, command.id, text, ref, null));
      return { status: 202, body: { command_id: command.id, status: "running" } };
    });
  }

  return null;
});

/// Keeps the worker alive after the 202 so Claude can finish.
function background(task: Promise<unknown>) {
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(task);
}

function validContent(value: string | undefined): string {
  const content = value?.trim() ?? "";
  if (!content) throw new HttpError(422, "INVALID_CONTENT", "메시지를 입력해 주세요.");
  if (content.length > MAX_CONTENT) throw new HttpError(422, "INVALID_CONTENT", "메시지가 너무 길어요.");
  return content;
}

/// Only the three attachable types, and only rows the caller owns.
async function ownedRef(admin: SupabaseClient, userId: string, ref: Partial<Ref> | null | undefined): Promise<Ref | null> {
  if (!ref) return null;
  if (!ref.type || !CONTEXT_TYPES.includes(ref.type)) {
    throw new HttpError(422, "INVALID_CONTEXT", "첨부한 항목 종류를 확인해 주세요.");
  }
  const table = { mail_message: "mail_messages_cache", calendar_event: "calendar_events_cache", todo: "todos" }[ref.type]!;
  const id = requireUUID(ref.id, "첨부한 항목");
  const row = check(await admin.from(table).select("id").eq("user_id", userId).eq("id", id).maybeSingle());
  if (!row) throw new HttpError(404, "CONTEXT_NOT_FOUND", "첨부한 항목을 찾을 수 없어요.");
  return { type: ref.type, id };
}

// MARK: Background

async function respond(
  admin: SupabaseClient,
  userId: string,
  commandId: string,
  text: string,
  ref: Ref | null,
  conversation: { id: string; title: string | null } | null,
) {
  const actions: Action[] = [];
  try {
    const context = await snapshot(admin, userId);
    const attached = ref ? await attachment(admin, userId, ref) : null;
    const first = conversation !== null && conversation.title === null;
    const system = [
      ASSISTANT_SYSTEM,
      first ? TITLE_INSTRUCTION : null,
      `# 컨텍스트\n${context.text}${attached ? `\n\n${attached}` : ""}`,
    ].filter(Boolean).join("\n\n");

    const messages = conversation ? await history(admin, userId, conversation.id) : [{ role: "user" as const, content: text }];
    const reply = await agent<Reply>({
      system,
      messages,
      tools: ACTION_TOOLS,
      finish: REPLY_TOOL,
      run: (name, input) => act(admin, userId, context.tz, text, name, input as ToolInput, actions),
    });

    const content = [reply.lead.trim(), ...(reply.items ?? []).map((item, i) => `${i + 1}. ${item.trim()}`)]
      .filter(Boolean).join("\n") || "답변을 만들지 못했어요.";
    const approval = actions.some((action) => action.approval_required);
    if (conversation) {
      await finishConversation(admin, userId, conversation, commandId, content, {
        suggested_todos: reply.suggested_todos ?? [],
        sources: context.sources,
      }, first ? reply.title?.trim() || fallbackTitle(text) : null);
    }
    check(
      await admin.from("assistant_commands").update({
        status: approval ? "awaiting_approval" : "completed",
        result_text: content,
        tool_calls: actions,
      }).eq("user_id", userId).eq("id", commandId),
    );
  } catch (error) {
    console.error("assistant:", error);
    const code = error instanceof HttpError ? error.code : "INTERNAL";
    await admin.from("assistant_commands").update({ status: "failed", error_code: code, tool_calls: actions })
      .eq("user_id", userId).eq("id", commandId);
    if (conversation) {
      // A reply row still arrives so the chat stops waiting.
      const message = error instanceof HttpError && error.status === 503
        ? error.message
        : "죄송해요, 지금은 답변을 만들지 못했어요. 잠시 후 다시 시도해 주세요.";
      await finishConversation(admin, userId, conversation, commandId, message, null,
        conversation.title === null ? fallbackTitle(text) : null).catch((e) => console.error("assistant:", e));
    }
  }
}

/// Last messages of the conversation (ending with the new user message) as Claude turns.
async function history(admin: SupabaseClient, userId: string, conversationId: string): Promise<Message[]> {
  const rows = (check(
    await admin.from("assistant_messages").select("role, content")
      .eq("user_id", userId).eq("conversation_id", conversationId)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(HISTORY),
  ) ?? []) as { role: "user" | "assistant"; content: string }[];
  const turns: Message[] = [];
  for (const row of rows.reverse()) {
    const previous = turns.at(-1);
    // Claude needs alternating turns starting with the user.
    if (previous?.role === row.role) previous.content += `\n\n${row.content}`;
    else if (turns.length > 0 || row.role === "user") turns.push({ role: row.role, content: row.content });
  }
  return turns;
}

async function finishConversation(
  admin: SupabaseClient,
  userId: string,
  conversation: { id: string },
  commandId: string,
  content: string,
  context: Record<string, unknown> | null,
  title: string | null,
) {
  const message = check(
    await admin.from("assistant_messages").insert({
      conversation_id: conversation.id, user_id: userId, role: "assistant", content, context, command_id: commandId,
    }).select("created_at").single(),
  ) as { created_at: string };
  check(
    await admin.from("assistant_conversations")
      .update({ last_message_at: message.created_at, ...(title ? { title: title.slice(0, 60) } : {}) })
      .eq("user_id", userId).eq("id", conversation.id),
  );
}

function fallbackTitle(text: string): string {
  const line = text.split("\n")[0].trim();
  return line.length > 20 ? `${line.slice(0, 20)}…` : line;
}

// MARK: Tools

async function act(
  admin: SupabaseClient,
  userId: string,
  tz: string,
  command: string,
  name: string,
  input: ToolInput,
  actions: Action[],
): Promise<unknown> {
  if (name === "create_todo") {
    const title = String(input.title ?? "").trim().slice(0, 100);
    if (!title) throw new HttpError(422, "INVALID_TITLE", "할 일 제목이 비어 있어요.");
    const date = isDay(input.date ?? null) ? input.date : dayIn(tz, input.due_at ? new Date(input.due_at) : new Date());
    const dueAt = input.due_at && !Number.isNaN(Date.parse(input.due_at)) ? new Date(input.due_at).toISOString() : null;
    const row = check(
      await admin.from("todos").insert({ user_id: userId, title, date, due_at: dueAt, source: "manual", order_index: Date.now() })
        .select("id").single(),
    ) as { id: string };
    actions.push({ tool: name, parameters: input, result_ref: { type: "todo", id: row.id }, approval_required: false });
    return { todo_id: row.id, saved: true };
  }

  if (name === "create_mail_draft") {
    const draft = validDraft({
      to: Array.isArray(input.to) ? input.to : [],
      subject: input.subject,
      body: input.body,
      reply_to_message_id: input.reply_to_message_id ?? null,
    });
    if (draft.to.length === 0) throw new HttpError(422, "INVALID_RECIPIENT", "받는 사람이 필요해요.");
    const google = await googleFor(admin, userId);
    const row = await createDraft(google, admin, userId, draft, command);
    actions.push({ tool: name, parameters: input, result_ref: { type: "mail_draft", id: row.id }, approval_required: true });
    return { draft_id: row.id, sent: false, note: "임시 보관함에 저장됨. 사용자가 확인 후 직접 보냄" };
  }

  if (name === "propose_calendar_event") {
    const start = new Date(input.start_at ?? "");
    const end = new Date(input.end_at ?? "");
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      throw new HttpError(422, "INVALID_RANGE", "일정 시작·종료 시간을 확인해 주세요.");
    }
    const action = input.action === "update" ? "update" : "create";
    if (action === "update") {
      const eventId = requireUUID(input.event_id, "일정");
      const owned = check(
        await admin.from("calendar_events_cache").select("id").eq("user_id", userId).eq("id", eventId).maybeSingle(),
      );
      if (!owned) throw new HttpError(404, "EVENT_NOT_FOUND", "일정을 찾을 수 없어요.");
    }
    const parsed = {
      action,
      event_id: action === "update" ? input.event_id : null,
      title: String(input.title ?? "").trim(),
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      all_day: input.all_day === true,
      location: input.location?.trim() || null,
    };
    const row = check(
      await admin.from("calendar_commands").insert({
        user_id: userId, original_command: command, source: "natural_language", parsed_action: parsed, status: "pending",
      }).select("id").single(),
    ) as { id: string };
    await admin.from("assistant_alerts").insert({
      user_id: userId,
      source: "calendar_approval",
      title: action === "create" ? "일정 추가 승인 필요" : "일정 변경 승인 필요",
      body: parsed.title,
      target_type: "calendar_command",
      target_id: row.id,
      dedupe_key: `calendar_command:${row.id}`,
    });
    actions.push({ tool: name, parameters: parsed, result_ref: { type: "calendar_command", id: row.id }, approval_required: true });
    return { calendar_command_id: row.id, status: "pending_approval" };
  }

  throw new HttpError(422, "UNKNOWN_TOOL", "지원하지 않는 작업이에요.");
}
