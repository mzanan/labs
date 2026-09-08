import { readFileSync } from "node:fs";
import { join } from "node:path";

import scenariosData from "../../fixtures/scenarios.json";

export interface ChunkFaultConfig {
  chunk: number;
  kind: "retryable" | "schema";
}

export interface Scenario {
  id: string;
  kind: "direct" | "extract" | "sleep";
  sources: string[];
  fault: ChunkFaultConfig | null;
  dryRun: boolean;
  disconnectAfterMs: number | null;
  repeat: number;
  cancelAfterMs?: number;
  sleepMinutes?: number;
  expect: string;
}

const scenarios = scenariosData as Scenario[];

export function getScenario(id: string): Scenario {
  const scenario = scenarios.find((entry) => entry.id === id);
  if (!scenario) throw new Error(`Unknown scenario: ${id}`);
  return scenario;
}

export function loadScenarioSources(scenario: Scenario): { name: string; text: string }[] {
  return scenario.sources.map((name) => {
    const raw = readFileSync(join(process.cwd(), "fixtures", name), "utf8");
    const text = raw.repeat(scenario.repeat || 1);
    return { name, text };
  });
}
