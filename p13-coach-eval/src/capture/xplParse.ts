export interface ToolUse {
  id: string;
  name: string;
  input: unknown;
}

export interface XplUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
}

export interface XplCall {
  kind: "coach" | "aux";
  model: string;
  status: number;
  latencyMs: number;
  usage: XplUsage;
  toolUses: ToolUse[];
  stopReason?: string;
  error?: string;
}

interface RequestMessage {
  role?: string;
  content?: unknown;
}

export interface XplRequest {
  model?: string;
  stream?: boolean;
  tools?: { name?: string }[];
  messages?: RequestMessage[];
}

interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cost?: number;
}

interface RawBlock {
  type?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  text?: string;
}

interface SseEvent {
  type?: string;
  index?: number;
  message?: { usage?: RawUsage };
  usage?: RawUsage;
  content_block?: RawBlock;
  delta?: { type?: string; partial_json?: string; stop_reason?: string };
  error?: { message?: string };
}

interface JsonMessage {
  content?: RawBlock[];
  usage?: RawUsage;
  stop_reason?: string;
  error?: { message?: string };
}

const TOOL_RESULT_MAX_CHARS = 600;

export function emptyUsage(): XplUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 };
}

export function parseRequest(body: unknown): XplRequest {
  if (typeof body !== "string") return {};
  try {
    return JSON.parse(body) as XplRequest;
  } catch {
    return {};
  }
}

export function callKind(request: XplRequest, coachTools: ReadonlySet<string>): XplCall["kind"] {
  return request.tools?.some((tool) => tool.name && coachTools.has(tool.name)) ? "coach" : "aux";
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return JSON.stringify(content ?? "");
  return content.map((part: RawBlock) => part.text ?? JSON.stringify(part)).join("\n");
}

export function toolResultsOf(request: XplRequest): [string, string][] {
  return (request.messages ?? []).flatMap((message) =>
    Array.isArray(message.content)
      ? (message.content as RawBlock[])
          .filter((block) => block.type === "tool_result" && block.tool_use_id)
          .map((block): [string, string] => [block.tool_use_id as string, textOf(block.content).slice(0, TOOL_RESULT_MAX_CHARS)])
      : [],
  );
}

function mergeUsage(target: XplUsage, raw: RawUsage | undefined): void {
  if (!raw) return;
  if (raw.input_tokens) target.inputTokens = raw.input_tokens;
  if (raw.output_tokens) target.outputTokens = raw.output_tokens;
  if (raw.cache_read_input_tokens) target.cacheReadTokens = raw.cache_read_input_tokens;
  if (raw.cost) target.costUsd = raw.cost;
}

function parseJsonInput(raw: string): unknown {
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export interface ParsedResponse {
  usage: XplUsage;
  toolUses: ToolUse[];
  stopReason?: string;
  error?: string;
}

export function parseSse(text: string): ParsedResponse {
  const usage = emptyUsage();
  const blocks = new Map<number, { id: string; name: string; json: string }>();
  let stopReason: string | undefined;
  let error: string | undefined;
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    let event: SseEvent;
    try {
      event = JSON.parse(line.slice(5).trim()) as SseEvent;
    } catch {
      continue;
    }
    if (event.type === "message_start") mergeUsage(usage, event.message?.usage);
    if (event.type === "message_delta") {
      mergeUsage(usage, event.usage);
      stopReason = event.delta?.stop_reason ?? stopReason;
    }
    if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
      blocks.set(event.index ?? -1, { id: event.content_block.id ?? "", name: event.content_block.name ?? "", json: "" });
    }
    if (event.type === "content_block_delta" && event.delta?.type === "input_json_delta") {
      const block = blocks.get(event.index ?? -1);
      if (block) block.json += event.delta.partial_json ?? "";
    }
    if (event.type === "error") error = event.error?.message ?? "stream error";
  }
  const toolUses = [...blocks.values()].map((block) => ({ id: block.id, name: block.name, input: parseJsonInput(block.json) }));
  return { usage, toolUses, stopReason, error };
}

export function parseJsonMessage(text: string): ParsedResponse {
  const usage = emptyUsage();
  let body: JsonMessage;
  try {
    body = JSON.parse(text) as JsonMessage;
  } catch {
    return { usage, toolUses: [], error: text.slice(0, 300) };
  }
  mergeUsage(usage, body.usage);
  const toolUses = (body.content ?? [])
    .filter((block) => block.type === "tool_use")
    .map((block) => ({ id: block.id ?? "", name: block.name ?? "", input: block.input }));
  return { usage, toolUses, stopReason: body.stop_reason, error: body.error?.message };
}

export interface UsageTotals {
  calls: number;
  coachCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
}

export function totalUsage(calls: XplCall[]): UsageTotals {
  return calls.reduce<UsageTotals>(
    (sum, call) => ({
      calls: sum.calls + 1,
      coachCalls: sum.coachCalls + (call.kind === "coach" ? 1 : 0),
      inputTokens: sum.inputTokens + call.usage.inputTokens,
      outputTokens: sum.outputTokens + call.usage.outputTokens,
      cacheReadTokens: sum.cacheReadTokens + call.usage.cacheReadTokens,
      costUsd: sum.costUsd + call.usage.costUsd,
    }),
    { calls: 0, coachCalls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 },
  );
}
