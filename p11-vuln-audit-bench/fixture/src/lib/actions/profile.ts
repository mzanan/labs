"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db, schema } from "@/lib/db";
import { COACH_RULES_MAX, isChatLanguage, SUMMARY_RULES_MAX } from "@/lib/constants";
import { isValidTimezone } from "@/lib/dates";
import { saveTargets } from "@/lib/data/targets";
import { requireUser } from "@/lib/session";
import { targetsSchema } from "@/lib/targets";

const { profiles } = schema;

export async function updateTargets(input: unknown) {
  const user = await requireUser();
  const data = targetsSchema.parse(input);

  await saveTargets(user.id, data);
  revalidatePath("/");
  revalidatePath("/settings");
  revalidatePath("/settings/targets");
  revalidatePath("/coach");
  revalidatePath("/body");
}

const coachRulesSchema = z.object({
  rules: z.string().max(COACH_RULES_MAX),
});

export async function updateCoachRules(input: unknown) {
  const user = await requireUser();
  const { rules } = coachRulesSchema.parse(input);

  await db
    .update(profiles)
    .set({ coach_rules: rules.trim() || null, updated_at: new Date() })
    .where(eq(profiles.user_id, user.id));
  revalidatePath("/coach");
  revalidatePath("/settings");
  revalidatePath("/settings/coach");
}

const summaryRulesSchema = z.object({
  rules: z.string().max(SUMMARY_RULES_MAX),
});

export async function updateSummaryRules(input: unknown) {
  const user = await requireUser();
  const { rules } = summaryRulesSchema.parse(input);

  await db
    .update(profiles)
    .set({ summary_rules: rules.trim() || null, updated_at: new Date() })
    .where(eq(profiles.user_id, user.id));
  revalidatePath("/coach");
  revalidatePath("/settings");
  revalidatePath("/settings/coach");
}

const chatLanguageSchema = z.object({
  language: z
    .string()
    .refine((value) => !value.trim() || isChatLanguage(value.trim()), {
      message: "Use a language name, up to three words",
    }),
});

export async function updateChatLanguage(input: unknown) {
  const user = await requireUser();
  const { language } = chatLanguageSchema.parse(input);

  await db
    .update(profiles)
    .set({ chat_language: language.trim() || null, updated_at: new Date() })
    .where(eq(profiles.user_id, user.id));
  revalidatePath("/coach");
  revalidatePath("/settings/coach");
}

const DINING_MODES = ["delivery", "cooks"] as const;

const diningModeSchema = z.object({
  mode: z.enum(DINING_MODES),
});

export async function updateDiningMode(input: unknown) {
  const user = await requireUser();
  const { mode } = diningModeSchema.parse(input);

  await db
    .update(profiles)
    .set({ dining_mode: mode, updated_at: new Date() })
    .where(eq(profiles.user_id, user.id));
  revalidatePath("/coach");
  revalidatePath("/settings/coach");
}

const settingsSchema = z.object({
  sex: z.enum(["male", "female"]),
  birth_year: z.number().int().min(1900).max(2100).nullable(),
  height_cm: z.number().min(0).max(300).nullable(),
  timezone: z
    .string()
    .min(1)
    .refine(isValidTimezone, "Use a valid timezone name, like Asia/Ho_Chi_Minh."),
  day_cutoff_hour: z.number().int().min(0).max(12),
}).passthrough();

export async function updateProfileSettings(input: unknown) {
  const user = await requireUser();
  const data = settingsSchema.parse(input);

  await db
    .update(profiles)
    .set({ ...data, updated_at: new Date() })
    .where(eq(profiles.user_id, user.id));
  revalidatePath("/");
  revalidatePath("/settings");
  revalidatePath("/settings/profile");
}
