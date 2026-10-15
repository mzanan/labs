import { J1_SCENARIOS } from "./j1CatalogMeal";
import { J2_SCENARIOS } from "./j2OffCatalog";
import { J3_SCENARIOS } from "./j3Corrections";
import { J4_SCENARIOS } from "./j4OtherLogs";
import { J5_SCENARIOS } from "./j5Reads";
import { J6_SCENARIOS } from "./j6Memory";
import { J9_SCENARIOS } from "./j9Negatives";
import type { Job, Scenario } from "./types";

export const SCENARIOS: Scenario[] = [
  ...J1_SCENARIOS,
  ...J2_SCENARIOS,
  ...J3_SCENARIOS,
  ...J4_SCENARIOS,
  ...J5_SCENARIOS,
  ...J6_SCENARIOS,
  ...J9_SCENARIOS,
];

export const WRITE_JOBS: ReadonlySet<Job> = new Set(["J1", "J2", "J3", "J4"]);

export function selectScenarios(filter: string[]): Scenario[] {
  if (!filter.length) return SCENARIOS;
  return SCENARIOS.filter((scenario) => filter.some((term) => scenario.job === term || scenario.id === term || scenario.id.startsWith(term)));
}
