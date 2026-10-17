// Claude (Anthropic Messages API). The only module that knows the LLM vendor.
// Secrets: ANTHROPIC_API_KEY (required), ANTHROPIC_MODEL (optional, default below).
// ANTHROPIC_BASE_URL only points local tests at a stub server.

import { HttpError } from "./http.ts";

const API = `${Deno.env.get("ANTHROPIC_BASE_URL") ?? "https://api.anthropic.com"}/v1/messages`;
const VERSION = "2023-06-01";
export const MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-5-5";

export interface Tool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface Message {
  role: "user" | "assistant";
  content: string | Block[];
}

interface Response {
  content: Block[];
  stop_reason: string;
}

async function call(body: Record<string, unknown>): Promise<Response> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new HttpError(503, "LLM_NOT_CONFIGURED", "AI 기능이 아직 설정되지 않았어요.");

  for (let attempt = 0; ; attempt++) {
    const response = await fetch(API, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": VERSION, "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, ...body }),
    });
    if (response.ok) return await response.json() as Response;

    // 429 rate limit / 529 overloaded / 5xx: one short retry, then tell the user to try later.
    const retryable = response.status === 429 || response.status >= 500;
    const detail = await response.text();
    if (retryable && attempt < 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      continue;
    }
    console.error(`anthropic ${response.status}:`, detail.slice(0, 500));
    if (response.status === 401 || response.status === 403) {
      throw new HttpError(503, "LLM_NOT_CONFIGURED", "AI 설정(API 키)을 확인해 주세요.");
    }
    if (retryable) throw new HttpError(503, "LLM_BUSY", "AI 응답이 지연되고 있어요. 잠시 후 다시 시도해 주세요.");
    throw new Error(`anthropic ${response.status}`);
  }
}

/// Asks Claude to call `tool` once and returns its input as `T`. Used wherever the app needs
/// a fixed JSON shape (summaries, suggestions, replies). The model rejects forced `tool_choice`
/// ("tool" / "any"), so a text-only answer gets one reminder to use the tool.
export async function structured<T>(
  { system, messages, tool, maxTokens = 2048 }: { system: string; messages: Message[]; tool: Tool; maxTokens?: number },
): Promise<T> {
  const history = [...messages];
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await call({ system, messages: history, max_tokens: maxTokens, tools: [tool] });
    const use = response.content.find((block) => block.type === "tool_use" && block.name === tool.name);
    if (use?.type === "tool_use") return use.input as T;
    history.push({ role: "assistant", content: response.content }, { role: "user", content: remind(tool) });
  }
  throw new Error(`anthropic: no ${tool.name} call`);
}

/// Agent loop: Claude calls action tools (run through `run`, results go back to Claude) until
/// it calls `finish`, whose input ends the loop. A turn without any tool call gets a reminder;
/// the last turn only offers `finish`.
export async function agent<T>(
  { system, messages, tools, finish, run, maxTurns = 6, maxTokens = 2048 }: {
    system: string;
    messages: Message[];
    tools: Tool[];
    finish: Tool;
    run: (name: string, input: Record<string, unknown>) => Promise<unknown>;
    maxTurns?: number;
    maxTokens?: number;
  },
): Promise<T> {
  const history = [...messages];
  for (let turn = 0; turn < maxTurns; turn++) {
    const last = turn === maxTurns - 1;
    const response = await call({
      system,
      messages: history,
      max_tokens: maxTokens,
      tools: last ? [finish] : [...tools, finish],
    });
    const uses = response.content.filter((block) => block.type === "tool_use");
    const done = uses.find((use) => use.name === finish.name);
    if (done) return done.input as T;

    history.push({ role: "assistant", content: response.content });
    if (uses.length === 0) {
      history.push({ role: "user", content: remind(finish) });
      continue;
    }
    const results: Block[] = [];
    for (const use of uses) {
      try {
        const output = await run(use.name, use.input);
        results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(output ?? { ok: true }) });
      } catch (error) {
        const message = error instanceof HttpError ? error.message : "처리하지 못했어요.";
        if (!(error instanceof HttpError)) console.error(`tool ${use.name}:`, error);
        results.push({ type: "tool_result", tool_use_id: use.id, content: message, is_error: true });
      }
    }
    history.push({ role: "user", content: results });
  }
  throw new Error("anthropic: agent did not finish");
}

function remind(tool: Tool): string {
  return `답변은 텍스트가 아니라 반드시 ${tool.name} 도구를 호출해서 보내 주세요.`;
}
