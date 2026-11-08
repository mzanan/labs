import { rm } from "node:fs/promises";
import { createClient } from "./client";
import { config, type Scenario, type StackName } from "./config";
import { guideReplied, guideRequested } from "./events";
import { getRun, isTerminal, listRunIdsForEvent, type RunSummary } from "./runs";
import { createStack } from "./stack";
import { countSteps, outcomesFor, readStepLog } from "./stepLog";
import { sleep } from "./wait";
import { createWorkerProcess } from "./workerProcess";

interface RequestResult {
  scenario: string;
  key: string;
  runStatus: string;
  outcome: string;
  notifyCount: number;
  runCount: number;
  ms: number;
  pass: boolean;
}

const [stackArg, scenarioArg] = process.argv.slice(2);
const stacks: StackName[] = stackArg && stackArg !== "all" ? [stackArg as StackName] : ["memory", "redis"];
const scenarios = config.scenarios.filter((s) => !scenarioArg || s.id === scenarioArg);

async function runScenario(scenario: Scenario, stack: ReturnType<typeof createStack>, worker: ReturnType<typeof createWorkerProcess>) {
  const inngest = createClient();
  const stamp = Date.now();
  const requestIds = new Map(scenario.requests.map((r) => [r.key, `${scenario.id}-${r.key}-${stamp}`]));
  const eventIds = new Map<string, string[]>();
  const started = Date.now();

  for (const req of scenario.requests) {
    const requestId = requestIds.get(req.key)!;
    const ids: string[] = [];
    for (let i = 0; i < (req.sendTimes ?? 1); i++) {
      const sent = await inngest.send(guideRequested.create({ requestId, guide: req.guide, timeout: req.timeout }, { id: `req-${requestId}` }));
      ids.push(...sent.ids);
    }
    eventIds.set(req.key, ids);
  }

  for (const action of scenario.actions) {
    console.log(`[selfhost] ${scenario.id}: ${action.type}`);
    if (action.type === "wait") await sleep(action.ms);
    if (action.type === "reply") {
      await inngest.send(guideReplied.create({ requestId: requestIds.get(action.key)!, answer: action.answer }));
    }
    if (action.type === "stopWorker") await worker.stop();
    if (action.type === "startWorker") await worker.start();
    if (action.type === "restartServer") console.log(`[selfhost] server healthy after ${await stack.restartServer()}ms`);
    if (action.type === "killServer") console.log(`[selfhost] server healthy after ${await stack.killServer()}ms`);
  }

  const results: RequestResult[] = [];
  for (const req of scenario.requests) {
    const requestId = requestIds.get(req.key)!;
    let runs: RunSummary[] = [];
    let outcomes: string[] = [];
    while (Date.now() - started < scenario.deadlineMs) {
      const runIds = new Set((await Promise.all(eventIds.get(req.key)!.map((id) => listRunIdsForEvent(id).catch(() => [])))).flat());
      runs = await Promise.all([...runIds].map((id) => getRun(id)));
      outcomes = outcomesFor(await readStepLog(config.stepLogPath), requestId);
      if (outcomes.length > 0 && runs.length > 0 && runs.every((r) => isTerminal(r.status))) break;
      await sleep(config.pollIntervalMs);
    }
    const log = await readStepLog(config.stepLogPath);
    const expected = scenario.expect[req.key];
    const result = {
      scenario: scenario.id,
      key: req.key,
      runStatus: runs.map((r) => r.status).join(",") || "none",
      outcome: outcomes.join(",") || "-",
      notifyCount: countSteps(log, requestId, "notify-guide"),
      runCount: runs.length,
      ms: Date.now() - started,
    };
    const pass =
      result.outcome === expected.status &&
      result.notifyCount === expected.notifyCount &&
      (expected.runCount === undefined || result.runCount === expected.runCount);
    results.push({ ...result, pass });
  }
  return results;
}

async function main() {
  await rm(config.stepLogPath, { force: true });
  const all: (RequestResult & { stack: StackName })[] = [];

  for (const stackName of stacks) {
    const stack = createStack(stackName);
    const worker = createWorkerProcess();
    console.log(`[selfhost] ${stackName}: server healthy after ${await stack.up()}ms`);
    await worker.start();
    console.log(`[selfhost] sync`, await worker.sync());
    await sleep(2000);
    try {
      for (const scenario of scenarios) {
        const results = await runScenario(scenario, stack, worker);
        for (const r of results) {
          all.push({ ...r, stack: stackName });
          console.log(`[selfhost] ${stackName} ${r.scenario}/${r.key}: ${r.pass ? "PASS" : "FAIL"} ${JSON.stringify(r)}`);
        }
      }
    } finally {
      await worker.stop();
      if (!process.env.SELFHOST_KEEP) stack.down();
    }
  }

  console.log("\n| stack | scenario | key | run status | outcome | notify | runs | ms | result |");
  console.log("|---|---|---|---|---|---|---|---|---|");
  for (const r of all) {
    console.log(`| ${r.stack} | ${r.scenario} | ${r.key} | ${r.runStatus} | ${r.outcome} | ${r.notifyCount} | ${r.runCount} | ${r.ms} | ${r.pass ? "PASS" : "FAIL"} |`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
