"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { insertResolvedMeal, resolveCatalogMeal } from "@/lib/catalogMeal";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { dayString, fatQuality, macroFields } from "@/lib/validation";
import { newId } from "@/lib/utils";

const { meals, catalog_items, catalog_components } = schema;

function anyOily(qualities: (string | null)[]): "clean" | "oily" | null {
  if (qualities.some((q) => q === "oily")) return "oily";
  if (qualities.some((q) => q === "clean")) return "clean";
  return null;
}

const fromCatalogSchema = z.object({
  itemId: z.string().min(1),
  category: z.string().min(1),
  day: dayString,
});

export async function addMealFromCatalog(input: unknown): Promise<string> {
  const user = await requireUser();
  const { itemId, category, day } = fromCatalogSchema.parse(input);

  const resolved = await resolveCatalogMeal(user.id, { itemId });
  if (!resolved.ok) {
    throw new Error(
      resolved.reason === "no_macros"
        ? "This item has no macros yet. Edit it in the catalog first."
        : resolved.error,
    );
  }

  const id = await insertResolvedMeal(user.id, resolved.meal, category, day);
  revalidatePath("/");
  return id;
}

const composableSchema = z.object({
  itemId: z.string().min(1),
  componentIds: z.array(z.string().min(1)).min(1),
  category: z.string().min(1),
  day: dayString,
  name: z.string().min(1).optional(),
});

export async function addComposableMeal(input: unknown) {
  const user = await requireUser();
  const { itemId, componentIds, category, day, name } =
    composableSchema.parse(input);

  const item = await db
    .select()
    .from(catalog_items)
    .where(and(eq(catalog_items.id, itemId), eq(catalog_items.user_id, user.id)))
    .limit(1);
  if (!item[0]) throw new Error("Catalog item not found");

  const comps = await db
    .select()
    .from(catalog_components)
    .where(
      and(
        eq(catalog_components.user_id, user.id),
        eq(catalog_components.item_id, itemId),
        inArray(catalog_components.id, componentIds),
      ),
    );
  if (!comps.length) throw new Error("No components selected");

  const totals = comps.reduce(
    (acc, c) => ({
      protein_g: acc.protein_g + c.protein_g,
      fat_g: acc.fat_g + c.fat_g,
      carbs_g: acc.carbs_g + c.carbs_g,
    }),
    { protein_g: 0, fat_g: 0, carbs_g: 0 },
  );

  await db.insert(meals).values({
    id: newId(),
    user_id: user.id,
    logical_day: day,
    category,
    name: name?.trim() || item[0].name,
    place: item[0].place,
    protein_g: totals.protein_g,
    fat_g: totals.fat_g,
    carbs_g: totals.carbs_g,
    fat_quality: anyOily(comps.map((c) => c.fat_quality)),
    catalog_item_id: item[0].id,
    created_at: new Date(),
  });
  revalidatePath("/");
}

const manualSchema = z.object({
  name: z.string().min(1),
  place: z.string().optional(),
  category: z.string().min(1),
  day: dayString,
  fat_quality: fatQuality.optional(),
  ...macroFields,
});

export async function addManualMeal(input: unknown) {
  const user = await requireUser();
  const data = manualSchema.parse(input);

  await db.insert(meals).values({
    id: newId(),
    user_id: user.id,
    logical_day: data.day,
    category: data.category,
    name: data.name.trim(),
    place: data.place?.trim() || null,
    protein_g: data.protein_g,
    fat_g: data.fat_g,
    carbs_g: data.carbs_g,
    fat_quality: data.fat_quality ?? null,
    catalog_item_id: null,
    created_at: new Date(),
  });
  revalidatePath("/");
}

const updateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  fat_quality: fatQuality.optional(),
  ...macroFields,
});

export async function updateMeal(input: unknown) {
  const user = await requireUser();
  const data = updateSchema.parse(input);

  await db
    .update(meals)
    .set({
      name: data.name.trim(),
      category: data.category,
      protein_g: data.protein_g,
      fat_g: data.fat_g,
      carbs_g: data.carbs_g,
      fat_quality: data.fat_quality ?? null,
    })
    .where(and(eq(meals.id, data.id), eq(meals.user_id, user.id)));
  revalidatePath("/");
}

const repeatSchema = z.object({
  mealId: z.string().min(1),
  category: z.string().min(1),
  day: dayString,
});

export async function repeatMeal(input: unknown): Promise<string> {
  const user = await requireUser();
  const { mealId, category, day } = repeatSchema.parse(input);

  const source = await db
    .select()
    .from(meals)
    .where(eq(meals.id, mealId))
    .limit(1);
  if (!source[0]) throw new Error("Meal not found");

  const id = newId();
  await db.insert(meals).values({
    id,
    user_id: user.id,
    logical_day: day,
    category,
    name: source[0].name,
    place: source[0].place,
    protein_g: source[0].protein_g,
    fat_g: source[0].fat_g,
    carbs_g: source[0].carbs_g,
    fat_quality: source[0].fat_quality,
    catalog_item_id: source[0].catalog_item_id,
    created_at: new Date(),
  });
  revalidatePath("/");
  return id;
}

export async function deleteMeal(id: string) {
  const user = await requireUser();
  await db
    .delete(meals)
    .where(and(eq(meals.id, id), eq(meals.user_id, user.id)));
  revalidatePath("/");
}
