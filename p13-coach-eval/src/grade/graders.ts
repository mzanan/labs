import type { GraderName, Lang, MealExpectation, TurnExpectation, ValueCheck } from "../scenarios/types";
import { claimsSave, detectLanguage, isGenericError } from "./replyText";
import { domainChanges, tablesOf, type WriteChange } from "./writes";

export interface CatalogEntry {
  id: string;
  name: string;
  place: string | null;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
}

export interface MealState {
  name: string;
  category: string;
  catalog_item_id: string | null;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
}

export interface TurnObservation {
  expect: TurnExpectation;
  lang: Lang;
  fullText: string;
  modelText: string;
  writes: WriteChange[];
  toolNames: string[];
  mealsToday: MealState[];
  missingAutoMeals: string[];
  resolveItem: (expectation: MealExpectation) => CatalogEntry | undefined;
  engineError?: string;
}

export interface GraderVerdict {
  pass: boolean;
  notes: string[];
}

export type TurnGrades = Record<GraderName, GraderVerdict>;

const SINGLE_ROW_TABLES = ["fatigue_logs", "body_measurements"];

const MACRO_TOLERANCE = 0.06;

function near(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= Math.max(1, Math.abs(expected) * MACRO_TOLERANCE);
}

function verdict(notes: string[]): GraderVerdict {
  return { pass: notes.length === 0, notes };
}

function mealMatches(meal: MealState, expectation: MealExpectation, item: CatalogEntry | undefined): boolean {
  if (expectation.category && meal.category !== expectation.category) return false;
  if (expectation.namePattern) {
    return meal.catalog_item_id === null && new RegExp(expectation.namePattern, "i").test(meal.name);
  }
  if (!item || meal.catalog_item_id !== item.id) return false;
  const portions = expectation.portions ?? 1;
  return (
    near(meal.protein_g, item.protein_g * portions) &&
    near(meal.fat_g, item.fat_g * portions) &&
    near(meal.carbs_g, item.carbs_g * portions)
  );
}

function describeMeal(meal: MealState): string {
  return `${meal.name} [${meal.category}] ${meal.protein_g}p/${meal.fat_g}f/${meal.carbs_g}c${meal.catalog_item_id ? "" : " (estimated)"}`;
}

function mealNotes(observation: TurnObservation, expected: MealExpectation[]): string[] {
  const remaining = [...observation.mealsToday];
  const notes: string[] = [];
  for (const expectation of expected) {
    const item = expectation.item ? observation.resolveItem(expectation) : undefined;
    if (expectation.item && !item) notes.push(`fixture: catalog item not found ${expectation.item.name}`);
    const index = remaining.findIndex((meal) => mealMatches(meal, expectation, item));
    if (index === -1) {
      const label = expectation.item?.name ?? `/${expectation.namePattern}/`;
      notes.push(`missing meal ${label} x${expectation.portions ?? 1}${expectation.category ? ` [${expectation.category}]` : ""}`);
    } else {
      remaining.splice(index, 1);
    }
  }
  for (const meal of remaining) notes.push(`unexpected meal row ${describeMeal(meal)}`);
  return notes;
}

function valueMatches(change: WriteChange, check: ValueCheck): boolean {
  const value = change.after?.[check.field];
  if (typeof check.equals === "number") return typeof value === "number" && Math.abs(value - check.equals) < 0.01;
  return value === check.equals;
}

export function gradeState(observation: TurnObservation): GraderVerdict {
  const { expect } = observation;
  const domain = domainChanges(observation.writes);
  const changed = tablesOf(domain);
  const notes: string[] = [];
  if (expect.meals) notes.push(...mealNotes(observation, expect.meals));
  for (const name of observation.missingAutoMeals) notes.push(`auto-logged meal removed: ${name}`);
  const permitted = new Set<string>([...(expect.required ?? []), ...(expect.allowed ?? []), ...(expect.meals ? ["meals"] : [])]);
  for (const table of expect.required ?? []) {
    if (!changed.has(table)) notes.push(`no write to ${table}`);
  }
  for (const table of changed) {
    if (!permitted.has(table)) notes.push(`unrequested write to ${table}`);
  }
  for (const table of SINGLE_ROW_TABLES) {
    const inserts = domain.filter((change) => change.table === table && change.op === "insert").length;
    if (inserts > 1) notes.push(`duplicate rows in ${table} (${inserts})`);
  }
  for (const check of expect.values ?? []) {
    if (!domain.some((change) => change.table === check.table && valueMatches(change, check))) {
      notes.push(`${check.table}.${check.field} != ${check.equals}`);
    }
  }
  return verdict(notes);
}

export function gradeTrace(observation: TurnObservation): GraderVerdict {
  const { expect, toolNames } = observation;
  const called = new Set(toolNames);
  const notes: string[] = [];
  for (const tool of expect.tools ?? []) {
    if (!called.has(tool)) notes.push(`expected tool ${tool} not called`);
  }
  if (expect.anyTool?.length && !expect.anyTool.some((tool) => called.has(tool))) {
    notes.push(`none of ${expect.anyTool.join("/")} called`);
  }
  for (const tool of expect.forbidTools ?? []) {
    if (called.has(tool)) notes.push(`forbidden tool ${tool} called`);
  }
  const ruleExpected =
    expect.tools?.includes("update_rule") || expect.anyTool?.includes("update_rule") || expect.allowed?.includes("user_rules");
  if (called.has("update_rule") && !ruleExpected) notes.push("update_rule misuse");
  return verdict(notes);
}

export function wroteDomain(observation: TurnObservation): boolean {
  return domainChanges(observation.writes).length > 0;
}

export function gradeFalseClaim(observation: TurnObservation): GraderVerdict {
  if (wroteDomain(observation) || !claimsSave(observation.modelText)) return verdict([]);
  return verdict(["reply claims a save but nothing was written this turn"]);
}

export function gradeLanguage(observation: TurnObservation): GraderVerdict {
  const detected = detectLanguage(observation.modelText);
  if (!detected || detected === observation.lang) return verdict([]);
  return verdict([`reply in ${detected}, user wrote ${observation.lang} (heuristic)`]);
}

export function gradeError(observation: TurnObservation): GraderVerdict {
  if (observation.engineError) return verdict([`engine threw: ${observation.engineError}`]);
  if (isGenericError(observation.fullText)) return verdict(["generic error, empty or stopped reply"]);
  return verdict([]);
}

export function gradeTurn(observation: TurnObservation): TurnGrades {
  return {
    state: gradeState(observation),
    trace: gradeTrace(observation),
    falseClaim: gradeFalseClaim(observation),
    language: gradeLanguage(observation),
    error: gradeError(observation),
  };
}

const ALL_GRADERS: GraderName[] = ["state", "trace", "falseClaim", "language", "error"];

export function turnPassed(grades: TurnGrades, expect: TurnExpectation): boolean {
  return (expect.gradeOnly ?? ALL_GRADERS).every((name) => grades[name].pass);
}

export function unrequestedWriteCount(observation: TurnObservation): number {
  const { expect } = observation;
  const permitted = new Set<string>([...(expect.required ?? []), ...(expect.allowed ?? []), ...(expect.meals ? ["meals"] : [])]);
  const rows = domainChanges(observation.writes).filter((change) => !permitted.has(change.table));
  return new Set(rows.map((change) => `${change.table}:${change.rowId}`)).size;
}
