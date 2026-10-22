// todo-ai: Claude's prep-todo suggestions for a week (일–토). Nothing is stored; the app
// saves the ones the user approves as `todos` rows.
//   POST /todo-ai/todos/suggest {week: "current"|"next", criteria{mail, incomplete_todos,
//        related_todos, user_pattern}} → {suggestions[{title, due_at, reason, effort, category_id, is_urgent}]}

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { check, HttpError, json, match, serve } from "../_shared/http.ts";
import { structured } from "../_shared/llm.ts";
import { snapshot } from "../_shared/context.ts";
import { TODO_SUGGEST_SYSTEM, TODO_SUGGEST_TOOL } from "../_shared/prompts.ts";
import { addDays, dayIn, startOfDay, userTimezone } from "../_shared/time.ts";

interface Criteria {
  mail?: boolean;
  incomplete_todos?: boolean;
  related_todos?: boolean;
  user_pattern?: boolean;
}

interface Suggestion {
  title: string;
  due_at: string;
  reason: string;
  effort: string;
  category_id?: string;
  is_urgent: boolean;
}

serve("todo-ai", async ({ req, route, user, admin, body }) => {
  if (req.method === "POST" && match(route, "todos/suggest")) {
    const input = await body<{ week?: string; criteria?: Criteria }>();
    if (input.week && input.week !== "current" && input.week !== "next") {
      throw new HttpError(422, "INVALID_WEEK", "week는 current 또는 next여야 해요.");
    }
    const criteria = {
      mail: input.criteria?.mail ?? true,
      incomplete_todos: input.criteria?.incomplete_todos ?? true,
      related_todos: input.criteria?.related_todos ?? true,
      user_pattern: input.criteria?.user_pattern ?? true,
    };

    const tz = await userTimezone(admin, user.id);
    const today = dayIn(tz);
    const sunday = addDays(today, -new Date(`${today}T00:00:00Z`).getUTCDay() + (input.week === "next" ? 7 : 0));
    const weekStart = startOfDay(sunday, tz);
    const weekEnd = startOfDay(addDays(sunday, 7), tz);

    const [context, categories, pattern] = await Promise.all([
      snapshot(admin, user.id, {
        days: 7,
        from: sunday,
        mail: criteria.mail,
        todos: criteria.incomplete_todos || criteria.related_todos,
      }),
      todoCategories(admin, user.id),
      criteria.user_pattern ? recentlyDone(admin, user.id) : Promise.resolve([]),
    ]);

    const on = (value: boolean) => (value ? "켜짐" : "꺼짐");
    const sections = [
      `# 대상 주\n${sunday} (일) ~ ${addDays(sunday, 6)} (토)`,
      `# 추천 기준\n- 메일: ${on(criteria.mail)}\n- 미완료 할 일: ${on(criteria.incomplete_todos)}\n` +
      `- 일정과 관련된 할 일: ${on(criteria.related_todos)}\n- 사용자 패턴: ${on(criteria.user_pattern)}`,
      `# 컨텍스트\n${context.text}`,
      `# 할 일 카테고리\n${categories.map((c) => `- ${c.id}: ${c.name}`).join("\n") || "- 없음"}`,
    ];
    if (pattern.length) sections.push(`# 최근 완료한 할 일 (사용자 패턴)\n${pattern.map((t) => `- ${t}`).join("\n")}`);

    const result = await structured<{ suggestions: Suggestion[] }>({
      system: TODO_SUGGEST_SYSTEM,
      messages: [{ role: "user", content: `${sections.join("\n\n")}\n\n위 정보로 준비 할 일을 추천해 줘.` }],
      tool: TODO_SUGGEST_TOOL,
      maxTokens: 2048,
    });

    const categoryIds = new Set(categories.map((c) => c.id));
    const suggestions = (result.suggestions ?? [])
      .filter((s) => s.title?.trim())
      .map((s) => {
        const due = new Date(s.due_at);
        const inWeek = !Number.isNaN(due.getTime()) && due >= weekStart && due < weekEnd;
        return {
          title: s.title.trim(),
          // Out-of-week or unreadable → null; the app falls back to its own default.
          due_at: inWeek ? due.toISOString() : null,
          reason: s.reason?.trim() ?? "",
          effort: s.effort?.trim() ?? "",
          category_id: s.category_id && categoryIds.has(s.category_id) ? s.category_id : null,
          is_urgent: s.is_urgent === true,
        };
      });
    return json({ suggestions });
  }

  return null;
});

async function todoCategories(admin: SupabaseClient, userId: string) {
  return (check(
    await admin.from("todo_categories").select("id, name").eq("user_id", userId).order("name"),
  ) ?? []) as { id: string; name: string }[];
}

async function recentlyDone(admin: SupabaseClient, userId: string) {
  const rows = (check(
    await admin.from("todos").select("title").eq("user_id", userId).eq("status", "done")
      .order("updated_at", { ascending: false }).limit(20),
  ) ?? []) as { title: string }[];
  return rows.map((row) => row.title);
}
