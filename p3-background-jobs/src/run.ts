import scenarios from "../fixtures/scenarios.json";
import { readNdjson } from "@/lib/ndjson";

const LAB_URL = process.env.LAB_URL;
const LAB_SECRET = process.env.LAB_SECRET;

if (!LAB_URL || !LAB_SECRET) {
  throw new Error("LAB_URL and LAB_SECRET must be set in .env");
}

interface Scenario {
  id: string;
  kind: "direct" | "extract" | "sleep";
  sources: string[];
  fault: { chunk: number; kind: "retryable" | "schema" } | null;
  dryRun: boolean;
  disconnectAfterMs: number | null;
  repeat: number;
  cancelAfterMs?: number;
  sleepMinutes?: number;
  expect: string;
}

interface DoneEvent {
  type: "done";
  extraction: { meals: unknown[]; notes: string[] };
}

interface ProgressEvent {
  type: "progress";
}

type StreamEvent = DoneEvent | ProgressEvent | { type: "error"; message: string };

function headers(json = true) {
  const base: Record<string, string> = { authorization: `Bearer ${LAB_SECRET}` };
  if (json) base["content-type"] = "application/json";
  return base;
}

async function runDirect(scenario: Scenario) {
  const started = Date.now();
  const controller = new AbortController();
  if (scenario.disconnectAfterMs != null) {
    setTimeout(() => controller.abort(), scenario.disconnectAfterMs);
  }
  let meals = 0;
  const notes: string[] = [];
  let aborted = false;
  try {
    const res = await fetch(`${LAB_URL}/api/extract/direct`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ scenario: scenario.id }),
      signal: controller.signal,
    });
    for await (const event of readNdjson<StreamEvent>(res.body!)) {
      if (event.type === "done") {
        meals = event.extraction.meals.length;
        notes.push(...event.extraction.notes);
      }
    }
  } catch (error) {
    aborted = error instanceof Error && error.name === "AbortError";
    if (!aborted) throw error;
  }
  const wallMs = Date.now() - started;
  return {
    scenario: scenario.id,
    runId: "-",
    status: aborted ? "aborted-client-side" : "completed",
    meals,
    warnings: notes,
    wallMs,
    reconnectOk: null as boolean | null,
  };
}

async function pollStatus(runId: string, maxMs = 6 * 60_000) {
  const start = Date.now();
  for (;;) {
    const res = await fetch(`${LAB_URL}/api/extract/status/${runId}`, { headers: headers(false) });
    const data = (await res.json()) as { status: string; returnValue: unknown; error: string | null };
    if (["completed", "failed", "cancelled"].includes(data.status)) return data;
    if (Date.now() - start > maxMs) return data;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

async function runWorkflow(scenario: Scenario) {
  const started = Date.now();
  const startRes = await fetch(`${LAB_URL}/api/extract/start`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ scenario: scenario.id }),
  });
  if (!startRes.ok) {
    const text = await startRes.text();
    return {
      scenario: scenario.id,
      runId: "-",
      status: `start-failed: ${text}`,
      meals: 0,
      warnings: [],
      wallMs: Date.now() - started,
      reconnectOk: null as boolean | null,
    };
  }
  const { runId } = (await startRes.json()) as { runId: string };

  if (scenario.disconnectAfterMs != null) {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), scenario.disconnectAfterMs);
    try {
      const streamRes = await fetch(`${LAB_URL}/api/extract/stream/${runId}`, {
        headers: headers(false),
        signal: controller.signal,
      });
      for await (const _event of readNdjson(streamRes.body!)) {
        void _event;
      }
    } catch {
      void 0;
    }
  }

  if (scenario.cancelAfterMs != null) {
    await new Promise((resolve) => setTimeout(resolve, scenario.cancelAfterMs));
    await fetch(`${LAB_URL}/api/extract/cancel/${runId}`, { method: "POST", headers: headers(false) });
  }

  const result = await pollStatus(runId);
  const wallMs = Date.now() - started;
  const extraction = result.returnValue as { meals: unknown[]; notes: string[] } | null;

  let reconnectOk: boolean | null = null;
  if (scenario.id === "workflow-reconnect" && result.status === "completed") {
    const reconnectRes = await fetch(`${LAB_URL}/api/extract/stream/${runId}?startIndex=0`, {
      headers: headers(false),
    });
    let progress = 0;
    let done = 0;
    for await (const event of readNdjson<StreamEvent>(reconnectRes.body!)) {
      if (event.type === "progress") progress += 1;
      if (event.type === "done") done += 1;
    }
    reconnectOk = progress === 3 && done === 1;
  }

  return {
    scenario: scenario.id,
    runId,
    status: result.error ? `${result.status}: ${result.error}` : result.status,
    meals: extraction?.meals?.length ?? 0,
    warnings: extraction?.notes ?? [],
    wallMs,
    reconnectOk,
  };
}

async function main() {
  const filter = process.argv[2];
  const list = (scenarios as Scenario[]).filter((s) => !filter || s.id === filter);
  const rows = [];
  for (const scenario of list) {
    console.log(`running ${scenario.id}...`);
    const row = scenario.kind === "direct" ? await runDirect(scenario) : await runWorkflow(scenario);
    rows.push(row);
    console.log(JSON.stringify(row));
  }

  console.log("\n| scenario | run id | status | meals | warnings | wall ms | reconnect ok |");
  console.log("|---|---|---|---|---|---|---|");
  for (const row of rows) {
    console.log(
      `| ${row.scenario} | ${row.runId} | ${row.status} | ${row.meals} | ${row.warnings.length} | ${row.wallMs} | ${row.reconnectOk ?? "-"} |`,
    );
  }
}

main();
