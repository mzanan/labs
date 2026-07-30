import { readFileSync } from "node:fs";
import { resolveAll, isProviderId, type ModelRef, type ResolvedModel } from "./providers.js";
import { CHECKS, type CheckResult } from "./checks.js";
import { loadOpenRouterCapabilities, summarize } from "./capabilities.js";

const PAUSE_MS = Number(process.env.PAUSE_MS ?? 7000);
const CANDIDATES_FILE = process.env.CANDIDATES_FILE ?? "candidates.json";

type Row = { model: ResolvedModel; results: CheckResult[] };

function loadCandidates(path: string): ModelRef[] {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${path} must contain an array`);

  return parsed.map((entry, index) => {
    const ref = entry as Partial<ModelRef>;
    if (typeof ref.provider !== "string" || !isProviderId(ref.provider)) {
      throw new Error(`${path}[${index}]: unknown provider "${ref.provider}"`);
    }
    if (typeof ref.model !== "string" || ref.model.length === 0) {
      throw new Error(`${path}[${index}]: missing model`);
    }
    return { provider: ref.provider, model: ref.model, label: ref.label, routeOnly: ref.routeOnly };
  });
}

async function runModel(model: ResolvedModel): Promise<Row> {
  console.log(`\n${model.label}  [${model.spec.wireFormat}]`);
  const results: CheckResult[] = [];
  for (const check of CHECKS) {
    const result = await check(model.languageModel);
    results.push(result);
    const mark = { pass: "PASS", fail: "FAIL", blocked: "BLKD" }[result.outcome];
    console.log(`  ${mark}  ${result.name.padEnd(16)} ${result.ms}ms  ${result.detail}`);
    await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
  }
  return { model, results };
}

function printTable(rows: Row[]) {
  const checkNames = rows[0]?.results.map((r) => r.name) ?? [];
  const width = Math.max(...rows.map((r) => r.model.label.length));

  console.log("\n\nSummary\n");
  console.log("model".padEnd(width) + "  " + checkNames.map((n) => n.padEnd(16)).join(""));
  for (const row of rows) {
    const cells = row.results
      .map((r) => ({ pass: "PASS", fail: "FAIL", blocked: "BLOCKED" })[r.outcome].padEnd(16))
      .join("");
    console.log(row.model.label.padEnd(width) + "  " + cells);
  }

  const measurable = (name: string) =>
    rows
      .map((row) => row.results.find((r) => r.name === name))
      .filter((r) => r && r.outcome !== "blocked");

  const leaks = checkNames.filter(
    (name) => new Set(measurable(name).map((r) => r!.outcome)).size > 1,
  );
  const unmeasured = checkNames.filter((name) => measurable(name).length < rows.length);

  console.log("");
  console.log(
    leaks.length === 0
      ? "No divergence: every capability behaved the same everywhere it was measured."
      : `DIVERGENCE on: ${leaks.join(", ")}. A capability passing on one model and failing on another is the finding.`,
  );
  if (unmeasured.length > 0) {
    console.log(
      `\nNOT MEASURED everywhere (quota or timeout): ${unmeasured.join(", ")}. Re-run before trusting those rows.`,
    );
  }
}

async function compareDeclaredVsMeasured(rows: Row[]) {
  const declaring = rows.filter((row) => row.model.spec.declaresCapabilities);
  if (declaring.length === 0) return;

  const apiKey = process.env[declaring[0].model.spec.envVar];
  if (!apiKey) return;

  let caps;
  try {
    caps = await loadOpenRouterCapabilities(apiKey);
  } catch (error) {
    console.log(`\nCapability catalogue unavailable: ${(error as Error).message}`);
    return;
  }

  const stats = summarize(caps);
  console.log(
    `\n\nDeclared capabilities from the provider's own catalogue: ${stats.total} models, ${stats.withTools} declare tool use, ${stats.withStructured} declare structured output.`,
  );
  console.log("Does the catalogue predict what actually happened?\n");

  let agree = 0;
  let checked = 0;
  for (const row of declaring) {
    const declared = caps.get(row.model.ref.model);
    if (!declared) continue;

    for (const [capability, name] of [
      ["tools", "tool call"],
      ["structured", "structured JSON"],
    ] as const) {
      const measured = row.results.find((r) => r.name === name);
      if (!measured || measured.outcome === "blocked") continue;
      const says = declared[capability];
      const did = measured.outcome === "pass";
      checked += 1;
      if (says === did) agree += 1;
      console.log(
        `  ${(says === did ? "matches" : "MISMATCH").padEnd(9)} ${row.model.ref.model} ${name}: declared ${says}, measured ${did}`,
      );
    }
  }
  if (checked > 0) {
    console.log(
      `\n  ${agree}/${checked} predictions correct. A capability registry can be READ from the gateway instead of hand-maintained.`,
    );
  }
}

async function main() {
  const { resolved, skipped } = resolveAll(loadCandidates(CANDIDATES_FILE));

  for (const { ref, reason } of skipped) {
    console.log(`\n${ref.label ?? ref.model}\n  SKIPPED  ${reason}`);
  }

  const rows: Row[] = [];
  for (const model of resolved) {
    rows.push(await runModel(model));
  }

  if (rows.length > 1) {
    printTable(rows);
    await compareDeclaredVsMeasured(rows);
  } else {
    console.log(`\nNeed at least two models to compare. Check ${CANDIDATES_FILE} and your keys.`);
  }
}

main();
