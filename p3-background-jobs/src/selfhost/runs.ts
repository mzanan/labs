import { inngestBaseUrl, requireEnv } from "./config";

export interface RunSummary {
  runId: string;
  status: string;
  endedAt: string | null;
}

interface RawRun {
  run_id: string;
  status: string;
  ended_at: string | null;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${inngestBaseUrl()}${path}`, {
    headers: { authorization: `Bearer ${requireEnv("INNGEST_SIGNING_KEY")}` },
  });
  if (!res.ok) throw new Error(`${path} ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { data: T }).data;
}

export async function listRunIdsForEvent(eventId: string): Promise<string[]> {
  const runs = await get<RawRun[] | null>(`/v1/events/${eventId}/runs`);
  return (runs ?? []).map((r) => r.run_id);
}

export async function getRun(runId: string): Promise<RunSummary> {
  const run = await get<RawRun>(`/v1/runs/${runId}`);
  return { runId: run.run_id, status: run.status, endedAt: run.ended_at };
}

export function isTerminal(status: string): boolean {
  return ["completed", "failed", "cancelled"].includes(status.toLowerCase());
}
