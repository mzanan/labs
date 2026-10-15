import { saveAiCredential, updateReasoningEffort, type ReasoningEffort } from "@/lib/ai/aiCredentials";
import { runAsUser } from "@/lib/db/context";
import type { Profile } from "@/lib/db/schema";
import { ensureProfile } from "@/lib/profile";

import type { CatalogEntry } from "../grade/graders";
import { EVAL_SOURCE_EMAIL, EVAL_TIMEZONE, evalEmail } from "../runConfig";
import type { SeedMeal } from "../scenarios/types";
import { ownerDb } from "./ownerDb";

const PROFILE_COPY = [
  "sex",
  "birth_year",
  "height_cm",
  "day_cutoff_hour",
  "protein_target",
  "fat_min",
  "fat_max",
  "fat_floor",
  "carbs_gym",
  "carbs_rest",
  "calories_target",
  "calories_rest",
  "coach_rules",
] as const;

const CATALOG_COPY = [
  "name",
  "place",
  "protein_g",
  "fat_g",
  "carbs_g",
  "fat_quality",
  "notes",
  "is_composable",
  "archived",
  "delivery",
  "dinner_only",
  "company",
  "closed_weekdays",
  "auto_day_type",
  "auto_category",
] as const;

type SourceRow = Record<string, unknown>;

export interface EvalSource {
  profile: SourceRow;
  catalog: SourceRow[];
}

export interface EvalUser {
  userId: string;
  profile: Profile;
  catalog: CatalogEntry[];
}

export async function loadEvalSource(): Promise<EvalSource> {
  const db = ownerDb();
  const { rows: users } = await db.query<{ id: string }>(`select id from "user" where email = $1`, [EVAL_SOURCE_EMAIL]);
  const sourceId = users[0]?.id;
  if (!sourceId) throw new Error("Source user for the eval fixture is missing in this database");
  const { rows: profiles } = await db.query<SourceRow>("select * from profiles where user_id = $1", [sourceId]);
  if (!profiles[0]) throw new Error("Source profile for the eval fixture is missing");
  const { rows: catalog } = await db.query<SourceRow>("select * from catalog_items where user_id = $1 order by name", [sourceId]);
  return { profile: profiles[0], catalog };
}

function placeholders(count: number, offset = 0): string {
  return Array.from({ length: count }, (_, index) => `$${index + 1 + offset}`).join(", ");
}

async function insertUser(userId: string, email: string): Promise<void> {
  await ownerDb().query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") values ($1, $2, $3, true, now(), now())`,
    [userId, "Eval user", email],
  );
}

async function insertProfile(userId: string, source: SourceRow): Promise<void> {
  const columns = ["user_id", "timezone", "dining_mode", "chat_language", "seeded_at", "created_at", "updated_at", ...PROFILE_COPY];
  const now = new Date();
  const values = [userId, EVAL_TIMEZONE, "delivery", "Spanish", now, now, now, ...PROFILE_COPY.map((column) => source[column] ?? null)];
  await ownerDb().query(`insert into profiles (${columns.join(", ")}) values (${placeholders(columns.length)})`, values);
}

async function cloneCatalog(userId: string, source: SourceRow[]): Promise<CatalogEntry[]> {
  const columns = ["id", "user_id", "created_at", "updated_at", ...CATALOG_COPY];
  const now = new Date();
  const entries: CatalogEntry[] = [];
  for (const row of source) {
    const id = crypto.randomUUID();
    await ownerDb().query(`insert into catalog_items (${columns.join(", ")}) values (${placeholders(columns.length)})`, [
      id,
      userId,
      now,
      now,
      ...CATALOG_COPY.map((column) => row[column] ?? null),
    ]);
    entries.push({
      id,
      name: String(row.name),
      place: (row.place as string | null) ?? null,
      protein_g: Number(row.protein_g ?? 0),
      fat_g: Number(row.fat_g ?? 0),
      carbs_g: Number(row.carbs_g ?? 0),
    });
  }
  return entries;
}

export async function createEvalUser(
  source: EvalSource,
  runId: string,
  n: number,
  model: string,
  effort: ReasoningEffort,
  apiKey: string,
): Promise<EvalUser> {
  const userId = crypto.randomUUID();
  await insertUser(userId, evalEmail(runId, n));
  await insertProfile(userId, source.profile);
  const catalog = await cloneCatalog(userId, source.catalog);
  const profile = await runAsUser(userId, "app", async () => {
    await saveAiCredential(userId, "explabs", apiKey, model);
    await updateReasoningEffort(userId, "explabs", effort);
    return ensureProfile(userId);
  });
  return { userId, profile, catalog };
}

export function findCatalogEntry(catalog: CatalogEntry[], name: string, place?: string): CatalogEntry | undefined {
  return catalog.find((entry) => entry.name === name && (place === undefined || entry.place === place));
}

export async function seedMeals(user: EvalUser, meals: SeedMeal[], dayFor: (offset: number) => string): Promise<void> {
  for (const meal of meals) {
    const entry = findCatalogEntry(user.catalog, meal.item.name, meal.item.place);
    if (!entry) throw new Error(`Seed meal item not found: ${meal.item.name}`);
    const portions = meal.portions ?? 1;
    await ownerDb().query(
      `insert into meals (id, user_id, logical_day, category, name, place, protein_g, fat_g, carbs_g, catalog_item_id, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())`,
      [
        crypto.randomUUID(),
        user.userId,
        dayFor(meal.dayOffset),
        meal.category,
        entry.name,
        entry.place,
        entry.protein_g * portions,
        entry.fat_g * portions,
        entry.carbs_g * portions,
        entry.id,
      ],
    );
  }
}
