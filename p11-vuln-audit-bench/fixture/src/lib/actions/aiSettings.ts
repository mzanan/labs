"use server";

import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";

import {
  activateProvider,
  deleteAiCredential,
  getAiSetup,
  providerApiKey,
  saveAiCredential,
  updateAiModel,
} from "@/lib/ai/aiCredentials";
import {
  getModelInfo,
  googleModels,
  groqModels,
  explabsModels,
  type ModelInfo,
} from "@/lib/ai/capabilities";
import {
  AI_PROVIDERS,
  KEYED_PROVIDERS,
  PROVIDER_LABEL,
  type KeyedProvider,
} from "@/lib/ai/options";
import { FETCH_TIMEOUT_MS } from "@/lib/constants";
import { requireUser } from "@/lib/session";

export interface AiActionResult {
  error?: string;
}

const OPENROUTER_KEY_URL = "https://openrouter.ai/api/v1/key";

const providerSchema = z.enum(AI_PROVIDERS);

const saveSchema = z.object({
  provider: providerSchema,
  apiKey: z.string().trim().min(1),
  model: z.string().trim().min(1),
});


async function openrouterKeyError(apiKey: string): Promise<string | null> {
  let response: Response;
  try {
    response = await fetch(OPENROUTER_KEY_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    return "Could not reach OpenRouter to validate the key. Try again.";
  }
  if (response.status === 401 || response.status === 403) {
    return "OpenRouter rejected this API key.";
  }
  if (!response.ok) {
    return "Could not validate the key with OpenRouter. Try again.";
  }
  return null;
}

async function openrouterModelError(model: string): Promise<string | null> {
  try {
    const info = await getModelInfo(model);
    return info ? null : "Unknown model. Pick one from the list.";
  } catch {
    return "Could not load the model list from OpenRouter. Try again.";
  }
}

async function keyedModels(provider: KeyedProvider, apiKey: string) {
  if (provider === "groq") return groqModels(apiKey);
  if (provider === "explabs") return explabsModels(apiKey);
  return googleModels(apiKey);
}

async function keyedProviderError(
  provider: KeyedProvider,
  apiKey: string,
  model: string | null,
): Promise<string | null> {
  const label = PROVIDER_LABEL[provider];
  const result = await keyedModels(provider, apiKey);
  if (result.status === "unauthorized") return `${label} rejected this API key.`;
  if (result.status === "error") {
    return `Could not reach ${label} to validate the key. Try again.`;
  }
  if (model && !result.models.some((entry) => entry.id === model)) {
    return `Unknown ${label} model. Pick one from the list.`;
  }
  return null;
}

function revalidateAi(): void {
  revalidatePath("/coach", "layout");
}

const keyedProvider = z.enum(KEYED_PROVIDERS);

export async function listProviderModelsAction(
  provider: KeyedProvider,
  input: unknown,
): Promise<{ models?: ModelInfo[]; error?: string }> {
  await requireUser();
  const parsedProvider = keyedProvider.safeParse(provider);
  const parsed = z.string().trim().min(1).safeParse(input);
  if (!parsedProvider.success) return { error: "Unknown provider." };
  if (!parsed.success) {
    return { error: `Enter your ${PROVIDER_LABEL[provider]} API key first.` };
  }

  const label = PROVIDER_LABEL[provider];
  const result = await keyedModels(provider, parsed.data);
  if (result.status === "unauthorized") {
    return { error: `${label} rejected this API key.` };
  }
  if (result.status === "error") {
    return { error: `Could not load ${label}'s model list. Try again.` };
  }
  return { models: result.models };
}

export async function saveAiSettingsAction(
  input: unknown,
): Promise<AiActionResult> {
  const user = await requireUser();
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { error: "Enter a key and pick a model." };
  const { provider, apiKey, model } = parsed.data;

  if (provider === "groq" || provider === "google") {
    const error = await keyedProviderError(provider, apiKey, model);
    if (error) return { error };
  } else {
    const invalidKey = await openrouterKeyError(apiKey);
    if (invalidKey) return { error: invalidKey };
    const invalidModel = await openrouterModelError(model);
    if (invalidModel) return { error: invalidModel };
  }

  await saveAiCredential(user.id, provider, apiKey, model);
  updateTag("ai-credentials");
  revalidateAi();
  return {};
}

export async function activateProviderAction(
  input: unknown,
): Promise<AiActionResult> {
  const user = await requireUser();
  const parsed = providerSchema.safeParse(input);
  if (!parsed.success) return { error: "Unknown provider." };

  try {
    const switched = await activateProvider(user.id, parsed.data);
    if (!switched) return { error: "Add a key for that provider first." };
  } catch {
    return { error: "Could not switch provider. Try again." };
  }
  revalidateAi();
  return {};
}

const updateSchema = z.object({
  provider: providerSchema,
  model: z.string().trim().min(1),
});

export async function updateAiModelAction(
  input: unknown,
): Promise<AiActionResult> {
  const user = await requireUser();
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { error: "Pick a model from the list." };
  const { provider, model } = parsed.data;

  const { saved } = await getAiSetup(user.id);
  if (!saved.some((credential) => credential.provider === provider)) {
    return { error: "Save a key for that provider first." };
  }

  if (provider === "groq" || provider === "google") {
    const apiKey = await providerApiKey(user.id, provider);
    if (!apiKey) {
      return {
        error: "Your stored key could not be read. Remove it and add it again.",
      };
    }
    const error = await keyedProviderError(provider, apiKey, model);
    if (error) return { error };
  } else {
    const invalidModel = await openrouterModelError(model);
    if (invalidModel) return { error: invalidModel };
  }

  await updateAiModel(user.id, provider, model);
  revalidateAi();
  return {};
}

export async function storedAiKeyAction(
  input: unknown,
): Promise<{ apiKey?: string; error?: string }> {
  const user = await requireUser();
  const parsed = providerSchema.safeParse(input);
  if (!parsed.success) return { error: "Unknown provider." };
  const apiKey = await providerApiKey(user.id, parsed.data);
  return apiKey ? { apiKey } : { error: "No key saved." };
}

export async function removeAiSettingsAction(
  input: unknown,
): Promise<AiActionResult> {
  const user = await requireUser();
  const parsed = providerSchema.safeParse(input);
  if (!parsed.success) return { error: "Unknown provider." };

  await deleteAiCredential(user.id, parsed.data);
  updateTag("ai-credentials");
  revalidateAi();
  return {};
}
