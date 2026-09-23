import type { ModelMessage } from "ai";

import type { GateCall, GateDecision, GateJudge, GateVerdict } from "./types.js";

export type GateOutcome = "approved" | "denied" | "user-approval";

export interface GateThresholds {
  approveMin: number;
  denyMin: number;
}

export interface GateRecord {
  call: GateCall;
  verdict: GateVerdict;
  outcome: GateOutcome;
}

export interface ToolGateOptions {
  judge: GateJudge;
  thresholds?: Partial<GateThresholds>;
  onDecision?: (record: GateRecord) => void;
}

type ApprovalStatus =
  | { type: "approved"; reason?: string }
  | { type: "denied"; reason?: string }
  | "user-approval";

export const DEFAULT_THRESHOLDS: GateThresholds = { approveMin: 0.8, denyMin: 0.8 };

function scoreOf(verdict: GateVerdict, decision: GateDecision): number {
  if (verdict.probabilities) return verdict.probabilities[decision];
  if (verdict.decision !== decision) return 0;
  return verdict.confidence ?? 1;
}

export function outcomeOf(verdict: GateVerdict, thresholds: GateThresholds): GateOutcome {
  if (verdict.source === "fallback") return "user-approval";
  if (verdict.decision === "approve" && scoreOf(verdict, "approve") >= thresholds.approveMin) {
    return "approved";
  }
  if (verdict.decision === "deny" && scoreOf(verdict, "deny") >= thresholds.denyMin) {
    return "denied";
  }
  return "user-approval";
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (part && typeof part === "object" && "text" in part ? String(part.text) : ""))
    .join(" ")
    .trim();
}

export function latestUserMessage(messages: ModelMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") return textOf(messages[i].content);
  }
  return "";
}

export function createToolGate(options: ToolGateOptions) {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...options.thresholds };

  return async function toolApproval({
    toolCall,
    messages,
  }: {
    toolCall: { toolName: string; input: unknown };
    messages: ModelMessage[];
  }): Promise<ApprovalStatus> {
    const call: GateCall = {
      toolName: toolCall.toolName,
      input: toolCall.input,
      userMessage: latestUserMessage(messages),
    };
    const verdict = await options.judge.judge(call);
    const outcome = outcomeOf(verdict, thresholds);
    options.onDecision?.({ call, verdict, outcome });
    if (outcome === "approved") return { type: "approved", reason: verdict.reason };
    if (outcome === "denied") {
      return { type: "denied", reason: `Refused by the tool gate: ${verdict.reason}` };
    }
    return "user-approval";
  };
}
