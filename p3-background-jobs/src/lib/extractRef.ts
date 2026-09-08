import type { ExtractRef } from "@/lib/extractChunk";

const DEFAULT_MODEL = "openai/gpt-oss-120b";

export function extractRefFromEnv(): ExtractRef {
  const provider = process.env.EXTRACT_PROVIDER === "gateway" ? "gateway" : "groq";
  const model = process.env.EXTRACT_MODEL || DEFAULT_MODEL;
  return { provider, model };
}
