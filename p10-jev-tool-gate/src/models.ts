import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

export type ChatProvider = "explabs" | "openrouter";

export function chatModel(provider: ChatProvider, id: string): LanguageModel {
  if (provider === "explabs") {
    const apiKey = process.env.EXPLABS_API_KEY;
    if (!apiKey) throw new Error("EXPLABS_API_KEY is not set");
    return createAnthropic({ apiKey, baseURL: "https://api.experientiallabs.ai/v1" })(id);
  }
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");
  return createOpenRouter({ apiKey })(id, { usage: { include: true } });
}

export function parseModelRef(ref: string): { provider: ChatProvider; id: string } {
  const [provider, ...rest] = ref.split(":");
  if ((provider !== "explabs" && provider !== "openrouter") || !rest.length) {
    throw new Error(`model ref must look like explabs:<id> or openrouter:<id>, got ${ref}`);
  }
  return { provider, id: rest.join(":") };
}
