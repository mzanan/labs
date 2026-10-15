import { WRITE_JOBS } from "../scenarios";
import type { Job } from "../scenarios/types";
import type { ScenarioRecord, TurnRecord } from "./records";

export const JOBS: Job[] = ["J1", "J2", "J3", "J4", "J5", "J6", "J9"];

export interface ModelSummary {
  model: string;
  scenarioRuns: number;
  skipped: number;
  skipReasons: string[];
  reps: number;
  rep1PassRate: number;
  passRate: number;
  jobPassRate: Partial<Record<Job, number>>;
  passPow3Writes: number | null;
  writeScenariosWithAllReps: number;
  turns: number;
  unrequestedWrites: number;
  falseClaims: number;
  appNotices: number;
  genericErrors: number;
  languageMisses: number;
  updateRuleMisuse: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  costPerMessageUsd: number;
  totalCostUsd: number;
}

export interface FailurePattern {
  pattern: string;
  count: number;
  byModel: Record<string, number>;
  examples: { model: string; scenarioId: string; rep: number; turn: TurnRecord }[];
}

function ratio(part: number, whole: number): number {
  return whole ? part / whole : 0;
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function passPow3(records: ScenarioRecord[]): { rate: number | null; count: number } {
  const byScenario = new Map<string, ScenarioRecord[]>();
  for (const record of records.filter((entry) => WRITE_JOBS.has(entry.job))) {
    byScenario.set(record.scenarioId, [...(byScenario.get(record.scenarioId) ?? []), record]);
  }
  const complete = [...byScenario.values()].filter((runs) => runs.length >= 3);
  if (!complete.length) return { rate: null, count: 0 };
  return { rate: ratio(complete.filter((runs) => runs.every((run) => run.passed)).length, complete.length), count: complete.length };
}

export function summarizeModel(model: string, all: ScenarioRecord[]): ModelSummary {
  const records = all.filter((record) => !record.skipped);
  const skipped = all.filter((record) => record.skipped);
  const turns = records.flatMap((record) => record.turns);
  const totalCostUsd = turns.reduce((sum, turn) => sum + turn.usage.costUsd, 0);
  const latencies = turns.filter((turn) => !turn.error).map((turn) => turn.latencyMs);
  const jobPassRate: Partial<Record<Job, number>> = {};
  for (const job of JOBS) {
    const ofJob = records.filter((record) => record.job === job);
    if (ofJob.length) jobPassRate[job] = ratio(ofJob.filter((record) => record.passed).length, ofJob.length);
  }
  const pow3 = passPow3(records);
  const rep1 = records.filter((record) => record.rep === 1);
  return {
    model,
    reps: Math.max(0, ...records.map((record) => record.rep)),
    rep1PassRate: ratio(rep1.filter((record) => record.passed).length, rep1.length),
    scenarioRuns: records.length,
    skipped: skipped.length,
    skipReasons: [...new Set(skipped.map((record) => record.skipped ?? ""))],
    passRate: ratio(records.filter((record) => record.passed).length, records.length),
    jobPassRate,
    passPow3Writes: pow3.rate,
    writeScenariosWithAllReps: pow3.count,
    turns: turns.length,
    unrequestedWrites: turns.reduce((sum, turn) => sum + turn.unrequestedWrites, 0),
    falseClaims: turns.filter((turn) => !turn.grades.falseClaim.pass).length,
    appNotices: turns.filter((turn) => turn.appNotice).length,
    genericErrors: turns.filter((turn) => !turn.grades.error.pass).length,
    languageMisses: turns.filter((turn) => !turn.grades.language.pass).length,
    updateRuleMisuse: turns.filter((turn) => turn.grades.trace.notes.includes("update_rule misuse")).length,
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
    costPerMessageUsd: ratio(totalCostUsd, turns.length),
    totalCostUsd,
  };
}

export function patternOf(note: string): string {
  return note
    .replace(/^missing meal .*/, "missing expected meal row")
    .replace(/^unexpected meal row .*/, "extra or wrong meal row")
    .replace(/^fixture: .*/, "fixture error")
    .replace(/^engine threw: .*/, "engine threw")
    .replace(/^reply in .*/, "reply language mismatch")
    .replace(/^(\w+)\.(\w+) != .*/, "$1.$2 wrong value");
}

const EXAMPLES_PER_PATTERN = 3;

export function failurePatterns(records: ScenarioRecord[]): FailurePattern[] {
  const patterns = new Map<string, FailurePattern>();
  for (const record of records.filter((entry) => !entry.skipped)) {
    for (const turn of record.turns) {
      const notes = new Set(
        Object.entries(turn.grades).flatMap(([grader, verdict]) => verdict.notes.map((note) => `${grader}: ${patternOf(note)}`)),
      );
      for (const note of notes) {
        const entry = patterns.get(note) ?? { pattern: note, count: 0, byModel: {}, examples: [] };
        entry.count += 1;
        entry.byModel[record.model] = (entry.byModel[record.model] ?? 0) + 1;
        if (entry.examples.length < EXAMPLES_PER_PATTERN) {
          entry.examples.push({ model: record.model, scenarioId: record.scenarioId, rep: record.rep, turn });
        }
        patterns.set(note, entry);
      }
    }
  }
  return [...patterns.values()].sort((a, b) => b.count - a.count);
}
