import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { measureBundle, type BundleCandidate, type BundleMeasurement } from "./bundleCost.ts";
import { measureRender, type RenderConfig, type ShaderScenario } from "./renderCost.ts";

interface Scenarios {
  readonly budget: { readonly heroGzipBytes: number; readonly frameBudgetMs: number };
  readonly shaders: readonly ShaderScenario[];
  readonly bundleCandidates: readonly BundleCandidate[];
  readonly render: RenderConfig;
}

const labDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const scenarios: Scenarios = JSON.parse(readFileSync(join(labDir, "scenarios.json"), "utf8"));

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;
const ms = (value: number) => `${value.toFixed(3)} ms`;

function versionOf(pkg: string): string {
  const meta = JSON.parse(readFileSync(join(labDir, "node_modules", pkg, "package.json"), "utf8"));
  return `${meta.name}@${meta.version}`;
}

console.log(`p4-shader-page-cost  ${new Date().toISOString()}`);
console.log(`node ${process.version}  ${versionOf("vgpu")}  ${versionOf("three")}  ${versionOf("esbuild")}`);

console.log(`\nBUNDLE  minified + gzipped, esbuild esm/es2022, hero budget ${kb(scenarios.budget.heroGzipBytes)} gzip`);
const bundles: BundleMeasurement[] = [];
for (const candidate of scenarios.bundleCandidates) {
  const measurement = await measureBundle(candidate, scenarios.shaders[0].source, labDir);
  bundles.push(measurement);
  const verdict = measurement.gzipBytes <= scenarios.budget.heroGzipBytes ? "within budget" : "over budget";
  console.log(`  ${candidate.id.padEnd(13)} ${kb(measurement.gzipBytes).padStart(9)} gzip  ${kb(measurement.minifiedBytes).padStart(9)} min  ${verdict}`);
  console.log(`  ${"".padEnd(13)} ${candidate.note}`);
}

const baseline = bundles.find((b) => b.id === "vgpu");
if (baseline) {
  for (const other of bundles.filter((b) => b.id !== "vgpu")) {
    console.log(`  ratio        ${other.id} is ${(other.gzipBytes / baseline.gzipBytes).toFixed(2)}x vgpu gzip (+${kb(other.gzipBytes - baseline.gzipBytes)})`);
  }
}

console.log(`\nRENDER  vgpu only, headless Dawn. ${scenarios.render.warmupFrames} warmup + ${scenarios.render.measuredFrames} measured frames per cell, frame budget ${ms(scenarios.budget.frameBudgetMs)}`);
const render = await measureRender(scenarios.shaders, scenarios.render);

if (!render.ran) {
  console.log(`  not measured: ${render.reason}`);
} else {
  console.log(`  adapter ${render.adapter} (${render.adapterType}), timestamp-query ${render.timestampQuery ? "on" : "off"}`);
  for (const resolution of scenarios.render.resolutions) {
    console.log(`  ${resolution.id}  ${resolution.width}x${resolution.height}`);
    for (const m of (render.measurements ?? []).filter((x) => x.resolutionId === resolution.id)) {
      const gpu = m.gpu
        ? `gpu p50 ${ms(m.gpu.medianMs)}  p95 ${ms(m.gpu.p95Ms)}  (${m.gpuSamples} samples)`
        : "gpu not sampled";
      const total = (m.gpu?.p95Ms ?? 0) + m.cpu.p95Ms;
      const share = ((total / scenarios.budget.frameBudgetMs) * 100).toFixed(1);
      console.log(`    ${m.shaderId.padEnd(10)} ${gpu}`);
      console.log(`    ${"".padEnd(10)} cpu encode+submit p50 ${ms(m.cpu.medianMs)}  p95 ${ms(m.cpu.p95Ms)}`);
      console.log(`    ${"".padEnd(10)} p95 total ${ms(total)} = ${share}% of the 60fps frame budget`);
    }
  }
  console.log("\n  Notes");
  for (const shader of scenarios.shaders) console.log(`    ${shader.id.padEnd(10)} ${shader.note}`);
}
