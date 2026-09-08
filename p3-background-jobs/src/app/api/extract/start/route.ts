import { start } from "workflow/api";

import { requireLabSecret } from "@/lib/labAuth";
import { extractRefFromEnv } from "@/lib/extractRef";
import { getScenario, loadScenarioSources } from "@/lib/scenarios";
import { extractWorkflow, sleepWorkflow } from "@/app/workflows/extract-workflow";

export async function POST(request: Request) {
  const unauthorized = requireLabSecret(request);
  if (unauthorized) return unauthorized;

  const body = (await request.json()) as { scenario?: string };
  if (!body.scenario) {
    return Response.json({ error: "scenario is required" }, { status: 400 });
  }

  const scenario = getScenario(body.scenario);

  if (scenario.kind === "sleep") {
    const run = await start(sleepWorkflow, [scenario.sleepMinutes ?? 6]);
    return Response.json({ runId: run.runId });
  }

  const sources = loadScenarioSources(scenario);
  const run = await start(extractWorkflow, [
    {
      ref: extractRefFromEnv(),
      sources,
      fault: scenario.fault,
      dryRun: scenario.dryRun,
    },
  ]);
  return Response.json({ runId: run.runId });
}
