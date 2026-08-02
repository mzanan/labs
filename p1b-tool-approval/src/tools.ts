import { tool, type ToolSet } from "ai";
import { z } from "zod";

export interface WriteLog {
  logged: { name: string; category: string; protein_g: number }[];
}

export const CATALOG = [
  { name: "Pollo Avo (breast + avocado salad)", protein_g: 45, fat_g: 20, carbs_g: 12 },
  { name: "Bep An (chicken + salad)", protein_g: 44, fat_g: 8, carbs_g: 15 },
];

export function buildTools(writes: WriteLog): ToolSet {
  return {
    search_catalog: tool({
      description:
        "Search the user's saved food catalog. Pass every term worth trying in one call.",
      inputSchema: z.object({ queries: z.array(z.string().min(1)).min(1) }),
      execute: async ({ queries }: { queries: string[] }) => {
        const terms = queries.map((q) => q.toLowerCase());
        const items = CATALOG.filter((item) =>
          terms.some((t) => item.name.toLowerCase().includes(t)),
        );
        return { items: items.length ? items : CATALOG };
      },
    }),
    log_meal: tool({
      description:
        "Log a meal for the user. Use exact macros from the catalog or from the user's message, never invented ones.",
      inputSchema: z.object({
        name: z.string().min(1),
        category: z.enum(["breakfast", "lunch", "snack", "dinner"]),
        protein_g: z.number().min(0),
        fat_g: z.number().min(0),
        carbs_g: z.number().min(0),
      }),
      execute: async (input: {
        name: string;
        category: string;
        protein_g: number;
      }) => {
        writes.logged.push({
          name: input.name,
          category: input.category,
          protein_g: input.protein_g,
        });
        return { logged: true };
      },
    }),
  };
}
