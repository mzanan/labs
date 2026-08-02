import { createGroq } from "@ai-sdk/groq";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

export type ProviderId = "groq" | "openrouter";

export interface ModelRef {
  provider: ProviderId;
  model: string;
  label?: string;
  routeOnly?: string[];
}

export interface ResolvedModel {
  ref: ModelRef;
  label: string;
  languageModel: LanguageModel;
}

const ENV_VAR: Record<ProviderId, string> = {
  groq: "GROQ_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

export function isProviderId(value: string): value is ProviderId {
  return value in ENV_VAR;
}

function create(ref: ModelRef, apiKey: string): LanguageModel {
  if (ref.provider === "groq") return createGroq({ apiKey })(ref.model);
  return createOpenRouter({ apiKey })(
    ref.model,
    ref.routeOnly?.length ? { provider: { only: ref.routeOnly } } : {},
  );
}

export function resolveAll(refs: ModelRef[]): {
  resolved: ResolvedModel[];
  skipped: { ref: ModelRef; reason: string }[];
} {
  const resolved: ResolvedModel[] = [];
  const skipped: { ref: ModelRef; reason: string }[] = [];

  for (const ref of refs) {
    const apiKey = process.env[ENV_VAR[ref.provider]];
    if (!apiKey) {
      skipped.push({ ref, reason: `missing ${ENV_VAR[ref.provider]}` });
      continue;
    }
    resolved.push({
      ref,
      label: ref.label ?? `${ref.provider} ${ref.model}`,
      languageModel: create(ref, apiKey),
    });
  }
  return { resolved, skipped };
}
