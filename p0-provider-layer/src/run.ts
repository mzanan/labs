import { readFileSync } from "node:fs";
import { resolveAll, isProviderId, type ModelRef, type ResolvedModel } from "./providers.js";
import { CHECKS, type CheckResult } from "./checks.js";
import { loadCapabilities, loadEndpoints, summarize } from "./capabilities.js";

const PAUSE_MS = Number(process.env.PAUSE_MS ?? 20000);
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
    const result = await check({
      languageModel: model.languageModel,
      providerOptions: model.providerOptions,
    });
    results.push(result);
    const mark = { pass: "PASS", fail: "FAIL", blocked: "BLKD" }[result.outcome];
    const servedBySuffix = result.servedBy ? `  served by ${result.servedBy}` : "";
    console.log(`  ${mark}  ${result.name.padEnd(16)} ${result.ms}ms  ${result.detail}${servedBySuffix}`);
    await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
  }
  return { model, results };
}

function printTable(rows: Row[]) {
  const checkNames = rows[0]?.results.map((r) => r.name) ?? [];
  const width = Math.max(...rows.map((r) => r.model.label.length));

  console.log("\n\nSummary\n");
  console.log(
    "model".padEnd(width) + "  " + checkNames.map((n) => n.padEnd(16)).join("") + "served by",
  );
  for (const row of rows) {
    const cells = row.results
      .map((r) => ({ pass: "PASS", fail: "FAIL", blocked: "BLOCKED" })[r.outcome].padEnd(16))
      .join("");
    const servedBy = [...new Set(row.results.map((r) => r.servedBy).filter(Boolean))].join(",");
    console.log(row.model.label.padEnd(width) + "  " + cells + servedBy);
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
  const declaringProviders = [
    ...new Set(rows.filter((r) => r.model.spec.declaresCapabilities).map((r) => r.model.spec.id)),
  ];

  for (const providerId of declaringProviders) {
    const providerRows = rows.filter((row) => row.model.spec.id === providerId);
    const apiKey = process.env[providerRows[0].model.spec.envVar];
    if (!apiKey && providerId === "openrouter") continue;

    let caps;
    try {
      caps = await loadCapabilities(providerId, apiKey ?? "");
    } catch (error) {
      console.log(`\nCapability catalogue unavailable for ${providerId}: ${(error as Error).message}`);
      continue;
    }

    const stats = summarize(caps);
    console.log(
      `\n\n[${providerId}] Declared capabilities from the provider's own catalogue: ${stats.total} models, ${stats.withTools} declare tool use, ${stats.withStructured} declare structured output.`,
    );
    console.log(`[${providerId}] Does the catalogue predict what actually happened?\n`);

    let agree = 0;
    let checked = 0;
    for (const row of providerRows) {
      const declared = caps.get(row.model.ref.model);
      if (!declared) continue;

      for (const [capability, name] of [
        ["tools", "tool call"],
        ["structured", "structured JSON"],
      ] as const) {
        const measured = row.results.find((r) => r.name === name);
        if (!measured || measured.outcome === "blocked") continue;
        const says = declared[capability];
        if (says === null) {
          console.log(`  not declared  ${row.model.ref.model} ${name}: catalogue has no ${capability} field`);
          continue;
        }
        const did = measured.outcome === "pass";
        checked += 1;
        if (says === did) agree += 1;
        console.log(
          `  ${(says === did ? "matches" : "MISMATCH").padEnd(9)} ${row.model.ref.model} ${name}: declared ${says}, measured ${did}`,
        );
      }
    }
    if (checked > 0) {
      console.log(`\n  [${providerId}] ${agree}/${checked} predictions correct.`);
    }

    for (const row of providerRows) {
      if (!row.model.ref.routeOnly) continue;
      let endpoints;
      try {
        endpoints = await loadEndpoints(providerId, row.model.ref.model, apiKey);
      } catch (error) {
        console.log(`\n  endpoints unavailable for ${row.model.ref.model}: ${(error as Error).message}`);
        continue;
      }
      const measured = row.results.find((r) => r.name === "tool call");
      if (!measured || measured.outcome === "blocked") continue;
      const did = measured.outcome === "pass";
      for (const pinned of row.model.ref.routeOnly) {
        const endpoint = endpoints.find((e) => e.providerName === pinned.toLowerCase());
        if (!endpoint) {
          console.log(`  ${row.model.label}: no endpoint found for provider "${pinned}"`);
          continue;
        }
        console.log(
          `  endpoint check  ${row.model.label}  declared by endpoint ${pinned}: tools ${endpoint.tools}, measured ${did}`,
        );
      }
    }
  }
}

function printGatewayCost(rows: Row[]) {
  const gatewayResults = rows
    .filter((row) => row.model.spec.id === "gateway")
    .flatMap((row) => row.results);
  const total = gatewayResults.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
  const withCost = gatewayResults.filter((r) => r.costUsd !== undefined).length;
  console.log(
    `\nGateway cost this run: $${total.toFixed(8)} (${withCost}/${gatewayResults.length} calls reported cost)`,
  );
  return total;
}

async function printSideBySide(rows: Row[], gatewayCost: number) {
  const gatewayRows = rows.filter((r) => r.model.spec.id === "gateway");
  const servedByExposed = gatewayRows.some((r) => r.results.some((res) => res.servedBy));

  let gatewayEndpointCount: number | undefined;
  const unpinnedGatewayRow = rows.find(
    (r) => r.model.spec.id === "gateway" && !r.model.ref.routeOnly && r.model.ref.model === "openai/gpt-oss-120b",
  );
  if (unpinnedGatewayRow) {
    try {
      const endpoints = await loadEndpoints("gateway", unpinnedGatewayRow.model.ref.model);
      gatewayEndpointCount = endpoints.length;
    } catch {
      gatewayEndpointCount = undefined;
    }
  }

  console.log("\n\nSide by side: OpenRouter vs Vercel AI Gateway\n");
  const lines = [
    ["per-request key", "yes (BYOK, no gateway env var)", "yes (createGateway({ apiKey }))"],
    ["catalogue declares tools", "yes (supported_parameters)", "yes (tags includes tool-use)"],
    ["catalogue declares structured output", "yes (structured_outputs)", "no (no model-level field)"],
    ["per-model endpoints listing", "yes", "yes"],
    ["routing pin API", "model-creation: provider.only", "call-time: providerOptions.gateway.only"],
    ["served-by exposed", "no", servedByExposed ? "yes (providerMetadata.gateway.routing.finalProvider)" : "not observed this run"],
    [
      "providers serving gpt-oss-120b",
      "19 (round 3, 5 without tools)",
      gatewayEndpointCount !== undefined ? `${gatewayEndpointCount} (this run)` : "not measured this run",
    ],
    ["cost this run", "not re-measured this run", `$${gatewayCost.toFixed(8)} (from providerMetadata.gateway.cost)`],
    ["markup", "5.5% on credit purchase (vendor page)", "0% on provider price (vendor page)"],
  ];
  const col0 = Math.max(...lines.map((l) => l[0].length));
  for (const [prop, or, gw] of lines) {
    console.log(`  ${prop.padEnd(col0)}  openrouter: ${or}  |  gateway: ${gw}`);
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
    const gatewayCost = printGatewayCost(rows);
    await printSideBySide(rows, gatewayCost);
  } else {
    console.log(`\nNeed at least two models to compare. Check ${CANDIDATES_FILE} and your keys.`);
  }
}

main();
