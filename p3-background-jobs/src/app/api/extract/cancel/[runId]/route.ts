import { getRun } from "workflow/api";

import { requireLabSecret } from "@/lib/labAuth";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const unauthorized = requireLabSecret(request);
  if (unauthorized) return unauthorized;

  const { runId } = await params;
  await getRun(runId).cancel();
  return Response.json({ cancelled: true });
}
