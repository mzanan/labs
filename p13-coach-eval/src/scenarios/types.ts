import type { MealCategoryKey } from "@/lib/constants";

export type Job = "J1" | "J2" | "J3" | "J4" | "J5" | "J6" | "J9";

export type Lang = "es" | "en";

export type GraderName = "state" | "trace" | "falseClaim" | "language" | "error";

export type DomainTable =
  | "meals"
  | "workouts"
  | "workout_exercises"
  | "workout_sets"
  | "fatigue_logs"
  | "body_measurements"
  | "body_scans"
  | "days"
  | "user_rules"
  | "plans"
  | "profiles"
  | "catalog_items"
  | "catalog_components"
  | "routine_versions"
  | "routine_exercises"
  | "routine_slots";

export interface ItemRef {
  name: string;
  place?: string;
}

export interface MealExpectation {
  item?: ItemRef;
  namePattern?: string;
  portions?: number;
  category?: MealCategoryKey;
}

export interface ValueCheck {
  table: DomainTable;
  field: string;
  equals: number | string;
}

export interface TurnExpectation {
  meals?: MealExpectation[];
  required?: DomainTable[];
  allowed?: DomainTable[];
  values?: ValueCheck[];
  tools?: string[];
  anyTool?: string[];
  forbidTools?: string[];
  gradeOnly?: GraderName[];
}

export interface ScenarioTurn {
  user: string;
  expect: TurnExpectation;
}

export interface SeedMeal {
  item: ItemRef;
  category: MealCategoryKey;
  dayOffset: number;
  portions?: number;
}

export interface Scenario {
  id: string;
  job: Job;
  lang: Lang;
  title: string;
  seed?: { meals?: SeedMeal[] };
  turns: ScenarioTurn[];
}
