import { getRun } from "workflow/api";

import { requireLabSecret } from "@/lib/labAuth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const unauthorized = requireLabSecret(request);
  if (unauthorized) return unauthorized;

  const { runId } = await params;
  const { searchParams } = new URL(request.url);
  const startIndex = Number(searchParams.get("startIndex") ?? "0");

  const source = getRun(runId).getReadable({ startIndex });
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = source.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
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
