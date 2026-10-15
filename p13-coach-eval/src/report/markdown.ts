import { JOBS, type FailurePattern, type ModelSummary } from "./aggregate";
import type { TurnRecord } from "./records";

function pct(value: number | null | undefined): string {
  return value == null ? "n/a" : `${Math.round(value * 100)}%`;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function usd(value: number, digits = 4): string {
  return `$${value.toFixed(digits)}`;
}

export function modelTable(summaries: ModelSummary[]): string {
  const header = [
    "Model",
    "Reps",
    "Runs",
    "Rep-1 pass",
    "Pass (all reps)",
    ...JOBS,
    "pass^3 writes",
    "Unreq. writes",
    "False claims",
    "Generic errors",
    "p50",
    "p95",
    "$/msg",
    "Total $",
  ];
  const rows = summaries.map((summary) => [
    summary.model + (summary.skipped ? ` (skipped ${summary.skipped}: ${summary.skipReasons.join(", ")})` : ""),
    String(summary.reps),
    String(summary.scenarioRuns),
    pct(summary.rep1PassRate),
    pct(summary.passRate),
    ...JOBS.map((job) => pct(summary.jobPassRate[job])),
    `${pct(summary.passPow3Writes)} (n=${summary.writeScenariosWithAllReps})`,
    String(summary.unrequestedWrites),
    String(summary.falseClaims),
    String(summary.genericErrors),
    seconds(summary.p50LatencyMs),
    seconds(summary.p95LatencyMs),
    usd(summary.costPerMessageUsd),
    usd(summary.totalCostUsd, 2),
  ]);
  return [header, header.map(() => "---"), ...rows].map((row) => `| ${row.join(" | ")} |`).join("\n");
}

function oneLine(text: string, max = 400): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}...` : flat;
}

export function transcript(turn: TurnRecord): string {
  const calls = turn.toolCalls.length
    ? turn.toolCalls.map((call) => `${call.name}(${oneLine(JSON.stringify(call.input), 160)})`).join(", ")
    : turn.toolNames.join(", ") || "none";
  const writes = turn.domainWrites.map((write) => `${write.op} ${write.table}`).join(", ") || "none";
  return [`  - User: ${oneLine(turn.user)}`, `  - Tools: ${calls}`, `  - Domain writes: ${writes}`, `  - Reply: ${oneLine(turn.text)}`].join("\n");
}

export function patternSection(patterns: FailurePattern[], limit: number): string {
  return patterns
    .slice(0, limit)
    .map((pattern) => {
      const byModel = Object.entries(pattern.byModel)
        .sort((a, b) => b[1] - a[1])
        .map(([model, count]) => `${model} ${count}`)
        .join(", ");
      const examples = pattern.examples
        .slice(0, 2)
        .map((example) => `- ${example.model} ${example.scenarioId} rep ${example.rep}\n${transcript(example.turn)}`)
        .join("\n");
      return `### ${pattern.pattern} (${pattern.count} turns)\n\nBy model: ${byModel}\n\n${examples}`;
    })
    .join("\n\n");
}

export function summaryMarkdown(runId: string, summaries: ModelSummary[], patterns: FailurePattern[]): string {
  return [
    `# Coach eval ${runId}`,
    "",
    "Engine E0 legacy. Pass = every grader in scope passed on every turn. Reps = how many reps the model ran: per-job, error, latency and cost columns pool all its runs, so a 1-rep row rests on 37 scenario runs and a 3-rep row on 111. Rep-1 pass is the screening number, comparable across all models. pass^3 is n/a for 1-rep models. Language and false-claim graders are heuristic.",
    "",
    modelTable(summaries),
    "",
    "## Failure patterns",
    "",
    patternSection(patterns, 12),
    "",
  ].join("\n");
}
