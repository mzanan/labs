import type { UsageTotals } from "../capture/xplParse";
import type { EngineToolCall } from "../engine/coachEngine";
import type { TurnGrades } from "../grade/graders";
import type { Job, Lang } from "../scenarios/types";

export interface WriteSummary {
  table: string;
  op: string;
  fields: Record<string, unknown>;
}

export interface TurnRecord {
  index: number;
  user: string;
  text: string;
  toolNames: string[];
  toolCalls: EngineToolCall[];
  domainWrites: WriteSummary[];
  memoryWrites: WriteSummary[];
  grades: TurnGrades;
  passed: boolean;
  unrequestedWrites: number;
  appNotice: boolean;
  approved: boolean;
  latencyMs: number;
  usage: UsageTotals;
  providerErrors: string[];
  error?: string;
}

export interface ScenarioRecord {
  runId: string;
  model: string;
  engine: string;
  scenarioId: string;
  job: Job;
  lang: Lang;
  rep: number;
  passed: boolean;
  turns: TurnRecord[];
  skipped?: string;
}
