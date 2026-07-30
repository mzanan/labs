export type Declared = {
  tools: boolean;
  structured: boolean;
};

type OpenRouterModel = {
  id: string;
  supported_parameters?: string[];
};

let cache: Map<string, Declared> | null = null;

export async function loadOpenRouterCapabilities(
  apiKey: string,
): Promise<Map<string, Declared>> {
  if (cache) return cache;
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new Error(`models endpoint ${response.status}`);
  const body = (await response.json()) as { data: OpenRouterModel[] };
  cache = new Map(
    body.data.map((model) => [
      model.id,
      {
        tools: (model.supported_parameters ?? []).includes("tools"),
        structured: (model.supported_parameters ?? []).includes("structured_outputs"),
      },
    ]),
  );
  return cache;
}

export function summarize(caps: Map<string, Declared>) {
  const all = [...caps.values()];
  return {
    total: all.length,
    withTools: all.filter((c) => c.tools).length,
    withStructured: all.filter((c) => c.structured).length,
  };
}
