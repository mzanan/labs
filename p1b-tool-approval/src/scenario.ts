export const INSTRUCTIONS = `You are a nutrition coach inside a tracking app. Use the tools to read the user's data and to log meals when they ask. Never invent macros: take them from the catalog or from the user's message. Answer in the user's language, briefly.`;

export const PROMPT = "logueame el Pollo Avo como almuerzo";

export const WRITE_TOOL = "log_meal";

export const PAUSE_MS = Number(process.env.PAUSE_MS ?? 3000);
export const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 90_000);
export const MAX_STEPS = Number(process.env.MAX_STEPS ?? 6);
export const MAX_OUTPUT_TOKENS = 1200;

export interface CaseResult {
  name: string;
  outcome: "pass" | "fail" | "error";
  detail: string;
}

export function report(label: string, results: CaseResult[]): void {
  console.log(`\n${label}`);
  for (const result of results) {
    const mark = { pass: "PASS", fail: "FAIL", error: "ERR " }[result.outcome];
    console.log(`  ${mark}  ${result.name.padEnd(14)} ${result.detail}`);
  }
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
