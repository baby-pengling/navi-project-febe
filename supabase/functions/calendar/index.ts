// calendar: Google Calendar through `calendar_events_cache`. Events carry the cache's internal
// UUID and the Navi-only category (set with the `set_event_category` RPC).
//   GET   /calendar/events?start=&end=&include_hidden=   (RFC3339; hidden categories excluded)
//   GET   /calendar/briefing/today
//   POST  /calendar/events {title, start_at, end_at, all_day, location, category_id} → {event}
//   PATCH /calendar/events/:id (same fields, all optional) → {event}

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { check, HttpError, json, match, requireUUID, serve } from "../_shared/http.ts";
import { Google, googleFor, mapLimit } from "../_shared/google.ts";
import { addDays, dayIn, startOfDay, userTimezone } from "../_shared/time.ts";

const CALENDAR = "https://www.googleapis.com/calendar/v3";
const MAX_RANGE_DAYS = 100;

/// What the cache keeps per event (`calendar_events_cache.payload`).
interface CachedEvent {
  title: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  location: string | null;
}

interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  start: { date?: string; dateTime?: string };
  end: { date?: string; dateTime?: string };
}

interface CacheRow {
  id: string;
  google_calendar_id: string;
  google_event_id: string;
  category_id: string | null;
  payload: CachedEvent;
}

interface Category {
  id: string;
  name: string;
  color: string;
  is_visible: boolean;
}

serve("calendar", async ({ req, url, route, user, admin, body }) => {
  const method = req.method;
  let params: Record<string, string> | null;

  if (method === "GET" && match(route, "events")) {
    const start = parseInstant(url.searchParams.get("start"), "start");
    const end = parseInstant(url.searchParams.get("end"), "end");
    if (end <= start || end.getTime() - start.getTime() > MAX_RANGE_DAYS * 86_400_000) {
      throw new HttpError(422, "INVALID_RANGE", "조회 기간을 확인해 주세요.");
    }
    const includeHidden = url.searchParams.get("include_hidden") === "true";
    const tz = await userTimezone(admin, user.id);
    return json({ events: await listEvents(admin, user.id, tz, start, end, includeHidden) });
  }

  if (method === "GET" && match(route, "briefing/today")) {
    const tz = await userTimezone(admin, user.id);
    const today = dayIn(tz);
    const events = await listEvents(admin, user.id, tz, startOfDay(today, tz), startOfDay(addDays(today, 1), tz), false);
    return json({ date: today, events });
  }

  if (method === "POST" && match(route, "events")) {
    const input = await body<EventInput>();
    const tz = await userTimezone(admin, user.id);
    const event = googleFields(input, tz, true);
    const categoryId = await ownedCategory(admin, user.id, input.category_id);
    const google = await googleFor(admin, user.id);
    const created = await google.request<GoogleEvent>("POST", `${CALENDAR}/calendars/primary/events`, event);
    const [row] = await cache(admin, user.id, "primary", [created], tz, categoryId);
    return json({ event: await present(admin, user.id, row) }, 201);
  }

  if (method === "PATCH" && (params = match(route, "events/:id"))) {
    const existing = check(
      await admin.from("calendar_events_cache")
        .select("id, google_calendar_id, google_event_id, category_id, payload")
        .eq("user_id", user.id).eq("id", requireUUID(params.id, "일정")).maybeSingle(),
    ) as CacheRow | null;
    if (!existing) throw new HttpError(404, "EVENT_NOT_FOUND", "일정을 찾을 수 없어요.");

    const input = await body<EventInput>();
    const tz = await userTimezone(admin, user.id);
    const patch = googleFields({ ...existing.payload, ...input }, tz, false);
    const categoryId = "category_id" in input ? await ownedCategory(admin, user.id, input.category_id) : undefined;
    const google = await googleFor(admin, user.id);
    const updated = await google.request<GoogleEvent>(
      "PATCH",
      `${CALENDAR}/calendars/${encodeURIComponent(existing.google_calendar_id)}/events/${encodeURIComponent(existing.google_event_id)}`,
      patch,
    );
    const [row] = await cache(admin, user.id, existing.google_calendar_id, [updated], tz, categoryId);
    return json({ event: await present(admin, user.id, row) });
  }

  return null;
});

// MARK: Reading

async function listEvents(
  admin: SupabaseClient,
  userId: string,
  tz: string,
  start: Date,
  end: Date,
  includeHidden: boolean,
) {
  const google = await googleFor(admin, userId);
  const calendars = await visibleCalendars(google);
  const perCalendar = await mapLimit(calendars, 5, async (calendarId) => {
    const query = new URLSearchParams({
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
    });
    const response = await google.get<{ items?: GoogleEvent[] }>(
      `${CALENDAR}/calendars/${encodeURIComponent(calendarId)}/events?${query}`,
    );
    const items = (response.items ?? []).filter((event) => event.status !== "cancelled");
    return cache(admin, userId, calendarId, items, tz);
  });

  const categories = await categoriesById(admin, userId);
  return perCalendar.flat()
    .filter((row) => includeHidden || !row.category_id || categories.get(row.category_id)?.is_visible !== false)
    .sort((a, b) => a.payload.start_at.localeCompare(b.payload.start_at))
    .map((row) => presentWith(row, categories));
}

