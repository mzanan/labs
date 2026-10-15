import { EXPLABS_BASE_URL } from "@/lib/ai/capabilities";
import { WRITE_TOOLS } from "@/lib/constants";

import { currentTrace } from "./turnTrace";
import { callKind, emptyUsage, parseJsonMessage, parseRequest, parseSse, toolResultsOf, type XplCall } from "./xplParse";

const MESSAGES_URL = `${EXPLABS_BASE_URL}/messages`;

const COACH_TOOL_MARKERS: ReadonlySet<string> = new Set([...WRITE_TOOLS, "get_today", "search_catalog"]);

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

let installed = false;

export function installXplFetch(): void {
  if (installed) return;
  installed = true;
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const trace = currentTrace();
    if (!trace || !urlOf(input).startsWith(MESSAGES_URL)) return original(input, init);
    const request = parseRequest(init?.body);
    for (const [id, text] of toolResultsOf(request)) trace.toolResults.set(id, text);
    const call: XplCall = {
      kind: callKind(request, COACH_TOOL_MARKERS),
      model: request.model ?? "",
      status: 0,
      latencyMs: 0,
      usage: emptyUsage(),
      toolUses: [],
    };
    trace.calls.push(call);
    const started = performance.now();
    let response: Response;
    try {
      response = await original(input, init);
    } catch (error) {
      call.latencyMs = performance.now() - started;
      call.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
    call.status = response.status;
    const copy = response.clone();
    trace.parsing.push(
      copy
        .text()
        .then((text) => {
          const parsed = request.stream && response.ok ? parseSse(text) : parseJsonMessage(text);
          call.latencyMs = performance.now() - started;
          call.usage = parsed.usage;
          call.toolUses = parsed.toolUses;
          call.stopReason = parsed.stopReason;
          call.error = response.ok ? parsed.error : `http ${response.status}: ${parsed.error ?? ""}`.slice(0, 300);
        })
        .catch((error: unknown) => {
          call.error = error instanceof Error ? error.message : String(error);
        }),
    );
    return response;
  };
}
