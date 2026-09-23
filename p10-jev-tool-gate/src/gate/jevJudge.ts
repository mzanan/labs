import {
  DEFAULT_POLICY,
  GATE_DECISIONS,
  type GateCall,
  type GateDecision,
  type GateJudge,
  type GatePolicy,
  type GateVerdict,
} from "./types.js";

export interface JevJudgeOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  policy?: GatePolicy;
  timeoutMs?: number;
  retries?: number;
  fetchImpl?: typeof fetch;
}

interface ChoiceAnswer {
  type: "choice";
  choice: string;
  confidence?: number;
  probabilities?: Record<string, number>;
}

interface SystemOneResponse {
  answers?: Record<string, ChoiceAnswer>;
  usage?: { cost?: number };
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

function isDecision(value: string): value is GateDecision {
  return (GATE_DECISIONS as readonly string[]).includes(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createJevJudge(options: JevJudgeOptions): GateJudge {
  const model = options.model ?? "typesafe/jev-1.13";
  const baseUrl = options.baseUrl ?? "https://openrouter.ai/api/v1";
  const policy = options.policy ?? DEFAULT_POLICY;
  const timeoutMs = options.timeoutMs ?? 8000;
  const retries = options.retries ?? 1;
  const doFetch = options.fetchImpl ?? fetch;

  async function call(body: unknown): Promise<SystemOneResponse> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await doFetch(`${baseUrl}/systemone`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (response.ok) return (await response.json()) as SystemOneResponse;
        const text = await response.text();
        lastError = new Error(`systemone ${response.status}: ${text.slice(0, 300)}`);
        if (!RETRYABLE.has(response.status)) break;
      } catch (error) {
        lastError = error;
      }
      if (attempt < retries) await sleep(500 * (attempt + 1));
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  return {
    name: `jev:${model}`,
    async judge(gateCall: GateCall): Promise<GateVerdict> {
      const started = performance.now();
      const body = {
        model,
        state: {
          user_latest_message: gateCall.userMessage,
          proposed_tool_call: { tool: gateCall.toolName, input: gateCall.input },
        },
        questions: {
          decision: {
            type: "choice",
            instructions:
              "An AI assistant wants to run this tool call on the user's behalf. Decide whether it runs now, waits for a human, or is refused.",
            criteria: { ...policy },
          },
        },
      };
      try {
        const data = await call(body);
        const answer = data.answers?.decision;
        if (!answer || !isDecision(answer.choice)) {
          throw new Error(`unexpected answer: ${JSON.stringify(data).slice(0, 300)}`);
        }
        const probabilities = Object.fromEntries(
          GATE_DECISIONS.map((d) => [d, answer.probabilities?.[d] ?? 0]),
        ) as Record<GateDecision, number>;
        return {
          decision: answer.choice,
          probabilities,
          confidence: answer.confidence ?? null,
          reason: `jev chose ${answer.choice} (p=${probabilities[answer.choice].toFixed(2)})`,
          latencyMs: Math.round(performance.now() - started),
          costUsd: data.usage?.cost ?? 0,
          source: "jev",
        };
      } catch (error) {
        return {
          decision: "escalate",
          probabilities: null,
          confidence: null,
          reason: "jev unavailable, sent to a human",
          latencyMs: Math.round(performance.now() - started),
          costUsd: 0,
          source: "fallback",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
