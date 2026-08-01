import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

export type ProviderId = "groq" | "google" | "openrouter";

export type ProviderSpec = {
  id: ProviderId;
  wireFormat: string;
  envVar: string;
  create: (apiKey: string, model: string, routeOnly?: string[]) => LanguageModel;
};

export const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  groq: {
    id: "groq",
    wireFormat: "OpenAI-compatible",
    envVar: "GROQ_API_KEY",
    create: (apiKey, model) => createGroq({ apiKey })(model),
  },
  google: {
    id: "google",
    wireFormat: "Google native",
    envVar: "GOOGLE_API_KEY",
    create: (apiKey, model) => createGoogleGenerativeAI({ apiKey })(model),
  },
  openrouter: {
    id: "openrouter",
    wireFormat: "OpenRouter gateway",
    envVar: "OPENROUTER_API_KEY",
    create: (apiKey, model, routeOnly) =>
      createOpenRouter({ apiKey })(model, {
        provider: {
          ...(routeOnly?.length ? { only: routeOnly } : {}),
          require_parameters: true,
        },
      }),
  },
};

export type ModelRef = {
  provider: ProviderId;
  model: string;
  label?: string;
  routeOnly?: string[];
};

export type ResolvedModel = {
  ref: ModelRef;
  spec: ProviderSpec;
  label: string;
  languageModel: LanguageModel;
};

export function isProviderId(value: string): value is ProviderId {
  return value in PROVIDERS;
}

export function resolveModel(ref: ModelRef): ResolvedModel {
  const spec = PROVIDERS[ref.provider];
  if (!spec) throw new Error(`unknown provider "${ref.provider}"`);

  const apiKey = process.env[spec.envVar];
  if (!apiKey) throw new Error(`missing ${spec.envVar}`);

  return {
    ref,
    spec,
    label: ref.label ?? `${ref.provider} ${ref.model}`,
    languageModel: spec.create(apiKey, ref.model, ref.routeOnly),
  };
}

export function resolveAll(refs: ModelRef[]): {
  resolved: ResolvedModel[];
  skipped: { ref: ModelRef; reason: string }[];
} {
  const resolved: ResolvedModel[] = [];
  const skipped: { ref: ModelRef; reason: string }[] = [];

  for (const ref of refs) {
    try {
      resolved.push(resolveModel(ref));
    } catch (error) {
      skipped.push({ ref, reason: (error as Error).message });
    }
  }
  return { resolved, skipped };
}
