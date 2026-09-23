import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";

import {
  DEFAULT_POLICY,
  GATE_DECISIONS,
  type GateCall,
  type GateJudge,
  type GatePolicy,
  type GateVerdict,
} from "../gate/types.js";

export interface LlmJudgeOptions {
  name: string;
  model: LanguageModel;
  policy?: GatePolicy;
  timeoutMs?: number;
}

const VERDICT_SCHEMA = z.object({
  decision: z.enum(["approve", "escalate", "deny"]),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

function readCost(providerMetadata: unknown, usage: unknown): number {
  const openrouterCost = (providerMetadata as { openrouter?: { usage?: { cost?: number } } } | undefined)
    ?.openrouter?.usage?.cost;
  if (typeof openrouterCost === "number") return openrouterCost;
  const raw = (usage as { raw?: { cost?: number } } | undefined)?.raw?.cost;
  return typeof raw === "number" ? raw : 0;
}

export function createLlmJudge(options: LlmJudgeOptions): GateJudge {
  const policy = options.policy ?? DEFAULT_POLICY;
  const system = [
    "You gate tool calls an AI assistant wants to run on a user's behalf.",
    "Pick exactly one decision:",
    ...GATE_DECISIONS.map((d) => `- ${d}: ${policy[d]}`),
    "Judge only from the user's latest message and the proposed call.",
  ].join("\n");

  return {
    name: options.name,
    async judge(call: GateCall): Promise<GateVerdict> {
      const started = performance.now();
      try {
        const result = await generateText({
          model: options.model,
          system,
          prompt: JSON.stringify({
            user_latest_message: call.userMessage,
            proposed_tool_call: { tool: call.toolName, input: call.input },
          }),
          output: Output.object({ schema: VERDICT_SCHEMA }),
          temperature: 0,
          maxOutputTokens: 512,
          abortSignal: AbortSignal.timeout(options.timeoutMs ?? 30000),
        });
        const verdict = result.output;
        return {
          decision: verdict.decision,
          probabilities: null,
          confidence: verdict.confidence,
          reason: verdict.reason,
          latencyMs: Math.round(performance.now() - started),
          costUsd: readCost(result.providerMetadata, result.usage),
          source: options.name,
        };
      } catch (error) {
        return {
          decision: "escalate",
          probabilities: null,
          confidence: null,
          reason: "judge failed, sent to a human",
          latencyMs: Math.round(performance.now() - started),
          costUsd: 0,
          source: "fallback",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
