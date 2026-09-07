import { generateText, generateObject, stepCountIs, tool } from "ai";
import { z } from "zod";
import type { LanguageModel } from "ai";
import type { ProviderOptions } from "@ai-sdk/provider-utils";

export type Outcome = "pass" | "fail" | "blocked";

export type CheckResult = {
  name: string;
  outcome: Outcome;
  detail: string;
  ms: number;
  servedBy?: string;
  costUsd?: number;
};

export type CheckTarget = {
  languageModel: LanguageModel;
  providerOptions?: ProviderOptions;
};

type GatewayMetadata = { routing?: { finalProvider?: string }; cost?: string | number };

function gatewayMetadataFrom(providerMetadata: unknown): GatewayMetadata | undefined {
  return (providerMetadata as { gateway?: GatewayMetadata } | undefined)?.gateway;
}

function servedByFrom(providerMetadata: unknown): string | undefined {
  return gatewayMetadataFrom(providerMetadata)?.routing?.finalProvider;
}

function costFrom(providerMetadata: unknown): number | undefined {
  const cost = gatewayMetadataFrom(providerMetadata)?.cost;
  return cost === undefined ? undefined : Number(cost);
}

const QUOTA_MARKERS = [
  "quota",
  "rate limit",
  "rate-limited",
  "free tier",
  "429",
  "too many requests",
  "overloaded",
  "credit card",
];

const CALL_TIMEOUT_MS = Number(process.env.CALL_TIMEOUT_MS ?? 45000);
const ATTEMPTS = Number(process.env.ATTEMPTS ?? 3);
const RETRY_PAUSE_MS = Number(process.env.RETRY_PAUSE_MS ?? 2000);

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

type AttemptFn = () => Promise<{
  ok: boolean;
  detail: string;
  servedBy?: string;
  costUsd?: number;
}>;

async function attempt(fn: AttemptFn) {
  try {
    const result = await fn();
    return {
      outcome: (result.ok ? "pass" : "fail") as Outcome,
      detail: result.detail,
      servedBy: result.servedBy,
      costUsd: result.costUsd,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isQuota(message)) {
      return {
        outcome: "blocked" as Outcome,
        detail: "provider quota hit, capability NOT measured",
      };
    }
    if (isTimeout(message)) {
      return {
        outcome: "blocked" as Outcome,
        detail: `no response in ${CALL_TIMEOUT_MS / 1000}s, capability NOT measured`,
      };
    }
    return { outcome: "fail" as Outcome, detail: message.slice(0, 160) };
  }
}

async function timed(fn: AttemptFn) {
  const started = Date.now();
  let last = await attempt(fn);
  let tries = 1;

  while (last.outcome !== "pass" && tries < ATTEMPTS) {
    await new Promise((resolve) => setTimeout(resolve, RETRY_PAUSE_MS));
    const retry = await attempt(fn);
    tries += 1;
    last = retry;
    if (retry.outcome === "pass") break;
  }

  const suffix = tries > 1 ? ` (${tries} attempts)` : "";
  return {
    outcome: last.outcome,
    detail: last.detail + suffix,
    ms: Date.now() - started,
    servedBy: last.servedBy,
    costUsd: last.costUsd,
  };
}

export async function checkText(target: CheckTarget): Promise<CheckResult> {
  const outcome = await timed(async () => {
    const { text, providerMetadata } = await generateText({
      model: target.languageModel,
      abortSignal: deadline(),
      maxRetries: 0,
      providerOptions: target.providerOptions,
      prompt: "Reply with exactly one word: OK",
    });
    const normalized = text.trim().toUpperCase();
    return {
      ok: normalized.includes("OK"),
      detail: JSON.stringify(text.trim().slice(0, 60)),
      servedBy: servedByFrom(providerMetadata),
      costUsd: costFrom(providerMetadata),
    };
  });
  return { name: "plain text", ...outcome };
}

export async function checkToolCall(target: CheckTarget): Promise<CheckResult> {
  const outcome = await timed(async () => {
    let called = false;
    let receivedCity = "";

    const { text, steps, providerMetadata } = await generateText({
      model: target.languageModel,
      abortSignal: deadline(),
      maxRetries: 0,
      providerOptions: target.providerOptions,
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
    const servedBy = servedByFrom(providerMetadata);
    const costUsd = costFrom(providerMetadata);

    if (!called) {
      return {
        ok: false,
        detail: `tool never invoked (${toolCalls.length} tool calls seen)`,
        servedBy,
        costUsd,
      };
    }
    return {
      ok: mentionsNumber,
      detail: called
        ? `invoked with city=${JSON.stringify(receivedCity)}, result ${mentionsNumber ? "used" : "NOT used"} in final text`
        : "not invoked",
      servedBy,
      costUsd,
    };
  });
  return { name: "tool call", ...outcome };
}

export async function checkStructured(target: CheckTarget): Promise<CheckResult> {
  const outcome = await timed(async () => {
    const { object, providerMetadata } = await generateObject({
      model: target.languageModel,
      abortSignal: deadline(),
      maxRetries: 0,
      providerOptions: target.providerOptions,
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
    return {
      ok: valid,
      detail: JSON.stringify(object),
      servedBy: servedByFrom(providerMetadata),
      costUsd: costFrom(providerMetadata),
    };
  });
  return { name: "structured JSON", ...outcome };
}

export const CHECKS = [checkText, checkToolCall, checkStructured];
