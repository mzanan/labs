import type { ToolTrace } from "./tools.js";

export interface Scenario {
  id: string;
  prompt: string;
  expectTools: string[];
  forbidTools: string[];
  checkArgs?: (trace: ToolTrace[]) => string | null;
}

function loggedMeal(trace: ToolTrace[]): Record<string, unknown> | null {
  const call = trace.find((t) => t.tool === "log_meal");
  return call ? (call.input as Record<string, unknown>) : null;
}

export const SCENARIOS: Scenario[] = [
  {
    id: "single-read",
    prompt: "How much protein do I have left for today?",
    expectTools: ["get_today"],
    forbidTools: ["log_meal"],
  },
  {
    id: "chain-search-log",
    prompt: "Find the grilled chicken in my catalog and log it as lunch.",
    expectTools: ["search_catalog", "log_meal"],
    forbidTools: [],
    checkArgs: (trace) => {
      const meal = loggedMeal(trace);
      if (!meal) return "log_meal never called";
      if (meal.category !== "lunch") return `category ${String(meal.category)} != lunch`;
      if (meal.protein_g !== 62 || meal.fat_g !== 8 || meal.carbs_g !== 0) {
        return `macros ${String(meal.protein_g)}/${String(meal.fat_g)}/${String(meal.carbs_g)} != catalog 62/8/0`;
      }
      return null;
    },
  },
  {
    id: "no-tool-smalltalk",
    prompt: "hola",
    expectTools: [],
    forbidTools: ["log_meal", "search_catalog", "get_workouts"],
  },
  {
    id: "multi-read",
    prompt: "Did I eat enough protein today compared to what I trained in my last workout?",
    expectTools: ["get_today", "get_workouts"],
    forbidTools: ["log_meal"],
  },
  {
    id: "write-exact-args",
    prompt:
      "Log 200g of grilled salmon for dinner: 40g protein, 25g fat, 0g carbs.",
    expectTools: ["log_meal"],
    forbidTools: [],
    checkArgs: (trace) => {
      const meal = loggedMeal(trace);
      if (!meal) return "log_meal never called";
      if (meal.category !== "dinner") return `category ${String(meal.category)} != dinner`;
      if (meal.protein_g !== 40 || meal.fat_g !== 25 || meal.carbs_g !== 0) {
        return `macros ${String(meal.protein_g)}/${String(meal.fat_g)}/${String(meal.carbs_g)} != stated 40/25/0`;
      }
      return null;
    },
  },
];
