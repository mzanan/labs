import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { grade, type Finding, type Planted } from "./grade.js";
import { summarize } from "./summary.js";

const ROOT = new URL("..", import.meta.url).pathname;
const INPUT = process.argv[2];
const OUTPUT = process.argv[3];

interface StoredRep {
  rep: number;
  ok: boolean;
  seconds: number;
  findings: Finding[];
}

interface Stored {
  date: string;
  runs: { summary: { model: string }; reps: StoredRep[] }[];
}

function main() {
  if (!INPUT || !OUTPUT) throw new Error("usage: tsx src/regrade.ts <results.json> <out.json>");
  const planted = (JSON.parse(readFileSync(join(ROOT, "fixture", "manifest.json"), "utf8")) as { planted: Planted[] }).planted;
  const stored = JSON.parse(readFileSync(INPUT, "utf8")) as Stored;
  const runs = stored.runs.map((run) => {
    const reps = run.reps.map((rep) => ({ ...rep, grade: grade(planted, rep.findings) }));
    const summary = summarize(run.summary.model, planted, reps);
    console.log(JSON.stringify(summary));
    return { summary, reps };
  });
  writeFileSync(OUTPUT, JSON.stringify({ date: stored.date, regradedAt: new Date().toISOString(), planted, runs }, null, 2));
}

main();
