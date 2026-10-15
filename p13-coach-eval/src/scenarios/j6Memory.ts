import type { Scenario, TurnExpectation } from "./types";

const MEMORY_ONLY: TurnExpectation = {
  gradeOnly: ["state", "error"],
  allowed: ["user_rules", "profiles", "plans", "days", "body_measurements", "fatigue_logs"],
  forbidTools: ["log_meal", "log_estimated_meal", "log_workout_session"],
};

export const J6_SCENARIOS: Scenario[] = [
  {
    id: "J6-01-allergy",
    job: "J6",
    lang: "es",
    title: "Allergy statement",
    turns: [{ user: "te cuento que soy alérgico al maní", expect: MEMORY_ONLY }],
  },
  {
    id: "J6-02-injury",
    job: "J6",
    lang: "es",
    title: "Injury statement",
    turns: [
      {
        user: "me lesioné el hombro derecho, nada de press por encima de la cabeza por 3 semanas",
        expect: MEMORY_ONLY,
      },
    ],
  },
  {
    id: "J6-03-one-off-preference",
    job: "J6",
    lang: "es",
    title: "One-off preference",
    turns: [{ user: "hoy no tengo ganas de comida india", expect: MEMORY_ONLY }],
  },
];
