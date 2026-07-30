import { createGroq } from "@ai-sdk/groq";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

export type Candidate = {
  id: string;
  label: string;
  wireFormat: string;
  modelId?: string;
  build: (apiKey: string) => LanguageModel;
};

export const CANDIDATES: Candidate[] = [
  {
    id: "groq",
    label: "Groq llama-3.3-70b-versatile",
    wireFormat: "OpenAI-compatible",
    build: (apiKey) => createGroq({ apiKey })("llama-3.3-70b-versatile"),
  },
  {
    id: "groq-oss",
    label: "Groq openai/gpt-oss-120b",
    wireFormat: "OpenAI-compatible",
    build: (apiKey) => createGroq({ apiKey })("openai/gpt-oss-120b"),
  },
  {
    id: "openrouter-same-model",
    label: "OpenRouter -> openai/gpt-oss-120b",
    wireFormat: "OpenRouter gateway",
    modelId: "openai/gpt-oss-120b",
    build: (apiKey) => createOpenRouter({ apiKey })("openai/gpt-oss-120b"),
  },
  {
    id: "openrouter-free-capable",
    label: "OpenRouter -> nemotron-3-super:free",
    wireFormat: "OpenRouter gateway",
    modelId: "nvidia/nemotron-3-super-120b-a12b:free",
    build: (apiKey) =>
      createOpenRouter({ apiKey })("nvidia/nemotron-3-super-120b-a12b:free"),
  },
  {
    id: "openrouter-free-limited",
    label: "OpenRouter -> ling-3.0-flash:free",
    wireFormat: "OpenRouter gateway",
    modelId: "inclusionai/ling-3.0-flash:free",
    build: (apiKey) => createOpenRouter({ apiKey })("inclusionai/ling-3.0-flash:free"),
  },
  {
    id: "google",
    label: "Gemini 2.5 Flash (native API)",
    wireFormat: "Google native",
    build: (apiKey) => createGoogleGenerativeAI({ apiKey })("gemini-2.5-flash"),
  },
];

export function keyFor(candidate: Candidate): string {
  const envVar = candidate.id.startsWith("groq")
    ? "GROQ_API_KEY"
    : candidate.id.startsWith("openrouter")
      ? "OPENROUTER_API_KEY"
      : "GOOGLE_API_KEY";
  const value = process.env[envVar];
  if (!value) throw new Error(`missing ${envVar}`);
  return value;
}
