import { createGroq } from "@ai-sdk/groq";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

export type Candidate = {
  id: string;
  label: string;
  wireFormat: string;
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
    id: "google",
    label: "Gemini 2.5 Flash (native API)",
    wireFormat: "Google native",
    build: (apiKey) => createGoogleGenerativeAI({ apiKey })("gemini-2.5-flash"),
  },
];

export function keyFor(candidate: Candidate): string {
  const envVar = candidate.id.startsWith("groq") ? "GROQ_API_KEY" : "GOOGLE_API_KEY";
  const value = process.env[envVar];
  if (!value) throw new Error(`missing ${envVar}`);
  return value;
}
