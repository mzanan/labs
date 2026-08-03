import {
  streamText,
  isStepCount,
  type LanguageModel,
  type ModelMessage,
  type ToolCallRepairFunction,
  type ToolSet,
} from "ai";

export interface Approval {
  approvalId: string;
  toolName: string;
  input: unknown;
  signed: boolean;
}

export interface StreamOutcome {
  text: string;
  approvals: Approval[];
  toolCalls: string[];
  errors: string[];
  messages: ModelMessage[];
}

export interface StreamOptions {
  instructions: string;
  messages: ModelMessage[];
  tools: ToolSet;
  approvalFor: string;
  maxSteps: number;
  maxOutputTokens: number;
  timeoutMs: number;
  repairToolCall?: ToolCallRepairFunction<ToolSet>;
}

export async function runStream(
  model: LanguageModel,
  options: StreamOptions,
): Promise<StreamOutcome> {
  const result = streamText({
    model,
    instructions: options.instructions,
    messages: options.messages,
    tools: options.tools,
    toolApproval: { [options.approvalFor]: "user-approval" },
    stopWhen: isStepCount(options.maxSteps),
    maxOutputTokens: options.maxOutputTokens,
    abortSignal: AbortSignal.timeout(options.timeoutMs),
    repairToolCall: options.repairToolCall,
  });

  const approvals: Approval[] = [];
  const toolCalls: string[] = [];
  const errors: string[] = [];
  let text = "";

  for await (const part of result.fullStream) {
    if (part.type === "tool-approval-request") {
      approvals.push({
        approvalId: part.approvalId,
        toolName: part.toolCall.toolName,
        input: part.toolCall.input,
        signed: Boolean(part.signature),
      });
    } else if (part.type === "tool-call") {
      toolCalls.push(part.toolName);
    } else if (part.type === "text-delta") {
      text += part.text;
    } else if (part.type === "error") {
      errors.push(describe(part.error));
    }
  }

  let messages: ModelMessage[] = [];
  try {
    messages = (await result.response).messages;
  } catch (error) {
    errors.push(describe(error));
  }

  return { text: text.trim(), approvals, toolCalls, errors, messages };
}

export function approvalResponse(
  approvals: Approval[],
  approved: boolean,
): ModelMessage {
  return {
    role: "tool",
    content: approvals.map((approval) => ({
      type: "tool-approval-response" as const,
      approvalId: approval.approvalId,
      approved,
    })),
  } as unknown as ModelMessage;
}

export function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
    try {
      return JSON.stringify(error);
    } catch {
      return "unserializable error";
    }
  }
  return String(error);
}
