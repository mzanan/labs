import { readFileSync } from "node:fs";

import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, isStepCount } from "ai";

import { FIXTURES } from "./fixtures.js";
import { buildTools, type ToolTrace } from "./tools.js";
import { SCENARIOS, type Scenario } from "./scenarios.js";

const PAUSE_MS = Number(process.env.PAUSE_MS ?? 8000);
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 90_000);
const MAX_STEPS = Number(process.env.MAX_STEPS ?? 6);
const CANDIDATES_FILE = process.env.CANDIDATES_FILE ?? "candidates.json";

const INSTRUCTIONS = `You are a nutrition and strength coach inside a tracking app. Use the tools to read the user's real data before answering, and to log meals when the user asks. Never invent macros: read them from the catalog or from the user's message. If the message needs no data and no action, just answer briefly. Reply in the user's language.`;

interface Candidate {
  model: string;
  label: string;
  routeOnly?: string[];
}

interface CellResult {
  scenario: string;
  outcome: "pass" | "fail" | "error";
  detail: string;
  toolsCalled: string[];
  steps: number;
  tokens: number;
  ms: number;
}

function loadCandidates(path: string): Candidate[] {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${path} must contain an array`);
  return parsed.map((entry, index) => {
    const c = entry as Partial<Candidate>;
    if (typeof c.model !== "string" || c.model.length === 0) {
      throw new Error(`${path}[${index}]: missing model`);
    }
    return { model: c.model, label: c.label ?? c.model, routeOnly: c.routeOnly };
  });
}

function judge(scenario: Scenario, trace: ToolTrace[], text: string): { outcome: "pass" | "fail"; detail: string } {
  const called = trace.map((t) => t.tool);
  const missing = scenario.expectTools.filter((t) => !called.includes(t));
  if (missing.length) return { outcome: "fail", detail: `missing tools: ${missing.join(",")}` };
  const forbidden = scenario.forbidTools.filter((t) => called.includes(t));
  if (forbidden.length) return { outcome: "fail", detail: `forbidden tools called: ${forbidden.join(",")}` };
  if (scenario.checkArgs) {
    const argError = scenario.checkArgs(trace);
    if (argError) return { outcome: "fail", detail: argError };
  }
  if (!text.trim()) return { outcome: "fail", detail: "empty final answer" };
  return { outcome: "pass", detail: `tools: ${called.join(" -> ") || "none"}` };
}

async function runCell(candidate: Candidate, scenario: Scenario, apiKey: string): Promise<CellResult> {
  const trace: ToolTrace[] = [];
  const model = createOpenRouter({ apiKey })(candidate.model, {
    provider: {
      ...(candidate.routeOnly?.length ? { only: candidate.routeOnly } : {}),
      require_parameters: true,
    },
  });
  const started = Date.now();
  try {
    const result = await generateText({
      model,
      instructions: INSTRUCTIONS,
      prompt: scenario.prompt,
      tools: buildTools(FIXTURES, trace),
      stopWhen: isStepCount(MAX_STEPS),
      maxOutputTokens: 1200,
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const verdict = judge(scenario, trace, result.text);
    return {
      scenario: scenario.id,
      outcome: verdict.outcome,
      detail: verdict.detail,
      toolsCalled: trace.map((t) => t.tool),
      steps: result.steps.length,
      tokens: result.totalUsage.totalTokens ?? 0,
      ms: Date.now() - started,
    };
  } catch (error) {
    return {
      scenario: scenario.id,
      outcome: "error",
      detail: (error as Error).message.slice(0, 120),
      toolsCalled: trace.map((t) => t.tool),
      steps: 0,
      tokens: 0,
      ms: Date.now() - started,
    };
  }
}

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");
  const candidates = loadCandidates(CANDIDATES_FILE);

  const byModel = new Map<string, CellResult[]>();
  for (const candidate of candidates) {
    console.log(`\n${candidate.label}`);
    const results: CellResult[] = [];
    for (const scenario of SCENARIOS) {
      const result = await runCell(candidate, scenario, apiKey);
      results.push(result);
      const mark = { pass: "PASS", fail: "FAIL", error: "ERR " }[result.outcome];
      console.log(
        `  ${mark}  ${result.scenario.padEnd(18)} ${String(result.ms).padStart(6)}ms  ${String(result.tokens).padStart(6)}tok  steps ${result.steps}  ${result.detail}`,
      );
      await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
    }
    byModel.set(candidate.label, results);
  }

  console.log("\n\nSummary (pass / total per model)\n");
  const width = Math.max(...candidates.map((c) => c.label.length));
  for (const [label, results] of byModel) {
    const passed = results.filter((r) => r.outcome === "pass").length;
    const cells = results
      .map((r) => `${r.scenario}:${{ pass: "P", fail: "F", error: "E" }[r.outcome]}`)
      .join("  ");
    console.log(`${label.padEnd(width)}  ${passed}/${results.length}  ${cells}`);
  }
}

main();
