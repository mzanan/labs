import { ITEM } from "./catalogItems";
import type { Scenario, SeedMeal } from "./types";

const SEEDED_DAY: SeedMeal[] = [
  { item: ITEM.desayunoGym, category: "breakfast", dayOffset: 0 },
  { item: ITEM.mesalaJazmin, category: "lunch", dayOffset: 0 },
];

const DAY_READS = ["get_today", "get_day_status"];

export const J5_SCENARIOS: Scenario[] = [
  {
    id: "J5-01-remaining",
    job: "J5",
    lang: "es",
    title: "How much is left today",
    seed: { meals: SEEDED_DAY },
    turns: [{ user: "cuánto me queda para hoy?", expect: { anyTool: DAY_READS } }],
  },
  {
    id: "J5-02-dinner-fit",
    job: "J5",
    lang: "es",
    title: "What can I have for dinner",
    seed: { meals: SEEDED_DAY },
    turns: [{ user: "qué puedo cenar?", expect: { anyTool: ["suggest_meals"] } }],
  },
  {
    id: "J5-03-training-today",
    job: "J5",
    lang: "es",
    title: "What do I train today",
    turns: [{ user: "qué entreno hoy?", expect: { anyTool: ["get_todays_routine"] } }],
  },
  {
    id: "J5-04-protein-left-english",
    job: "J5",
    lang: "en",
    title: "Protein left, in English",
    seed: { meals: SEEDED_DAY },
    turns: [{ user: "How much protein do I have left today?", expect: { anyTool: DAY_READS } }],
  },
  {
    id: "J5-05-day-status",
    job: "J5",
    lang: "es",
    title: "How is the day going",
    seed: { meals: SEEDED_DAY },
    turns: [{ user: "cómo vengo con el día?", expect: { anyTool: DAY_READS } }],
  },
];
