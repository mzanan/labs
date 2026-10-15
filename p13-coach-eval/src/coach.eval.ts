import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { afterAll, it } from "vitest";

import { isReasoningEffort } from "@/lib/ai/options";

import { legacyEngine } from "./engine/legacyEngine";
import { closeOwnerDb } from "./fixtures/ownerDb";
import { deleteEvalRun } from "./fixtures/cleanup";
import { loadEvalSource } from "./fixtures/syntheticUser";
import type { ScenarioRecord } from "./report/records";
import { completedKeys, readRecordFile, readRunRecords, recordCost, recordKey } from "./report/recordStore";
import { EVAL_DEFAULTS, parseModelList } from "./runConfig";
import { runScenario } from "./runScenario";
import { selectScenarios } from "./scenarios";
import type { Scenario } from "./scenarios/types";

const env = process.env;
const runId = env.EVAL_RUN_ID ?? "";
const model = env.EVAL_MODEL ?? "";
const outDir = env.EVAL_OUT_DIR ?? "";
const reps = Number(env.EVAL_REPS ?? EVAL_DEFAULTS.reps);
const concurrency = Number(env.EVAL_CONCURRENCY ?? EVAL_DEFAULTS.concurrency);
const budgetUsd = Number(env.EVAL_BUDGET_USD ?? EVAL_DEFAULTS.budgetUsd);
const effortInput = env.EVAL_EFFORT ?? "";
const effort = isReasoningEffort(effortInput) ? effortInput : EVAL_DEFAULTS.effort;

interface Task {
  scenario: Scenario;
  rep: number;
  n: number;
}

async function spentUsd(): Promise<number> {
  const records = await readRunRecords(outDir);
  return records.reduce((sum, record) => sum + recordCost(record), 0);
}

function infraFailure(record: ScenarioRecord): boolean {
  return record.turns.length > 0 && record.turns.every((turn) => turn.providerErrors.length > 0 && !turn.grades.error.pass);
}

function skippedRecord(task: Task, reason: string): ScenarioRecord {
  return {
    runId,
    model,
    engine: legacyEngine.name,
    scenarioId: task.scenario.id,
    job: task.scenario.job,
    lang: task.scenario.lang,
    rep: task.rep,
    passed: false,
    turns: [],
    skipped: reason,
  };
}

afterAll(async () => {
  if (runId) await deleteEvalRun(runId);
  await closeOwnerDb();
});

it(
  `coach eval ${model}`,
  async () => {
    const apiKey = env.EXPLABS_API_KEY;
    if (!apiKey || !runId || !model || !outDir) throw new Error("Run evals through npm run eval");
    await mkdir(outDir, { recursive: true });
    const scenarios = selectScenarios(parseModelList(env.EVAL_SCENARIOS));
    const source = await loadEvalSource();
    const outFile = path.join(outDir, `${model}.jsonl`);
    const done = completedKeys(await readRecordFile(outFile));
    const tasks: Task[] = Array.from({ length: reps }, (_, index) => index + 1)
      .flatMap((rep) => scenarios.map((scenario, index) => ({ scenario, rep, n: (rep - 1) * scenarios.length + index + 1 })))
      .filter((task) => !done.has(recordKey({ model, scenarioId: task.scenario.id, rep: task.rep })));
    console.info(`[${model}] ${done.size} runs already recorded, ${tasks.length} to run`);
    let infraStreak = 0;
    let stopReason: string | null = null;

    const worker = async () => {
      for (let task = tasks.shift(); task; task = tasks.shift()) {
        if (!stopReason && (await spentUsd()) >= budgetUsd) stopReason = "budget";
        if (!stopReason && infraStreak >= EVAL_DEFAULTS.infraFailureStreak) stopReason = "infra";
        let record: ScenarioRecord;
        if (stopReason) {
          record = skippedRecord(task, stopReason);
        } else {
          try {
            record = await runScenario(
              { engine: legacyEngine, source, runId, userNumber: task.n, model, effort, apiKey, rep: task.rep },
              task.scenario,
            );
          } catch (error) {
            record = skippedRecord(task, `harness error: ${error instanceof Error ? error.message : String(error)}`);
          }
          infraStreak = infraFailure(record) ? infraStreak + 1 : 0;
        }
        await appendFile(outFile, `${JSON.stringify(record)}\n`);
        const cost = recordCost(record);
        console.info(`[${model}] ${record.scenarioId} rep ${record.rep}: ${record.skipped ?? (record.passed ? "pass" : "fail")} $${cost.toFixed(4)}`);
      }
    };

    await Promise.all(Array.from({ length: concurrency }, worker));
  },
  24 * 60 * 60 * 1000,
);
