const BASE_URL =
  process.env.AI_EMBEDDING_BASE_URL ??
  "https://generativelanguage.googleapis.com/v1beta";
const MODEL = process.env.AI_EMBEDDING_MODEL ?? "gemini-embedding-001";
const DIM = Number(process.env.AI_EMBEDDING_DIM ?? 768);

function apiKey(): string {
  const key = process.env.AI_EMBEDDING_API_KEY;
  if (!key) throw new Error("AI_EMBEDDING_API_KEY not set");
  return key;
}

export async function embed(text: string): Promise<number[]> {
  const key = apiKey();
  const res = await fetch(
    `${BASE_URL}/models/${MODEL}:embedContent?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: `models/${MODEL}`,
        content: { parts: [{ text }] },
        outputDimensionality: DIM,
      }),
    },
  );
  if (!res.ok) throw new Error(`embedding ${res.status}: ${await res.text()}`);

  const data = (await res.json()) as { embedding?: { values?: number[] } };
  const values = data.embedding?.values;
  if (!values?.length) throw new Error("embedding response had no values");
  if (values.length !== DIM) {
    throw new Error(`embedding dimension ${values.length} does not match configured ${DIM}`);
  }
  return normalize(values);
}

function normalize(values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
  if (!norm) throw new Error("embedding had zero magnitude");
  return values.map((v) => v / norm);
}

export function toVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

export function cosineDistance(a: number[], b: number[]): number {
  const dot = a.reduce((sum, v, i) => sum + v * b[i], 0);
  return 1 - dot;
}
