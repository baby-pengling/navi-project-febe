// Calendar-day math in the user's timezone (`users.timezone`, default Asia/Seoul).

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export async function userTimezone(admin: SupabaseClient, userId: string): Promise<string> {
  const { data } = await admin.from("users").select("timezone").eq("id", userId).maybeSingle();
  return data?.timezone ?? "Asia/Seoul";
}

/// "YYYY-MM-DD" for `at` in `tz`.
export function dayIn(tz: string, at = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(at);
}

export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function isDay(value: string | null): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

/// Midnight of `day` in `tz`.
export function startOfDay(day: string, tz: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d);
  let instant = wall - offsetMinutes(new Date(wall), tz) * 60_000;
  // Second pass lands on the right side of a DST change.
  instant = wall - offsetMinutes(new Date(instant), tz) * 60_000;
  return new Date(instant);
}

function offsetMinutes(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return Math.round((wall - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
}
