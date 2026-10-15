export const EVAL_MODELS = [
  "deepseek-v4-flash",
  "deepseek-v4.1-flash",
  "mimo-v2.6-flash",
  "qwen3.8-27b",
  "glm-5.3-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.7-flash",
  "gemini-3.8-flash",
  "gpt-6-luna",
  "claude-haiku-5.5",
  "gemini-4-argon",
];

export const EVAL_DEFAULTS = {
  reps: 3,
  concurrency: 3,
  parallelModels: 6,
  budgetUsd: 40,
  effort: "low",
  infraFailureStreak: 8,
} as const;

export const EVAL_SOURCE_EMAIL = "matiaszanan@gmail.com";

export const EVAL_TIMEZONE = "Asia/Ho_Chi_Minh";

export function parseModelList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function evalEmail(runId: string, n: number): string {
  return `eval+${runId}-${n}@fit-coach.test`;
}

export function evalEmailPattern(runId: string): string {
  return `eval+${runId}-%@fit-coach.test`;
}

export function modelRunId(baseRunId: string, model: string): string {
  return `${baseRunId}.${model}`;
}

export function evalBaseEmailPattern(baseRunId: string): string {
  return `eval+${baseRunId}.%@fit-coach.test`;
}
