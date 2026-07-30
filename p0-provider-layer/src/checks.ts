import { generateText, generateObject, stepCountIs, tool } from "ai";
import { z } from "zod";
import type { LanguageModel } from "ai";

export type Outcome = "pass" | "fail" | "blocked";

export type CheckResult = {
  name: string;
  outcome: Outcome;
  detail: string;
  ms: number;
};

const QUOTA_MARKERS = ["quota", "rate limit", "429", "too many requests", "overloaded"];

const CALL_TIMEOUT_MS = Number(process.env.CALL_TIMEOUT_MS ?? 45000);

function deadline() {
  return AbortSignal.timeout(CALL_TIMEOUT_MS);
}

function isTimeout(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("abort") || lower.includes("timeout") || lower.includes("timed out");
}

function isQuota(message: string): boolean {
  const lower = message.toLowerCase();
  return QUOTA_MARKERS.some((marker) => lower.includes(marker));
}

async function timed(fn: () => Promise<{ ok: boolean; detail: string }>) {
  const started = Date.now();
  try {
    const result = await fn();
    return {
      outcome: (result.ok ? "pass" : "fail") as Outcome,
      detail: result.detail,
      ms: Date.now() - started,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      outcome: (isQuota(message) || isTimeout(message) ? "blocked" : "fail") as Outcome,
      detail: isQuota(message)
        ? "free-tier quota hit, capability NOT measured"
        : isTimeout(message)
          ? `no response in ${CALL_TIMEOUT_MS / 1000}s, capability NOT measured`
          : message.slice(0, 160),
      ms: Date.now() - started,
    };
  }
}

export async function checkText(model: LanguageModel): Promise<CheckResult> {
  const outcome = await timed(async () => {
    const { text } = await generateText({
      model,
      abortSignal: deadline(),
      prompt: "Reply with exactly one word: OK",
    });
    const normalized = text.trim().toUpperCase();
    return {
      ok: normalized.includes("OK"),
      detail: JSON.stringify(text.trim().slice(0, 60)),
    };
  });
  return { name: "plain text", ...outcome };
}

export async function checkToolCall(model: LanguageModel): Promise<CheckResult> {
  const outcome = await timed(async () => {
    let called = false;
    let receivedCity = "";

    const { text, steps } = await generateText({
      model,
      abortSignal: deadline(),
      stopWhen: stepCountIs(4),
      tools: {
        get_meal_calories: tool({
          description:
            "Look up the calories of a logged meal for a given city. Call this whenever the user asks about calories.",
          inputSchema: z.object({
            city: z.string().describe("City where the meal was eaten"),
          }),
          execute: async ({ city }) => {
            called = true;
            receivedCity = city;
            return { calories: 742, city };
          },
        }),
      },
      prompt:
        "How many calories was the meal I logged in Da Nang? Use the tool, then state the number.",
    });

    const toolCalls = steps.flatMap((step) => step.toolCalls ?? []);
    const mentionsNumber = text.includes("742");

    if (!called) {
      return { ok: false, detail: `tool never invoked (${toolCalls.length} tool calls seen)` };
    }
    return {
      ok: mentionsNumber,
      detail: called
        ? `invoked with city=${JSON.stringify(receivedCity)}, result ${mentionsNumber ? "used" : "NOT used"} in final text`
        : "not invoked",
    };
  });
  return { name: "tool call", ...outcome };
}

export async function checkStructured(model: LanguageModel): Promise<CheckResult> {
  const outcome = await timed(async () => {
    const { object } = await generateObject({
      model,
      abortSignal: deadline(),
      schema: z.object({
        protein_g: z.number(),
        fat_g: z.number(),
        carbs_g: z.number(),
      }),
      prompt:
        "Estimate the macros of 200g of grilled chicken breast. Numbers only, in grams.",
    });
    const valid =
      typeof object.protein_g === "number" &&
      typeof object.fat_g === "number" &&
      typeof object.carbs_g === "number";
    return { ok: valid, detail: JSON.stringify(object) };
  });
  return { name: "structured JSON", ...outcome };
}

export const CHECKS = [checkText, checkToolCall, checkStructured];
