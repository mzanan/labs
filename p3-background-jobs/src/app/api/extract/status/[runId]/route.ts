import { getRun } from "workflow/api";
import { WorkflowRunFailedError } from "workflow/internal/errors";

import { requireLabSecret } from "@/lib/labAuth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const unauthorized = requireLabSecret(request);
  if (unauthorized) return unauthorized;

  const { runId } = await params;
  const run = getRun(runId);
  const status = await run.status;
  const createdAt = await run.createdAt;
  const startedAt = await run.startedAt;
  const completedAt = await run.completedAt;

  let returnValue = null;
  let error = null;
  if (status === "completed") {
    returnValue = await run.returnValue;
  } else if (status === "failed") {
    try {
      await run.returnValue;
    } catch (caught) {
      if (WorkflowRunFailedError.is(caught)) {
        const cause = caught.cause;
        error = cause instanceof Error ? cause.message : String(cause);
      } else {
        error = caught instanceof Error ? caught.message : String(caught);
      }
    }
  }

  return Response.json({ status, returnValue, error, createdAt, startedAt, completedAt });
}
