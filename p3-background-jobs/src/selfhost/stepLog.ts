import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface StepLogEntry {
  requestId: string;
  step: string;
  at: string;
}

export async function appendStepLog(path: string, entry: StepLogEntry): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(entry)}\n`);
}

export async function readStepLog(path: string): Promise<StepLogEntry[]> {
  const text = await readFile(path, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as StepLogEntry);
}

export function countSteps(entries: StepLogEntry[], requestId: string, step: string): number {
  return entries.filter((e) => e.requestId === requestId && e.step === step).length;
}

export function outcomesFor(entries: StepLogEntry[], requestId: string): string[] {
  return entries
    .filter((e) => e.requestId === requestId && e.step.startsWith("outcome:"))
    .map((e) => e.step.slice("outcome:".length));
}
