import { coachReply, type CoachResult } from "@/lib/ai/coach";
import { resolvePendingWrite } from "@/lib/ai/coachApproval";
import type { CoachEvent } from "@/lib/ai/provider";
import { runAsUser } from "@/lib/db/context";

import { newTrace, runInTrace, settleTrace, type TurnTrace } from "../capture/turnTrace";
import { writeCursor, writesSince } from "../capture/writeChanges";
import { totalUsage } from "../capture/xplParse";
import type { CoachEngine, EngineToolCall, EngineTurnInput, EngineTurnOutput } from "./coachEngine";

function toolCallsOf(trace: TurnTrace): EngineToolCall[] {
  return trace.calls
    .filter((call) => call.kind === "coach")
    .flatMap((call) => call.toolUses)
    .map((use) => ({ ...use, result: trace.toolResults.get(use.id) }));
}

function providerErrorsOf(trace: TurnTrace): string[] {
  return trace.calls.flatMap((call) => (call.error ? [`${call.kind} ${call.error}`] : []));
}

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function approvePending(
  input: EngineTurnInput,
  result: CoachResult,
  onEvent: (event: CoachEvent) => void,
): Promise<CoachResult | null> {
  if (result.status !== "pending" || !result.saved) return null;
  return runAsUser(input.userId, "app", () =>
    resolvePendingWrite(input.userId, input.profile, result.approvalId, true, undefined, onEvent),
  );
}

function textOf(result: CoachResult | undefined): string {
  if (!result) return "";
  return result.status === "answered" ? result.text : [result.logged, "(confirmation card shown)"].filter(Boolean).join("\n\n");
}

export const legacyEngine: CoachEngine = {
  name: "legacy",
  async reply(input: EngineTurnInput): Promise<EngineTurnOutput> {
    const cursor = await writeCursor(input.userId);
    const trace = newTrace();
    const events: CoachEvent[] = [];
    const onEvent = (event: CoachEvent) => events.push(event);
    const started = performance.now();
    let latencyMs = 0;
    let result: CoachResult | undefined;
    let approved = false;
    let error: string | undefined;

    await runInTrace(trace, async () => {
      try {
        result = await runAsUser(input.userId, "app", () => coachReply(input.userId, input.profile, input.message, onEvent));
        latencyMs = performance.now() - started;
        const resumed = await approvePending(input, result, onEvent);
        if (resumed) {
          approved = true;
          result = resumed;
          latencyMs = performance.now() - started;
        }
      } catch (caught) {
        latencyMs = performance.now() - started;
        error = errorText(caught);
      }
      await settleTrace(trace);
    });

    return {
      text: textOf(result),
      events,
      writes: await writesSince(input.userId, cursor),
      toolCalls: toolCallsOf(trace),
      usage: totalUsage(trace.calls),
      latencyMs,
      approved,
      providerErrors: providerErrorsOf(trace),
      error,
    };
  },
};
