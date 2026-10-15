import { EVAL_MODELS, parseModelList } from "./runConfig";

const MESSAGES_URL = "https://api.experientiallabs.ai/v1/messages";

const PROBE_TOOL = {
  name: "log_meal",
  description: "Log a meal the user ate. Call it whenever the user asks to log food.",
  input_schema: {
    type: "object",
    properties: {
      item_name: { type: "string" },
      category: { type: "string", enum: ["breakfast", "lunch", "snack", "dinner"] },
      portions: { type: "number" },
    },
    required: ["item_name", "category", "portions"],
  },
};

interface ProbeResult {
  model: string;
  toolCall: boolean;
  detail: string;
}

interface MessagesResponse {
  content?: { type: string; name?: string }[];
  stop_reason?: string;
  error?: { message?: string };
}

async function probe(model: string, apiKey: string): Promise<ProbeResult> {
  try {
    const response = await fetch(MESSAGES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system: "You are a nutrition logging assistant. Use the tools to act.",
        messages: [{ role: "user", content: "Registrá 2 huevos duros en el desayuno." }],
        tools: [PROBE_TOOL],
      }),
      signal: AbortSignal.timeout(90_000),
    });
    const body = (await response.json()) as MessagesResponse;
    if (!response.ok) return { model, toolCall: false, detail: `http ${response.status}: ${body.error?.message ?? ""}`.slice(0, 160) };
    const call = body.content?.find((block) => block.type === "tool_use");
    return {
      model,
      toolCall: call?.name === PROBE_TOOL.name,
      detail: call ? `tool_use ${call.name}, stop_reason ${body.stop_reason}` : `no tool_use, stop_reason ${body.stop_reason}`,
    };
  } catch (error) {
    return { model, toolCall: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

async function main() {
  const apiKey = process.env.EXPLABS_API_KEY;
  if (!apiKey) throw new Error("EXPLABS_API_KEY is not set in the shell");
  const flag = process.argv.indexOf("--models");
  const models = flag > -1 ? parseModelList(process.argv[flag + 1]) : EVAL_MODELS;
  const results = await Promise.all(models.map((model) => probe(model, apiKey)));
  for (const result of results) {
    console.log(`${result.toolCall ? "PASS" : "FAIL"} ${result.model}: ${result.detail}`);
  }
}

void main();
