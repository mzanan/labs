import type { Client } from "@libsql/client";
import { embed, toVectorLiteral, cosineDistance } from "./embeddings.js";

export const DEDUP_MAX_DISTANCE = Number(process.env.DEDUP_MAX_DISTANCE ?? 0.06);
export const RETRIEVAL_MAX_DISTANCE = Number(process.env.RETRIEVAL_MAX_DISTANCE ?? 0.45);
export const SUPERSESSION_MAX_DISTANCE = Number(process.env.SUPERSESSION_MAX_DISTANCE ?? 0.45);
export const RETRIEVAL_LIMIT = Number(process.env.RETRIEVAL_LIMIT ?? 8);

export interface Fact {
  id: string;
  content: string;
  category: string;
  distance: number;
  active?: number;
  superseded_by?: string | null;
  created_at?: number;
}

let counter = 0;
function newId(): string {
  counter += 1;
  return `fact_${counter}`;
}

async function nearest(
  client: Client,
  userId: string,
  literal: string,
  opts: { onlyActive: boolean } = { onlyActive: false },
): Promise<{ id: string; distance: number; created_at: number } | null> {
  const activeClause = opts.onlyActive ? "AND active = 1" : "";
  const res = await client.execute({
    sql: `
      SELECT id, created_at, vector_distance_cos(embedding, vector32(?)) AS distance
      FROM facts
      WHERE user_id = ? AND embedding IS NOT NULL ${activeClause}
      ORDER BY distance ASC
      LIMIT 1
    `,
    args: [literal, userId],
  });
  const row = res.rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    distance: Number(row.distance),
    created_at: Number(row.created_at),
  };
}

/** Reproduces fit-coach's src/lib/ai/facts.ts saveFact exactly: dedup by nearest same-user fact, no supersession. */
export async function saveFactBaseline(
  client: Client,
  userId: string,
  content: string,
  category: string,
  source: string,
  createdAt: number,
): Promise<void> {
  const literal = toVectorLiteral(await embed(content));
  const near = await nearest(client, userId, literal);

  if (near && near.distance <= DEDUP_MAX_DISTANCE) {
    await client.execute({
      sql: `UPDATE facts SET content = ?, embedding = vector32(?), source = ?, updated_at = ? WHERE id = ?`,
      args: [content, literal, source, createdAt, near.id],
    });
    return;
  }

  await client.execute({
    sql: `INSERT INTO facts (id, user_id, content, category, embedding, source, active, superseded_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, vector32(?), ?, 1, NULL, ?, ?)`,
    args: [newId(), userId, content, category, literal, source, createdAt, createdAt],
  });
}

/** Adds the Zep/TOKI-style additive mechanism: an explicit correction marks the nearest active fact superseded instead of leaving both active. */
export async function saveFactV2(
  client: Client,
  userId: string,
  content: string,
  category: string,
  source: string,
  createdAt: number,
): Promise<{ superseded: string | null }> {
  const literal = toVectorLiteral(await embed(content));
  const near = await nearest(client, userId, literal, { onlyActive: true });

  if (near && near.distance <= DEDUP_MAX_DISTANCE) {
    await client.execute({
      sql: `UPDATE facts SET content = ?, embedding = vector32(?), source = ?, updated_at = ? WHERE id = ?`,
      args: [content, literal, source, createdAt, near.id],
    });
    return { superseded: null };
  }

  const id = newId();
  let superseded: string | null = null;
  if (category === "correction" && near && near.distance <= SUPERSESSION_MAX_DISTANCE) {
    await client.execute({
      sql: `UPDATE facts SET active = 0, superseded_by = ? WHERE id = ?`,
      args: [id, near.id],
    });
    superseded = near.id;
  }

  await client.execute({
    sql: `INSERT INTO facts (id, user_id, content, category, embedding, source, active, superseded_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, vector32(?), ?, 1, NULL, ?, ?)`,
    args: [id, userId, content, category, literal, source, createdAt, createdAt],
  });
  return { superseded };
}

async function semanticMatches(
  client: Client,
  userId: string,
  literal: string,
  onlyActive: boolean,
): Promise<(Fact & { vector: number[] })[]> {
  const activeClause = onlyActive ? "AND active = 1" : "";
  const res = await client.execute({
    sql: `
      SELECT id, content, category, active, superseded_by, created_at,
             vector_extract(embedding) AS vector_json,
             vector_distance_cos(embedding, vector32(?)) AS distance
      FROM facts
      WHERE user_id = ? AND embedding IS NOT NULL ${activeClause}
      ORDER BY distance ASC
      LIMIT ?
    `,
    args: [literal, userId, RETRIEVAL_LIMIT],
  });
  return res.rows
    .map((r) => ({
      id: String(r.id),
      content: String(r.content),
      category: String(r.category),
      distance: Number(r.distance),
      active: Number(r.active),
      superseded_by: r.superseded_by as string | null,
      created_at: Number(r.created_at),
      vector: JSON.parse(String(r.vector_json)) as number[],
    }))
    .filter((r) => r.distance <= RETRIEVAL_MAX_DISTANCE);
}

/** Reproduces fit-coach's retrieveFacts: semantic matches under the retrieval threshold, no active filter, no conflict resolution. */
export async function retrieveBaseline(
  client: Client,
  userId: string,
  query: string,
): Promise<Fact[]> {
  const literal = toVectorLiteral(await embed(query));
  return semanticMatches(client, userId, literal, false);
}

/** Adds: filter to active rows, then collapse same-slot clusters (mutual distance <= sameSlotDistance) keeping only the newest, so an unresolved conflict (no explicit correction) still can't return two contradictory facts. */
export async function retrieveV2(
  client: Client,
  userId: string,
  query: string,
  sameSlotDistance = SUPERSESSION_MAX_DISTANCE,
): Promise<Fact[]> {
  const literal = toVectorLiteral(await embed(query));
  const matches = await semanticMatches(client, userId, literal, true);

  const kept: (Fact & { vector: number[] })[] = [];
  for (const fact of matches.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))) {
    const clashesWithNewer = kept.some(
      (k) => cosineDistance(fact.vector, k.vector) <= sameSlotDistance,
    );
    if (!clashesWithNewer) kept.push(fact);
  }
  return kept.map((k) => ({
    id: k.id,
    content: k.content,
    category: k.category,
    distance: k.distance,
    active: k.active,
    superseded_by: k.superseded_by,
    created_at: k.created_at,
  }));
}
