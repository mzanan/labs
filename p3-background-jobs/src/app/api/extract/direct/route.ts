import { requireLabSecret } from "@/lib/labAuth";
import { extractRefFromEnv } from "@/lib/extractRef";
import { getScenario, loadScenarioSources } from "@/lib/scenarios";
import { chunkMarkdown } from "@/lib/chunk";
import { extractChunk, type ChunkExtraction } from "@/lib/extractChunk";

export const maxDuration = 300;

function mergeChunkExtractions(parts: ChunkExtraction[]): ChunkExtraction {
  return {
    meals: parts.flatMap((part) => part.meals),
    notes: parts.flatMap((part) => part.notes),
  };
}

export async function POST(request: Request) {
  const unauthorized = requireLabSecret(request);
  if (unauthorized) return unauthorized;

  const body = (await request.json()) as { scenario?: string };
  if (!body.scenario) {
    return Response.json({ error: "scenario is required" }, { status: 400 });
  }
  const scenario = getScenario(body.scenario);
  const sources = loadScenarioSources(scenario);
  const ref = extractRefFromEnv();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        const parts: ChunkExtraction[] = [];
        for (const [fileIndex, source] of sources.entries()) {
          if (request.signal.aborted) break;
          const chunks = chunkMarkdown(source.text);
          for (let i = 0; i < chunks.length; i++) {
            if (request.signal.aborted) break;
            console.log(`[extract-direct] chunk=${i + 1}`);
            send({
              type: "progress",
              file: source.name,
              fileIndex: fileIndex + 1,
              files: sources.length,
              chunk: i + 1,
              chunks: chunks.length,
            });
            try {
              const part = await extractChunk(
                ref,
                chunks[i],
                i,
                chunks.length,
                scenario.fault,
                scenario.dryRun,
              );
              parts.push(part);
            } catch (error) {
              if (request.signal.aborted) break;
              const reason = error instanceof Error ? error.message : "unknown error";
              parts.push({ meals: [], notes: [`Part ${i + 1} could not be parsed and was skipped: ${reason}`] });
            }
          }
        }
        const extraction = mergeChunkExtractions(parts);
        send({ type: "done", extraction });
      } catch (error) {
        send({
          type: "error",
          message: error instanceof Error ? error.message : "Extraction failed",
        });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
