// What the LLM gets to know about the user: profile, todos, calendar/mail caches. Read from
// the caches the mail/calendar functions keep fresh, so a prompt never waits on Google.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { check } from "./http.ts";
import { addDays, dayIn, startOfDay, userTimezone } from "./time.ts";

export interface Snapshot {
  tz: string;
  today: string;
  /// Prompt text: one "## section" per source.
  text: string;
  /// "오늘 일정 3개 · 중요 메일 1개 · 미완료 할 일 3개" (the chat's "참고한 정보").
  sources: string;
}

export async function snapshot(
  admin: SupabaseClient,
  userId: string,
  { days = 1, mail = true, todos = true, from }: { days?: number; mail?: boolean; todos?: boolean; from?: string } = {},
): Promise<Snapshot> {
  const tz = await userTimezone(admin, userId);
  const today = dayIn(tz);
  const first = from ?? today;
  const start = startOfDay(first, tz);
  const end = startOfDay(addDays(first, days), tz);

  const [profile, events, openTodos, mails] = await Promise.all([
    memory(admin, userId),
    eventsBetween(admin, userId, start, end),
    todos ? activeTodos(admin, userId) : Promise.resolve([]),
    mail ? recentMail(admin, userId, tz) : Promise.resolve([]),
  ]);

  const time = (iso: string) =>
    new Intl.DateTimeFormat("ko-KR", {
      timeZone: tz, month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(new Date(iso));

  const sections = [
    `## 사용자\n- 지금: ${time(new Date().toISOString())} (${tz})\n- 역할: ${profile.role ?? "미입력"}\n- 관심사: ${profile.interests.join(", ") || "미입력"}`,
    `## 일정 (${first}부터 ${days}일)\n` + (events.length
      ? events.map((e) => `- [event:${e.id}] ${e.all_day ? "종일" : `${time(e.start_at)}~${time(e.end_at)}`} ${e.title}${e.location ? ` @${e.location}` : ""}`).join("\n")
      : "- 없음"),
  ];
  if (todos) {
    sections.push("## 미완료 할 일\n" + (openTodos.length
      ? openTodos.map((t) => `- [todo:${t.id}] ${t.title} (날짜 ${t.date}${t.due_at ? `, 마감 ${time(t.due_at)}` : ""})`).join("\n")
      : "- 없음"));
  }
  if (mail) {
    sections.push("## 최근 받은 메일 (3일, 중요·안읽음)\n" + (mails.length
      ? mails.map((m) => `- [mail:${m.id}] ${time(m.received_at)} ${m.from} — ${m.subject}: ${m.snippet}`).join("\n")
      : "- 없음"));
  }

  const label = days === 1 && first === today ? "오늘 일정" : "일정";
  const sources = [
    `${label} ${events.length}개`,
    mail ? `중요 메일 ${mails.length}개` : null,
    todos ? `미완료 할 일 ${openTodos.length}개` : null,
  ].filter(Boolean).join(" · ");

  return { tz, today, text: sections.join("\n\n"), sources };
}

async function memory(admin: SupabaseClient, userId: string) {
  const rows = check(
    await admin.from("user_memory").select("key, value").eq("user_id", userId),
  ) as { key: string; value: string }[] | null;
  return {
    role: rows?.find((row) => row.key === "role")?.value ?? null,
    interests: (rows ?? []).filter((row) => row.key === "interest_tag").map((row) => row.value),
  };
}

/// The fields of `mail_messages_cache.payload` prompts use.
interface MailPayload {
  from?: { name: string | null; email: string };
  subject?: string | null;
  snippet?: string | null;
  body_text?: string | null;
  received_at: string;
}

export interface EventLine {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  location: string | null;
}

export async function eventsBetween(admin: SupabaseClient, userId: string, start: Date, end: Date): Promise<EventLine[]> {
  const rows = check(
    await admin.from("calendar_events_cache").select("id, payload")
      .eq("user_id", userId)
      .lt("payload->>start_at", end.toISOString())
      .gt("payload->>end_at", start.toISOString())
      .limit(100),
  ) as { id: string; payload: Omit<EventLine, "id"> }[] | null;
  return (rows ?? [])
    .map((row) => ({ id: row.id, ...row.payload }))
    .sort((a, b) => a.start_at.localeCompare(b.start_at));
}

export async function activeTodos(admin: SupabaseClient, userId: string) {
  return (check(
    await admin.from("todos").select("id, title, date, due_at, category_id")
      .eq("user_id", userId).eq("status", "active").is("parent_id", null)
      .order("date").limit(40),
  ) ?? []) as { id: string; title: string; date: string; due_at: string | null; category_id: string | null }[];
}

async function recentMail(admin: SupabaseClient, userId: string, tz: string) {
  const since = startOfDay(addDays(dayIn(tz), -2), tz).toISOString();
  const rows = check(
    await admin.from("mail_messages_cache").select("id, label_ids, payload")
      .eq("user_id", userId).gte("payload->>received_at", since)
      .order("payload->>received_at", { ascending: false }).limit(40),
  ) as { id: string; label_ids: string[]; payload: MailPayload }[] | null;
  return (rows ?? [])
    .filter((row) => row.label_ids.includes("IMPORTANT") || row.label_ids.includes("UNREAD"))
    .slice(0, 10)
    .map((row) => ({
      id: row.id,
      received_at: row.payload.received_at,
      from: row.payload.from?.name || row.payload.from?.email || "",
      subject: row.payload.subject ?? "(제목 없음)",
      snippet: (row.payload.snippet ?? "").slice(0, 160),
    }));
}

/// Owner-checked `{type, id}` a chat message or command points at, as prompt text.
export async function attachment(
  admin: SupabaseClient,
  userId: string,
  ref: { type: string; id: string },
): Promise<string | null> {
  if (ref.type === "mail_message") {
    const row = check(
      await admin.from("mail_messages_cache").select("payload").eq("user_id", userId).eq("id", ref.id).maybeSingle(),
    ) as { payload: MailPayload } | null;
    if (!row) return null;
    const mail = row.payload;
    return `## 사용자가 보고 있는 메일 [mail:${ref.id}]\n보낸 사람: ${mail.from?.name ?? ""} <${mail.from?.email ?? ""}>\n` +
      `제목: ${mail.subject ?? "(제목 없음)"}\n받은 시각: ${mail.received_at}\n\n${(mail.body_text ?? mail.snippet ?? "").slice(0, 6000)}`;
  }
  if (ref.type === "calendar_event") {
    const row = check(
      await admin.from("calendar_events_cache").select("payload").eq("user_id", userId).eq("id", ref.id).maybeSingle(),
    ) as { payload: Omit<EventLine, "id"> } | null;
    if (!row) return null;
    const e = row.payload;
    return `## 사용자가 보고 있는 일정 [event:${ref.id}]\n${e.title} (${e.all_day ? "종일" : `${e.start_at} ~ ${e.end_at}`})${e.location ? ` @${e.location}` : ""}`;
  }
  if (ref.type === "todo") {
    const row = check(
      await admin.from("todos").select("title, date, due_at, status").eq("user_id", userId).eq("id", ref.id).maybeSingle(),
    ) as { title: string; date: string; due_at: string | null; status: string } | null;
    if (!row) return null;
    return `## 사용자가 보고 있는 할 일 [todo:${ref.id}]\n${row.title} (날짜 ${row.date}, 마감 ${row.due_at ?? "없음"}, ${row.status === "done" ? "완료" : "미완료"})`;
  }
  return null;
}
