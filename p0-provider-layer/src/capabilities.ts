import type { ProviderId } from "./providers.js";

export type Declared = {
  tools: boolean | null;
  structured: boolean | null;
};

type OpenRouterModel = {
  id: string;
  supported_parameters?: string[];
};

type GatewayModel = {
  id: string;
  tags?: string[];
};

type EndpointRow = {
  providerName: string;
  tools: boolean;
};

const catalogueCache = new Map<ProviderId, Map<string, Declared>>();

async function loadOpenRouterCatalogue(apiKey: string): Promise<Map<string, Declared>> {
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new Error(`models endpoint ${response.status}`);
  const body = (await response.json()) as { data: OpenRouterModel[] };
  return new Map(
    body.data.map((model) => [
      model.id,
      {
        tools: (model.supported_parameters ?? []).includes("tools"),
        structured: (model.supported_parameters ?? []).includes("structured_outputs"),
      },
    ]),
  );
}

async function loadGatewayCatalogue(): Promise<Map<string, Declared>> {
  const response = await fetch("https://ai-gateway.vercel.sh/v1/models");
  if (!response.ok) throw new Error(`models endpoint ${response.status}`);
  const body = (await response.json()) as { data: GatewayModel[] };
  return new Map(
    body.data.map((model) => [
      model.id,
      {
        tools: (model.tags ?? []).includes("tool-use"),
        structured: null,
      },
    ]),
  );
}

export async function loadCapabilities(
  provider: ProviderId,
  apiKey: string,
): Promise<Map<string, Declared>> {
  const cached = catalogueCache.get(provider);
  if (cached) return cached;

  const loaded =
    provider === "openrouter" ? await loadOpenRouterCatalogue(apiKey) : await loadGatewayCatalogue();
  catalogueCache.set(provider, loaded);
  return loaded;
}

export async function loadOpenRouterCapabilities(
  apiKey: string,
): Promise<Map<string, Declared>> {
  return loadCapabilities("openrouter", apiKey);
}

export async function loadEndpoints(
  provider: ProviderId,
  modelId: string,
  apiKey?: string,
): Promise<EndpointRow[]> {
  if (provider === "openrouter") {
    const response = await fetch(`https://openrouter.ai/api/v1/models/${modelId}/endpoints`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
    });
    if (!response.ok) throw new Error(`endpoints ${response.status}`);
    const body = (await response.json()) as {
      data: {
        endpoints: { provider_name: string; tag?: string; supported_parameters?: string[] }[];
      };
    };
    return body.data.endpoints.map((endpoint) => ({
      providerName: (endpoint.tag?.split("/")[0] ?? endpoint.provider_name).toLowerCase(),
      tools: (endpoint.supported_parameters ?? []).includes("tools"),
    }));
  }

  const response = await fetch(`https://ai-gateway.vercel.sh/v1/models/${modelId}/endpoints`);
  if (!response.ok) throw new Error(`endpoints ${response.status}`);
  const body = (await response.json()) as {
    data: { endpoints: { provider_name: string; supported_parameters?: string[] }[] };
  };
  return body.data.endpoints.map((endpoint) => ({
    providerName: endpoint.provider_name.toLowerCase(),
    tools: (endpoint.supported_parameters ?? []).includes("tools"),
  }));
}

export function summarize(caps: Map<string, Declared>) {
  const all = [...caps.values()];
  return {
    total: all.length,
    withTools: all.filter((c) => c.tools === true).length,
    withStructured: all.filter((c) => c.structured === true).length,
  };
}
