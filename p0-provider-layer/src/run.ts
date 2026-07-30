import { CANDIDATES, keyFor, type Candidate } from "./providers.js";
import { CHECKS, type CheckResult } from "./checks.js";
import { loadOpenRouterCapabilities, summarize } from "./capabilities.js";

const PAUSE_MS = Number(process.env.PAUSE_MS ?? 7000);

type Row = { candidate: Candidate; results: CheckResult[] };

async function runCandidate(candidate: Candidate): Promise<Row> {
  const apiKey = keyFor(candidate);
  const model = candidate.build(apiKey);

  console.log(`\n${candidate.label}  [${candidate.wireFormat}]`);
  const results: CheckResult[] = [];
  for (const check of CHECKS) {
    const result = await check(model);
    results.push(result);
    const mark = { pass: "PASS", fail: "FAIL", blocked: "BLKD" }[result.outcome];
    console.log(`  ${mark}  ${result.name.padEnd(16)} ${result.ms}ms  ${result.detail}`);
    await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
  }
  return { candidate, results };
}

function printTable(rows: Row[]) {
  const checkNames = rows[0]?.results.map((r) => r.name) ?? [];
  const width = Math.max(...rows.map((r) => r.candidate.label.length));

  console.log("\n\nSummary\n");
  console.log(
    "provider".padEnd(width) + "  " + checkNames.map((n) => n.padEnd(16)).join(""),
  );
  for (const row of rows) {
    const cells = row.results
      .map((r) => ({ pass: "PASS", fail: "FAIL", blocked: "BLOCKED" })[r.outcome].padEnd(16))
      .join("");
    console.log(row.candidate.label.padEnd(width) + "  " + cells);
  }

  const measurable = (name: string) =>
    rows
      .map((row) => row.results.find((r) => r.name === name))
      .filter((r) => r && r.outcome !== "blocked");

  const leaks = checkNames.filter((name) => {
    const seen = measurable(name).map((r) => r!.outcome);
    return new Set(seen).size > 1;
  });

  const unmeasured = checkNames.filter(
    (name) => measurable(name).length < rows.length,
  );

  console.log("");
  if (leaks.length === 0) {
    console.log("No divergence: every capability behaved the same on both wire formats.");
  } else {
    console.log(`ABSTRACTION LEAKS on: ${leaks.join(", ")}`);
    console.log("A capability passing on one provider and failing on the other is the finding.");
  }
  if (unmeasured.length > 0) {
    console.log(
      `\nNOT MEASURED on every provider (free-tier quota): ${unmeasured.join(", ")}. Re-run later before trusting these rows.`,
    );
  }
}

async function compareDeclaredVsMeasured(rows: Row[]) {
  const apiKey = process.env.OPENROUTER_API_KEY;
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
    `\n\nDeclared capabilities, straight from OpenRouter's own catalogue: ${stats.total} models, ${stats.withTools} declare tool use, ${stats.withStructured} declare structured output.`,
  );
  console.log("Does the catalogue predict what actually happened?\n");

  let agree = 0;
  let checked = 0;
  for (const row of rows) {
    const modelId = row.candidate.modelId;
    if (!modelId) continue;
    const declared = caps.get(modelId);
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
      const verdict = says === did ? "matches" : "MISMATCH";
      console.log(
        `  ${verdict.padEnd(9)} ${modelId} ${name}: declared ${says}, measured ${did}`,
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
  const rows: Row[] = [];
  for (const candidate of CANDIDATES) {
    try {
      rows.push(await runCandidate(candidate));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`\n${candidate.label}\n  SKIPPED  ${message}`);
    }
  }
  if (rows.length > 1) {
    printTable(rows);
    await compareDeclaredVsMeasured(rows);
  } else {
    console.log("\nNeed at least two providers to compare. Set both keys in .env");
  }
}

main();
