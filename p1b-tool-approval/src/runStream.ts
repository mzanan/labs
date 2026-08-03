import { readFileSync } from "node:fs";

import { NoSuchToolError, type ModelMessage, type ToolCallRepairFunction, type ToolSet } from "ai";

import { corruptingModel, CORRUPT_SUFFIX, type CorruptionLog } from "./corrupt.js";
import {
  isProviderId,
  resolveAll,
  type ModelRef,
  type ResolvedModel,
} from "./providers.js";
import {
  INSTRUCTIONS,
  MAX_OUTPUT_TOKENS,
  MAX_STEPS,
  PAUSE_MS,
  PROMPT,
  TIMEOUT_MS,
  WRITE_TOOL,
  report,
  wait,
  type CaseResult,
} from "./scenario.js";
import { approvalResponse, describe, runStream } from "./stream.js";
import { buildTools, type WriteLog } from "./tools.js";

const CANDIDATES_FILE = process.env.CANDIDATES_FILE ?? "candidates.json";

function loadCandidates(path: string): ModelRef[] {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${path} must contain an array`);
  return parsed.map((entry, index) => {
    const ref = entry as Partial<ModelRef>;
    if (typeof ref.provider !== "string" || !isProviderId(ref.provider)) {
      throw new Error(`${path}[${index}]: unknown provider`);
    }
    if (typeof ref.model !== "string") throw new Error(`${path}[${index}]: missing model`);
    return { provider: ref.provider, model: ref.model, label: ref.label, routeOnly: ref.routeOnly };
  });
}

function base(tools: ToolSet, messages: ModelMessage[]) {
  return {
    instructions: INSTRUCTIONS,
    messages,
    tools,
    approvalFor: WRITE_TOOL,
    maxSteps: MAX_STEPS,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    timeoutMs: TIMEOUT_MS,
  };
}

const askToLog: ModelMessage[] = [{ role: "user", content: PROMPT }];

async function streamingCases(model: ResolvedModel): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  const writes: WriteLog = { logged: [] };
  const tools = buildTools(writes);

  const first = await runStream(model.languageModel, base(tools, askToLog));

  if (!first.approvals.length) {
    results.push({
      name: "stream-pauses",
      outcome: first.errors.length ? "error" : "fail",
      detail: first.errors[0] ?? `no approval requested, tools called: ${first.toolCalls.join(",") || "none"}`,
    });
    return results;
  }

  results.push({
    name: "stream-pauses",
    outcome: writes.logged.length === 0 ? "pass" : "fail",
    detail:
      writes.logged.length === 0
        ? `fullStream emitted tool-approval-request for ${first.approvals.map((a) => a.toolName).join(",")}, input ${JSON.stringify(first.approvals[0].input)}, signature ${first.approvals[0].signed ? "present" : "absent"}, nothing written`
        : `wrote ${writes.logged.length} before any approval`,
  });

  await wait(PAUSE_MS);

  const approvedWrites: WriteLog = { logged: [] };
  const approved = await runStream(
    model.languageModel,
    base(buildTools(approvedWrites), [
      ...askToLog,
      ...first.messages,
      approvalResponse(first.approvals, true),
    ]),
  );
  results.push({
    name: "stream-approve",
    outcome:
      approvedWrites.logged.length === 1 && approved.text ? "pass" : "fail",
    detail:
      approvedWrites.logged.length === 1
        ? `wrote ${JSON.stringify(approvedWrites.logged[0])}, streamed ${approved.text.length} chars of answer`
        : `writes=${approvedWrites.logged.length}, text=${approved.text.length}, errors=${approved.errors.join("|") || "none"}`,
  });

  await wait(PAUSE_MS);

  const deniedWrites: WriteLog = { logged: [] };
  const denied = await runStream(
    model.languageModel,
    base(buildTools(deniedWrites), [
      ...askToLog,
      ...first.messages,
      approvalResponse(first.approvals, false),
    ]),
  );
  results.push({
    name: "stream-deny",
    outcome: deniedWrites.logged.length === 0 ? "pass" : "fail",
    detail:
      deniedWrites.logged.length === 0
        ? `nothing written, model ${denied.text ? `answered ${denied.text.length} chars` : "stayed silent so the app must word the denial"}`
        : `wrote ${deniedWrites.logged.length} despite the denial`,
  });

  return results;
}

const repair: ToolCallRepairFunction<ToolSet> = async ({ toolCall, tools, error }) => {
  if (!NoSuchToolError.isInstance(error)) return null;
  const cleaned = toolCall.toolName.split(CORRUPT_SUFFIX)[0];
  if (!(cleaned in tools)) return null;
  return { ...toolCall, toolName: cleaned };
};

async function repairCases(model: ResolvedModel): Promise<CaseResult[]> {
  const results: CaseResult[] = [];

  const offWrites: WriteLog = { logged: [] };
  const offLog: CorruptionLog = { hits: 0 };
  const off = await runStream(
    corruptingModel(model.languageModel, WRITE_TOOL, offLog),
    base(buildTools(offWrites), askToLog),
  );
  results.push({
    name: "corrupt-repro",
    outcome: offLog.hits > 0 && !off.approvals.length ? "pass" : offLog.hits ? "fail" : "error",
    detail: !offLog.hits
      ? `the model never called ${WRITE_TOOL}, nothing to corrupt`
      : off.approvals.length
        ? `corrupted ${offLog.hits} call(s) but an approval was still requested`
        : `corrupted ${offLog.hits} call(s), no approval, no write, error surfaced on fullStream: ${off.errors[0] ?? "NONE"}, model still answered ${off.text.length} chars: ${JSON.stringify(off.text.slice(0, 90))}`,
  });
  if (!offLog.hits) return results;

  await wait(PAUSE_MS);

  const onWrites: WriteLog = { logged: [] };
  const onLog: CorruptionLog = { hits: 0 };
  let on;
  try {
    on = await runStream(
      corruptingModel(model.languageModel, WRITE_TOOL, onLog),
      { ...base(buildTools(onWrites), askToLog), repairToolCall: repair },
    );
  } catch (error) {
    results.push({
      name: "repair-approval",
      outcome: "error",
      detail: describe(error),
    });
    return results;
  }

  const repaired = on.approvals.some((approval) => approval.toolName === WRITE_TOOL);
  results.push({
    name: "repair-approval",
    outcome: repaired && onWrites.logged.length === 0 ? "pass" : "fail",
    detail: repaired
      ? onWrites.logged.length === 0
        ? `repairToolCall fixed the name and the repaired call STILL asked for approval, nothing written`
        : `repaired call BYPASSED approval and wrote ${JSON.stringify(onWrites.logged[0])}`
      : `repair did not produce an approval: corrupted=${onLog.hits}, approvals=${on.approvals.length}, writes=${onWrites.logged.length}, errors=${on.errors.join("|") || "none"}`,
  });

  if (!repaired || onWrites.logged.length) return results;

  await wait(PAUSE_MS);

  const resumeWrites: WriteLog = { logged: [] };
  const resumeLog: CorruptionLog = { hits: 0 };
  const resumed = await runStream(
    corruptingModel(model.languageModel, WRITE_TOOL, resumeLog),
    {
      ...base(buildTools(resumeWrites), [
        ...askToLog,
        ...on.messages,
        approvalResponse(on.approvals, true),
      ]),
      repairToolCall: repair,
    },
  );
  results.push({
    name: "repair-resume",
    outcome: resumeWrites.logged.length === 1 ? "pass" : "fail",
    detail:
      resumeWrites.logged.length === 1
        ? `approving a repaired call wrote ${JSON.stringify(resumeWrites.logged[0])}`
        : `writes=${resumeWrites.logged.length}, errors=${resumed.errors.join("|") || "none"}`,
  });

  return results;
}

async function main() {
  const only = process.env.ONLY;
  const { resolved, skipped } = resolveAll(loadCandidates(CANDIDATES_FILE));
  for (const { ref, reason } of skipped) {
    console.log(`\n${ref.label ?? ref.model}\n  SKIPPED  ${reason}`);
  }

  for (const model of resolved) {
    if (only !== "repair") {
      try {
        report(`${model.label} [streaming]`, await streamingCases(model));
      } catch (error) {
        report(`${model.label} [streaming]`, [
          { name: "stream-pauses", outcome: "error", detail: describe(error) },
        ]);
      }
      await wait(PAUSE_MS);
    }
    if (only !== "stream") {
      try {
        report(`${model.label} [repair]`, await repairCases(model));
      } catch (error) {
        report(`${model.label} [repair]`, [
          { name: "corrupt-repro", outcome: "error", detail: describe(error) },
        ]);
      }
      await wait(PAUSE_MS);
    }
  }
}

main();
