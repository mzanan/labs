import { ITEM } from "./catalogItems";
import type { Scenario } from "./types";

const WORKOUT_TABLES = ["workouts", "workout_exercises", "workout_sets"] as const;

export const J4_SCENARIOS: Scenario[] = [
  {
    id: "J4-01-fatigue-sleep",
    job: "J4",
    lang: "es",
    title: "Morning fatigue with sleep",
    turns: [
      {
        user: "dormí 7 horas en casa y me levanté con energía 4 de 5",
        expect: {
          tools: ["log_fatigue"],
          required: ["fatigue_logs"],
          values: [
            { table: "fatigue_logs", field: "sleep_hours", equals: 7 },
            { table: "fatigue_logs", field: "score", equals: 4 },
          ],
        },
      },
    ],
  },
  {
    id: "J4-02-workout-sets",
    job: "J4",
    lang: "es",
    title: "Workout session with sets",
    turns: [
      {
        user: "hoy en el gym hice press de banca 3 series de 10 con 60kg y sentadilla 3x8 con 80kg",
        expect: { tools: ["log_workout_session"], required: [...WORKOUT_TABLES] },
      },
    ],
  },
  {
    id: "J4-03-waist",
    job: "J4",
    lang: "es",
    title: "Waist measurement",
    turns: [
      {
        user: "me medí la cintura: 84 cm",
        expect: {
          tools: ["log_measurement"],
          required: ["body_measurements"],
          values: [
            { table: "body_measurements", field: "type", equals: "waist" },
            { table: "body_measurements", field: "value", equals: 84 },
          ],
        },
      },
    ],
  },
  {
    id: "J4-04-close-day",
    job: "J4",
    lang: "es",
    title: "Close the day with steps (card auto-approved)",
    turns: [
      {
        user: "cerrá el día, hoy hice 9500 pasos",
        expect: {
          tools: ["close_day"],
          required: ["days"],
          values: [{ table: "days", field: "steps", equals: 9500 }],
        },
      },
    ],
  },
  {
    id: "J4-05-meal-and-fatigue",
    job: "J4",
    lang: "es",
    title: "Multi-intent: meal plus fatigue",
    turns: [
      {
        user: "almorcé el shawarma de res y ahora estoy fundido, energía 2 de 5",
        expect: {
          tools: ["log_meal", "log_fatigue"],
          required: ["fatigue_logs"],
          meals: [{ item: ITEM.shawarmaRes, portions: 1, category: "lunch" }],
          values: [{ table: "fatigue_logs", field: "score", equals: 2 }],
        },
      },
    ],
  },
  {
    id: "J4-06-weight-english",
    job: "J4",
    lang: "en",
    title: "Weight measurement in English",
    turns: [
      {
        user: "My weight this morning was 78.4 kg, log it",
        expect: {
          tools: ["log_measurement"],
          required: ["body_measurements"],
          values: [
            { table: "body_measurements", field: "type", equals: "weight" },
            { table: "body_measurements", field: "value", equals: 78.4 },
          ],
        },
      },
    ],
  },
];
