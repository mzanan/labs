import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { generateText, Output } from "ai";
import { z } from "zod";

import { grade, type Finding, type Planted } from "./grade.js";
import { chatModel, parseModelRef } from "./models.js";
import { summarize } from "./summary.js";

const ROOT = new URL("..", import.meta.url).pathname;
const FIXTURE = join(ROOT, "fixture");
const REPS = Number(process.env.REPS ?? 3);
const MODELS = (
  process.env.MODELS ??
  "explabs:deepseek-v4.1-flash,explabs:glm-5.3,explabs:kimi-k3,explabs:gpt-5.6-luna,explabs:nemotron-3-ultra-550b-a55b,explabs:mimo-v2.5-pro"
).split(",");
const OUT = process.env.OUT ?? join(ROOT, "results", `bench-${new Date().toISOString().slice(0, 10)}.json`);
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 600000);

const CATEGORIES = [
  "authentication",
  "authorization",
  "csrf",
  "open-redirect",
  "xss",
  "secret-exposure",
  "mass-assignment",
  "ssrf",
  "injection",
  "other",
] as const;

const FINDINGS_SCHEMA = z.object({
  findings: z.array(
    z.object({
      file: z.string(),
      line: z.number().int(),
      category: z.enum(CATEGORIES),
      severity: z.enum(["high", "medium", "low"]),
      title: z.string(),
      evidence: z.string(),
    }),
  ),
});

const SYSTEM = [
  "You are a senior application security reviewer auditing a Next.js App Router codebase (TypeScript, Drizzle ORM, Better Auth, server actions).",
  "Report only exploitable security vulnerabilities: a concrete attacker, a concrete input, a concrete impact.",
  "Do not report style, performance, missing tests, missing rate limits, or hypothetical issues in code you cannot see.",
  "Assume imported helpers you cannot see behave as their names say.",
  "For each finding give the file path exactly as shown, the line number of the vulnerable code, a category, a severity, a one-line title and the evidence: the code and the attack in one or two sentences.",
  "If you find nothing exploitable, return an empty list.",
].join("\n");

function listFiles(): string[] {
  const manifest = JSON.parse(readFileSync(join(FIXTURE, "manifest.json"), "utf8")) as { files: string[] };
  return manifest.files;
}

function numbered(file: string): string {
  const lines = readFileSync(join(FIXTURE, file), "utf8").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.map((line, i) => `${String(i + 1).padStart(4, " ")}| ${line}`).join("\n");
}

function corpus(): string {
  return listFiles()
    .map((file) => `=== FILE: ${file} ===\n${numbered(file)}`)
    .join("\n\n");
}

async function audit(ref: string, prompt: string) {
  const { provider, id } = parseModelRef(ref);
  const started = performance.now();
  try {
    const result = await generateText({
      model: chatModel(provider, id),
      system: SYSTEM,
      prompt,
      output: Output.object({ schema: FINDINGS_SCHEMA }),
      temperature: 0,
      maxOutputTokens: Number(process.env.MAX_OUTPUT_TOKENS ?? 32000),
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return {
      ok: true as const,
      findings: result.output.findings as Finding[],
      seconds: Math.round((performance.now() - started) / 100) / 10,
      inputTokens: result.usage.inputTokens ?? null,
      outputTokens: result.usage.outputTokens ?? null,
    };
  } catch (error) {
    return {
      ok: false as const,
      findings: [] as Finding[],
      seconds: Math.round((performance.now() - started) / 100) / 10,
      error: error instanceof Error ? error.message.slice(0, 500) : String(error),
    };
  }
}

async function main() {
  const planted = (JSON.parse(readFileSync(join(FIXTURE, "manifest.json"), "utf8")) as { planted: Planted[] }).planted;
  const prompt = `Audit these files.\n\n${corpus()}`;
  mkdirSync(join(ROOT, "results"), { recursive: true });
  const runs = [];
  for (const ref of MODELS) {
    const reps = await Promise.all(
      Array.from({ length: REPS }, async (_, i) => {
        const run = await audit(ref, prompt);
        return { rep: i + 1, ...run, grade: grade(planted, run.findings) };
      }),
    );
    const summary = summarize(ref, planted, reps);
    console.log(JSON.stringify(summary));
    runs.push({ summary, reps });
    writeFileSync(OUT, JSON.stringify({ date: new Date().toISOString(), planted, runs }, null, 2));
  }
  console.log(`wrote ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
