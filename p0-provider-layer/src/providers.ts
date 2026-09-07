import { createGroq } from "@ai-sdk/groq";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createGateway } from "ai";
import type { LanguageModel } from "ai";
import type { ProviderOptions } from "@ai-sdk/provider-utils";

export type ProviderId = "groq" | "google" | "openrouter" | "gateway";

export type ProviderSpec = {
  id: ProviderId;
  wireFormat: string;
  envVar: string;
  create: (apiKey: string, model: string, routeOnly?: string[]) => LanguageModel;
  declaresCapabilities: boolean;
  callOptions?: (routeOnly?: string[]) => ProviderOptions | undefined;
};

export const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  groq: {
    id: "groq",
    wireFormat: "OpenAI-compatible",
    envVar: "GROQ_API_KEY",
    create: (apiKey, model) => createGroq({ apiKey })(model),
    declaresCapabilities: false,
  },
  google: {
    id: "google",
    wireFormat: "Google native",
    envVar: "GOOGLE_API_KEY",
    create: (apiKey, model) => createGoogleGenerativeAI({ apiKey })(model),
    declaresCapabilities: false,
  },
  openrouter: {
    id: "openrouter",
    wireFormat: "OpenRouter gateway",
    envVar: "OPENROUTER_API_KEY",
    create: (apiKey, model, routeOnly) =>
      createOpenRouter({ apiKey })(model, routeOnly ? { provider: { only: routeOnly } } : {}),
    declaresCapabilities: true,
  },
  gateway: {
    id: "gateway",
    wireFormat: "Vercel AI Gateway",
    envVar: "AI_GATEWAY_API_KEY",
    create: (apiKey, model) => createGateway({ apiKey })(model),
    declaresCapabilities: true,
    callOptions: (routeOnly) =>
      routeOnly ? { gateway: { only: routeOnly } } : undefined,
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
  providerOptions?: ProviderOptions;
};

export type KeyLookup = (envVar: string) => string | undefined;

const fromEnv: KeyLookup = (envVar) => process.env[envVar];

export function isProviderId(value: string): value is ProviderId {
  return value in PROVIDERS;
}

export function resolveModel(ref: ModelRef, lookup: KeyLookup = fromEnv): ResolvedModel {
  const spec = PROVIDERS[ref.provider];
  if (!spec) throw new Error(`unknown provider "${ref.provider}"`);

  const apiKey = lookup(spec.envVar);
  if (!apiKey) throw new Error(`missing ${spec.envVar}`);

  return {
    ref,
    spec,
    label: ref.label ?? `${ref.provider} ${ref.model}`,
    languageModel: spec.create(apiKey, ref.model, ref.routeOnly),
    providerOptions: spec.callOptions?.(ref.routeOnly),
  };
}

export function resolveAll(
  refs: ModelRef[],
  lookup: KeyLookup = fromEnv,
): { resolved: ResolvedModel[]; skipped: { ref: ModelRef; reason: string }[] } {
  const resolved: ResolvedModel[] = [];
  const skipped: { ref: ModelRef; reason: string }[] = [];

  for (const ref of refs) {
    try {
      resolved.push(resolveModel(ref, lookup));
    } catch (error) {
      skipped.push({ ref, reason: (error as Error).message });
    }
  }
  return { resolved, skipped };
}
