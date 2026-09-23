import type { Graded, Planted } from "./grade.js";

export interface RepResult {
  rep: number;
  ok: boolean;
  seconds: number;
  grade: Graded;
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 1000) / 1000;
}

export function summarize(model: string, planted: Planted[], reps: RepResult[]) {
  const ok = reps.filter((r) => r.ok);
  const ids = planted.map((p) => p.id);
  const everFound = new Set(ok.flatMap((r) => r.grade.found));
  return {
    model,
    reps: reps.length,
    completed: ok.length,
    errors: reps.length - ok.length,
    meanRecall: mean(ok.map((r) => r.grade.recall)),
    meanPrecision: mean(ok.map((r) => r.grade.precision)),
    unmatchedFindings: ok.reduce((sum, r) => sum + r.grade.unmatched.length, 0),
    duplicateFindings: ok.reduce((sum, r) => sum + r.grade.duplicates.length, 0),
    foundPerPlant: Object.fromEntries(
      ids.map((id) => [id, ok.filter((r) => r.grade.found.includes(id)).length]),
    ),
    foundInEveryRep: ids.filter((id) => ok.length > 0 && ok.every((r) => r.grade.found.includes(id))),
    neverFound: ids.filter((id) => !everFound.has(id)),
    meanSecondsCompleted: mean(ok.map((r) => r.seconds)),
  };
}