/// The calendars checked in the user's Google Calendar list (always including primary).
/// Reading the list needs a calendar-list scope the app doesn't request (`calendar.events` only
/// covers events), so without it this falls back to the primary calendar.
async function visibleCalendars(google: Google): Promise<string[]> {
  let response: { items?: { id: string; primary?: boolean; selected?: boolean }[] };
  try {
    response = await google.get(`${CALENDAR}/users/me/calendarList?minAccessRole=reader`);
  } catch (error) {
    if (error instanceof HttpError && error.code === "GOOGLE_SCOPE_MISSING") return ["primary"];
    throw error;
  }
  const ids = (response.items ?? [])
    .filter((calendar) => calendar.primary || calendar.selected)
    .map((calendar) => (calendar.primary ? "primary" : calendar.id));
  return ids.includes("primary") ? ids : ["primary", ...ids];
}

/// Upserts events into the cache and returns their rows. `categoryId` is only written when
/// given, so a refresh never clears a category the user picked.
async function cache(
  admin: SupabaseClient,
  userId: string,
  calendarId: string,
  events: GoogleEvent[],
  tz: string,
  categoryId?: string | null,
): Promise<CacheRow[]> {
  if (events.length === 0) return [];
  const now = new Date().toISOString();
  const rows = check(
    await admin.from("calendar_events_cache").upsert(
      events.map((event) => ({
        user_id: userId,
        google_calendar_id: calendarId,
        google_event_id: event.id,
        payload: normalize(event, tz),
        cached_at: now,
        ...(categoryId === undefined ? {} : { category_id: categoryId }),
      })),
      { onConflict: "user_id,google_calendar_id,google_event_id" },
    ).select("id, google_calendar_id, google_event_id, category_id, payload"),
  ) as CacheRow[];
  const order = new Map(events.map((event, index) => [event.id, index]));
  return rows.sort((a, b) => order.get(a.google_event_id)! - order.get(b.google_event_id)!);
}

function normalize(event: GoogleEvent, tz: string): CachedEvent {
  const allDay = !!event.start.date;
  const instant = (time: { date?: string; dateTime?: string }) =>
    time.dateTime ? new Date(time.dateTime).toISOString() : startOfDay(time.date!, tz).toISOString();
  return {
    title: event.summary?.trim() || "(제목 없음)",
    start_at: instant(event.start),
    end_at: instant(event.end),
    all_day: allDay,
    location: event.location?.trim() || null,
  };
}

async function categoriesById(admin: SupabaseClient, userId: string): Promise<Map<string, Category>> {
  const rows = check(
    await admin.from("calendar_categories").select("id, name, color, is_visible").eq("user_id", userId),
  ) as Category[] | null;
  return new Map((rows ?? []).map((category) => [category.id, category]));
}

async function present(admin: SupabaseClient, userId: string, row: CacheRow) {
  return presentWith(row, await categoriesById(admin, userId));
}

function presentWith(row: CacheRow, categories: Map<string, Category>) {
  const category = row.category_id ? categories.get(row.category_id) : undefined;
  return {
    id: row.id,
    ...row.payload,
    category: category ? { id: category.id, name: category.name, color: category.color } : null,
  };
}

// MARK: Writing

interface EventInput {
  title?: string;
  start_at?: string;
  end_at?: string;
  all_day?: boolean;
  location?: string | null;
  category_id?: string | null;
}

/// Google Calendar fields for a create (all required) or a full patch from merged values.
function googleFields(input: EventInput, tz: string, creating: boolean) {
  const title = input.title?.trim();
  if (!title) throw new HttpError(422, "INVALID_TITLE", "일정 제목을 입력해 주세요.");
  const start = parseInstant(input.start_at ?? null, "start_at");
  const end = parseInstant(input.end_at ?? null, "end_at");
  if (end <= start) throw new HttpError(422, "INVALID_RANGE", "종료 시간은 시작 시간 이후여야 해요.");

  // A patch sends explicit nulls so switching between timed and all-day clears the other field.
  const cleared = creating ? undefined : null;
  const allDay = input.all_day ?? false;
  return {
    summary: title,
    location: input.location?.trim() || cleared,
    ...(allDay
      ? {
        start: { date: dayIn(tz, start), dateTime: cleared },
        // Google's all-day end date is exclusive.
        end: { date: addDays(dayIn(tz, new Date(end.getTime() - 1)), 1), dateTime: cleared },
      }
      : {
        start: { dateTime: start.toISOString(), timeZone: tz, date: cleared },
        end: { dateTime: end.toISOString(), timeZone: tz, date: cleared },
      }),
  };
}

async function ownedCategory(admin: SupabaseClient, userId: string, id: string | null | undefined) {
  if (!id) return null;
  const row = check(
    await admin.from("calendar_categories").select("id")
      .eq("user_id", userId).eq("id", requireUUID(id, "카테고리")).maybeSingle(),
  );
  if (!row) throw new HttpError(404, "CATEGORY_NOT_FOUND", "카테고리를 찾을 수 없어요.");
  return row.id as string;
}

function parseInstant(value: string | null, field: string): Date {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    throw new HttpError(422, "INVALID_DATE", `${field} 값이 올바르지 않아요.`);
  }
  return date;
}
