import { tool, type ToolSet } from "ai";
import { z } from "zod";

import type { Fixtures } from "./fixtures.js";

export interface ToolTrace {
  tool: string;
  input: unknown;
}

export function buildTools(fixtures: Fixtures, trace: ToolTrace[]): ToolSet {
  return {
    get_today: tool({
      description:
        "Get today's logged meals, running macro totals and the user's daily targets.",
      inputSchema: z.object({}),
      execute: async () => {
        trace.push({ tool: "get_today", input: {} });
        const totals = fixtures.todayMeals.reduce(
          (acc, meal) => ({
            protein_g: acc.protein_g + meal.protein_g,
            fat_g: acc.fat_g + meal.fat_g,
            carbs_g: acc.carbs_g + meal.carbs_g,
          }),
          { protein_g: 0, fat_g: 0, carbs_g: 0 },
        );
        return { meals: fixtures.todayMeals, totals, targets: fixtures.targets };
      },
    }),
    search_catalog: tool({
      description:
        "Search the user's saved food catalog by name. Returns matching items with macros.",
      inputSchema: z.object({ query: z.string().min(1) }),
      execute: async ({ query }) => {
        trace.push({ tool: "search_catalog", input: { query } });
        const q = query.toLowerCase();
        return {
          items: fixtures.catalog.filter((item) =>
            item.name.toLowerCase().includes(q),
          ),
        };
      },
    }),
    log_meal: tool({
      description:
        "Log a meal for the user. Use exact macros from the catalog item or from the user's message, never invented ones.",
      inputSchema: z.object({
        name: z.string().min(1),
        category: z.enum(["breakfast", "lunch", "snack", "dinner"]),
        protein_g: z.number().min(0),
        fat_g: z.number().min(0),
        carbs_g: z.number().min(0),
      }),
      execute: async (input) => {
        trace.push({ tool: "log_meal", input });
        return { logged: true, meal: input };
      },
    }),
    get_workouts: tool({
      description: "Get the user's recent workouts with exercises and top sets.",
      inputSchema: z.object({
        days: z.number().int().min(1).max(30).describe("How many days back to look"),
      }),
      execute: async ({ days }) => {
        trace.push({ tool: "get_workouts", input: { days } });
        return { workouts: fixtures.workouts };
      },
    }),
  };
}
