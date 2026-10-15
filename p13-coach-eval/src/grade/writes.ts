import type { DomainTable } from "../scenarios/types";

export interface WriteChange {
  id: number;
  table: string;
  op: string;
  source: string;
  rowId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

const DOMAIN_TABLES: ReadonlySet<string> = new Set<DomainTable>([
  "meals",
  "workouts",
  "workout_exercises",
  "workout_sets",
  "fatigue_logs",
  "body_measurements",
  "body_scans",
  "days",
  "user_rules",
  "plans",
  "profiles",
  "catalog_items",
  "catalog_components",
  "routine_versions",
  "routine_exercises",
  "routine_slots",
]);

export const MEMORY_TABLES: ReadonlySet<string> = new Set(["coach_facts", "user_facts", "health_events", "pending_items"]);

const PROFILE_TARGET_FIELDS = [
  "protein_target",
  "fat_min",
  "fat_max",
  "fat_floor",
  "carbs_gym",
  "carbs_rest",
  "calories_target",
  "calories_rest",
  "coach_rules",
  "dining_mode",
];

function changedFields(change: WriteChange): string[] {
  const keys = new Set([...Object.keys(change.before ?? {}), ...Object.keys(change.after ?? {})]);
  return [...keys].filter((key) => JSON.stringify(change.before?.[key]) !== JSON.stringify(change.after?.[key]));
}

function isIncidental(change: WriteChange): boolean {
  if (change.table === "days") return change.op === "insert" && change.after?.steps == null && change.after?.closed_at == null;
  if (change.table === "profiles") return !changedFields(change).some((field) => PROFILE_TARGET_FIELDS.includes(field));
  return false;
}

export function domainChanges(changes: WriteChange[]): WriteChange[] {
  return changes.filter((change) => DOMAIN_TABLES.has(change.table) && !isIncidental(change));
}

export function memoryChanges(changes: WriteChange[]): WriteChange[] {
  return changes.filter((change) => MEMORY_TABLES.has(change.table));
}

export function tablesOf(changes: WriteChange[]): Set<string> {
  return new Set(changes.map((change) => change.table));
}
