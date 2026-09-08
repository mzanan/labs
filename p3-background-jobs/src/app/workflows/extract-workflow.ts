import { z } from "zod";
import { sleep, getWritable, getStepMetadata, getWorkflowMetadata } from "workflow";

import { chunkMarkdown } from "@/lib/chunk";
import {
  extractChunk,
  type ChunkExtraction,
  type ChunkFault,
  type ExtractRef,
} from "@/lib/extractChunk";

export interface ExtractSource {
  name: string;
  text: string;
}

export interface ExtractWorkflowInput {
  ref: ExtractRef;
  sources: ExtractSource[];
  fault: ChunkFault | null;
  dryRun: boolean;
}

export interface ProgressEvent {
  type: "progress";
  file: string;
  fileIndex: number;
  files: number;
  chunk: number;
  chunks: number;
}

export interface DoneEvent {
  type: "done";
  extraction: ChunkExtraction;
}

function mergeChunkExtractions(parts: ChunkExtraction[]): ChunkExtraction {
  const meals = parts.flatMap((part) => part.meals);
  const notes = parts.flatMap((part) => part.notes);
  return { meals, notes };
}

export async function extractWorkflow(input: ExtractWorkflowInput) {
  "use workflow";

  const { ref, sources, fault, dryRun } = input;

  const parts: ChunkExtraction[] = [];
  for (const [fileIndex, source] of sources.entries()) {
    const chunks = chunkMarkdown(source.text);
    for (let i = 0; i < chunks.length; i++) {
      await writeStreamEventStep({
        type: "progress",
        file: source.name,
        fileIndex: fileIndex + 1,
        files: sources.length,
        chunk: i + 1,
        chunks: chunks.length,
      });
      const part = await extractChunkStep(ref, chunks[i], i, chunks.length, fault, dryRun);
      parts.push(part);
    }
  }

  const extraction = mergeChunkExtractions(parts);
  await writeStreamEventStep({ type: "done", extraction }, true);
  return extraction;
}

export async function writeStreamEventStep(
  event: ProgressEvent | DoneEvent,
  closeAfter = false,
) {
  "use step";

  const writer = getWritable<ProgressEvent | DoneEvent>().getWriter();
  await writer.write(event);
  if (closeAfter) await writer.close();
  else writer.releaseLock();
}

export async function extractChunkStep(
  ref: ExtractRef,
  chunkText: string,
  index: number,
  total: number,
  fault: ChunkFault | null,
  dryRun: boolean,
): Promise<ChunkExtraction> {
  "use step";

  const { workflowRunId } = getWorkflowMetadata();
  const { attempt } = getStepMetadata();
  console.log(
    `[extract-step] run=${workflowRunId} chunk=${index + 1} attempt=${attempt} at ${new Date().toISOString()}`,
  );

  try {
    return await extractChunk(ref, chunkText, index, total, fault, dryRun);
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;
    return { meals: [], notes: [`Part ${index + 1} could not be parsed and was skipped.`] };
  }
}
extractChunkStep.maxRetries = 3;

export async function sleepWorkflow(minutes: number) {
  "use workflow";

  console.log(`[sleep-workflow] starting sleep at ${new Date().toISOString()}`);
  await sleep(`${minutes}m`);
  console.log(`[sleep-workflow] woke up at ${new Date().toISOString()}`);
  return { slept: true, minutes };
}
