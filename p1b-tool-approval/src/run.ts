import { readFileSync } from "node:fs";

import { generateText, isStepCount, type ModelMessage } from "ai";

import {
  isProviderId,
  resolveAll,
  type ModelRef,
  type ResolvedModel,
} from "./providers.js";
import {
  INSTRUCTIONS,
  MAX_STEPS,
  PAUSE_MS,
  PROMPT,
  TIMEOUT_MS,
  type CaseResult,
} from "./scenario.js";
import { buildTools, type WriteLog } from "./tools.js";

const CANDIDATES_FILE = process.env.CANDIDATES_FILE ?? "candidates.json";

type Approval = {
  approvalId: string;
  toolName: string;
  input: unknown;
};

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

function approvalsIn(messages: ModelMessage[]): Approval[] {
  const found: Approval[] = [];
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content as Record<string, unknown>[]) {
      if (part.type === "tool-approval-request") {
        const call = part.toolCall as Record<string, unknown> | undefined;
        found.push({
          approvalId: String(part.approvalId),
          toolName: String(call?.toolName ?? "unknown"),
          input: call?.input,
        });
      }
    }
  }
  return found;
}

async function firstPass(model: ResolvedModel, writes: WriteLog) {
  return generateText({
    model: model.languageModel,
    instructions: INSTRUCTIONS,
    prompt: PROMPT,
    tools: buildTools(writes),
    toolApproval: { log_meal: "user-approval" },
    stopWhen: isStepCount(MAX_STEPS),
    maxOutputTokens: 1200,
    abortSignal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

async function resume(
  model: ResolvedModel,
  writes: WriteLog,
  history: ModelMessage[],
  approvals: Approval[],
  approved: boolean,
) {
  const responses: ModelMessage = {
    role: "tool",
    content: approvals.map((approval) => ({
      type: "tool-approval-response" as const,
      approvalId: approval.approvalId,
      approved,
    })),
  } as unknown as ModelMessage;

  return generateText({
    model: model.languageModel,
    instructions: INSTRUCTIONS,
    messages: [{ role: "user", content: PROMPT }, ...history, responses],
    tools: buildTools(writes),
    toolApproval: { log_meal: "user-approval" },
    stopWhen: isStepCount(MAX_STEPS),
    maxOutputTokens: 1200,
    abortSignal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

async function runCases(model: ResolvedModel): Promise<CaseResult[]> {
  const results: CaseResult[] = [];

  const writes: WriteLog = { logged: [] };
  let first;
  try {
    first = await firstPass(model, writes);
  } catch (error) {
    return [
      {
        name: "pauses",
        outcome: "error",
        detail: (error as Error).message.slice(0, 120),
      },
    ];
  }

  const approvals = approvalsIn(first.response.messages);
  results.push(
    approvals.length && writes.logged.length === 0
      ? {
          name: "pauses",
          outcome: "pass",
          detail: `asked for ${approvals.map((a) => a.toolName).join(",")}, nothing written`,
        }
      : {
          name: "pauses",
          outcome: "fail",
          detail: `approvals=${approvals.length}, writes=${writes.logged.length}`,
        },
  );
  if (!approvals.length) return results;

  await new Promise((r) => setTimeout(r, PAUSE_MS));

  const approvedWrites: WriteLog = { logged: [] };
  try {
    const second = await resume(
      model,
      approvedWrites,
      first.response.messages,
      approvals,
      true,
    );
    results.push(
      approvedWrites.logged.length === 1 && second.text.trim()
        ? {
            name: "approve",
            outcome: "pass",
            detail: `wrote ${JSON.stringify(approvedWrites.logged[0])}`,
          }
        : {
            name: "approve",
            outcome: "fail",
            detail: `writes=${approvedWrites.logged.length}, text=${second.text.trim().length}`,
          },
    );
  } catch (error) {
    results.push({
      name: "approve",
      outcome: "error",
      detail: (error as Error).message.slice(0, 120),
    });
  }

  await new Promise((r) => setTimeout(r, PAUSE_MS));

  const deniedWrites: WriteLog = { logged: [] };
  try {
    const third = await resume(
      model,
      deniedWrites,
      first.response.messages,
      approvals,
      false,
    );
    const denyText = third.text.trim();
    results.push(
      deniedWrites.logged.length === 0
        ? {
            name: "deny",
            outcome: "pass",
            detail: `nothing written${denyText ? ", model answered" : ", model said nothing (the app must word the denial itself)"}`,
          }
        : {
            name: "deny",
            outcome: "fail",
            detail: `wrote ${deniedWrites.logged.length} despite the denial`,
          },
    );

    if (!denyText) {
      try {
        await generateText({
          model: model.languageModel,
          instructions: INSTRUCTIONS,
          messages: [
            { role: "user", content: PROMPT },
            ...third.response.messages,
          ],
          maxOutputTokens: 1200,
          abortSignal: AbortSignal.timeout(TIMEOUT_MS),
        });
        results.push({
          name: "deny-replay",
          outcome: "pass",
          detail: "a tool-less closing call can still answer after a denial",
        });
      } catch (error) {
        results.push({
          name: "deny-replay",
          outcome: "fail",
          detail: `replaying the denied history throws: ${(error as Error).message.slice(0, 70)}`,
        });
      }
    }
  } catch (error) {
    results.push({
      name: "deny",
      outcome: "error",
      detail: (error as Error).message.slice(0, 120),
    });
  }

  return results;
}

async function main() {
  const { resolved, skipped } = resolveAll(loadCandidates(CANDIDATES_FILE));
  for (const { ref, reason } of skipped) {
    console.log(`\n${ref.label ?? ref.model}\n  SKIPPED  ${reason}`);
  }

  for (const model of resolved) {
    console.log(`\n${model.label}`);
    for (const result of await runCases(model)) {
      const mark = { pass: "PASS", fail: "FAIL", error: "ERR " }[result.outcome];
      console.log(`  ${mark}  ${result.name.padEnd(8)} ${result.detail}`);
    }
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }
}

main();
