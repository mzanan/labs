import { generateObject } from "ai";
import { createGroq } from "@ai-sdk/groq";
import { z } from "zod";
import { RetryableError, getStepMetadata } from "workflow";

export const chunkSchema = z.object({
  meals: z.array(
    z.object({
      name: z.string(),
      protein_g: z.number(),
    }),
  ),
  notes: z.array(z.string()),
});

export type ChunkExtraction = z.infer<typeof chunkSchema>;

export interface ChunkFault {
  chunk: number;
  kind: "retryable" | "schema";
}

export interface ExtractRef {
  provider: "groq" | "gateway";
  model: string;
}

const SYSTEM =
  "Extract meals with their protein in grams and any free-form notes from this markdown log chunk. Return ONLY the requested JSON shape.";

function resolveModel(ref: ExtractRef) {
  if (ref.provider === "gateway") return ref.model;
  const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });
  return groq(ref.model);
}

export async function extractChunk(
  ref: ExtractRef,
  chunkText: string,
  index: number,
  total: number,
  fault: ChunkFault | null,
  dryRun: boolean,
): Promise<ChunkExtraction> {
  const oneIndexed = index + 1;
  const applies = fault !== null && fault.chunk === oneIndexed;

  if (dryRun) {
    return { meals: [], notes: ["dry run"] };
  }

  if (applies && fault.kind === "schema") {
    chunkSchema.parse({});
  }

  if (applies && fault.kind === "retryable") {
    const { attempt } = getStepMetadata();
    if (attempt === 1) {
      throw new RetryableError("injected", { retryAfter: "10s" });
    }
  }

  const { object } = await generateObject({
    model: resolveModel(ref),
    schema: chunkSchema,
    maxRetries: 0,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Chunk ${oneIndexed} of ${total}:\n\n${chunkText}`,
      },
    ],
  });
  return object;
}
