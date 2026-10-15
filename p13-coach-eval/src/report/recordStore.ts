import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { ScenarioRecord } from "./records";

export function recordKey(record: Pick<ScenarioRecord, "model" | "scenarioId" | "rep">): string {
  return `${record.model}|${record.scenarioId}|${record.rep}`;
}

export function latestRecords(records: ScenarioRecord[]): ScenarioRecord[] {
  const byKey = new Map<string, ScenarioRecord>();
  for (const record of records) {
    const existing = byKey.get(recordKey(record));
    if (!existing || existing.skipped || !record.skipped) byKey.set(recordKey(record), record);
  }
  return [...byKey.values()];
}

export async function readRecordFile(file: string): Promise<ScenarioRecord[]> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return [];
  }
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ScenarioRecord);
}

export async function readRunRecords(dir: string): Promise<ScenarioRecord[]> {
  const files = (await readdir(dir)).filter((file) => file.endsWith(".jsonl"));
  const chunks = await Promise.all(files.map((file) => readRecordFile(path.join(dir, file))));
  return latestRecords(chunks.flat());
}

export function completedKeys(records: ScenarioRecord[]): Set<string> {
  return new Set(records.filter((record) => !record.skipped).map(recordKey));
}

export function recordCost(record: ScenarioRecord): number {
  return record.turns.reduce((sum, turn) => sum + turn.usage.costUsd, 0);
}
