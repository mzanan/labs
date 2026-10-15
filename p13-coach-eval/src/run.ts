import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { config } from "dotenv";

import { failurePatterns, summarizeModel } from "./report/aggregate";
import { summaryMarkdown } from "./report/markdown";
import { readRunRecords } from "./report/recordStore";
import { FIT_COACH_DIR } from "./fitCoachDir";
import { EVAL_DEFAULTS, EVAL_MODELS, modelRunId, parseModelList } from "./runConfig";

const RESULTS_DIR = path.join(process.cwd(), "results", "raw");

interface RunArgs {
  models: string[];
  reps: number;
  scenarios: string;
  concurrency: number;
  parallel: number;
  budget: number;
  report?: string;
  resume?: string;
  fullReps: string[];
}

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}

function parseArgs(): RunArgs {
  const models = parseModelList(readFlag("models"));
  return {
    models: models.length ? models : EVAL_MODELS,
    reps: Number(readFlag("reps") ?? EVAL_DEFAULTS.reps),
    scenarios: readFlag("scenarios") ?? "",
    concurrency: Number(readFlag("concurrency") ?? EVAL_DEFAULTS.concurrency),
    parallel: Number(readFlag("parallel") ?? EVAL_DEFAULTS.parallelModels),
    budget: Number(readFlag("budget") ?? EVAL_DEFAULTS.budgetUsd),
    report: readFlag("report"),
    resume: readFlag("resume"),
    fullReps: parseModelList(readFlag("full-reps")),
  };
}

function timestampId(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
}

function runModel(args: RunArgs, runId: string, outDir: string, model: string): Promise<number> {
  const log = createWriteStream(path.join(outDir, `${model}.log`));
  const child = spawn("npx", ["vitest", "run", "--config", "vitest.eval.config.ts"], {
    env: {
      ...process.env,
      EVAL_RUN_ID: modelRunId(runId, model),
      EVAL_MODEL: model,
      EVAL_REPS: String(args.reps),
      EVAL_SCENARIOS: args.scenarios,
      EVAL_CONCURRENCY: String(args.concurrency),
      EVAL_BUDGET_USD: String(args.budget),
      EVAL_OUT_DIR: outDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  return new Promise((resolve) => child.on("close", (code) => resolve(code ?? 1)));
}

async function runAll(args: RunArgs, runId: string, outDir: string): Promise<void> {
  const queue = [...args.models];
  const lane = async () => {
    for (let model = queue.shift(); model; model = queue.shift()) {
      console.info(`start ${model}`);
      const code = await runModel(args, runId, outDir, model);
      console.info(`done ${model} (exit ${code})`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, args.parallel) }, lane));
}

async function writeReport(runId: string, outDir: string, models: string[], fullReps: string[]): Promise<void> {
  const records = (await readRunRecords(outDir)).filter(
    (record) => !fullReps.length || record.rep === 1 || fullReps.includes(record.model),
  );
  const present = [...new Set([...models, ...records.map((record) => record.model)])].filter((model) =>
    records.some((record) => record.model === model),
  );
  const summaries = present.map((model) =>
    summarizeModel(
      model,
      records.filter((record) => record.model === model),
    ),
  );
  const patterns = failurePatterns(records);
  await writeFile(path.join(RESULTS_DIR, `${runId}.json`), JSON.stringify({ runId, summaries, patterns: patterns.map(({ examples, ...rest }) => ({ ...rest, examples: examples.length })), records }, null, 2));
  await writeFile(path.join(RESULTS_DIR, `${runId}.md`), summaryMarkdown(runId, summaries, patterns));
  console.info(`report: ${path.join(RESULTS_DIR, `${runId}.md`)}`);
}

async function sweep(runId: string): Promise<void> {
  const { closeOwnerDb } = await import("./fixtures/ownerDb");
  const { deleteEvalBaseRun } = await import("./fixtures/cleanup");
  const removed = await deleteEvalBaseRun(runId);
  await closeOwnerDb();
  console.info(`swept ${removed} leftover eval users`);
}

async function main() {
  config({ path: path.join(FIT_COACH_DIR, ".env.local"), quiet: true });
  const args = parseArgs();
  if (args.report) {
    await writeReport(args.report, path.join(RESULTS_DIR, args.report), args.models, args.fullReps);
    return;
  }
  if (!process.env.EXPLABS_API_KEY) throw new Error("EXPLABS_API_KEY is not set in the shell");
  const runId = args.resume ?? timestampId();
  const outDir = path.join(RESULTS_DIR, runId);
  await mkdir(outDir, { recursive: true });
  console.info(`run ${runId}: ${args.models.join(", ")} x ${args.reps} reps`);
  try {
    await runAll(args, runId, outDir);
  } finally {
    await sweep(runId);
  }
  await writeReport(runId, outDir, args.models, args.fullReps);
}

void main();
