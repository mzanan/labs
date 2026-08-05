import { createClient, type Client } from "@libsql/client";

const DIM = Number(process.env.AI_EMBEDDING_DIM ?? 768);

export async function openDb(path: string): Promise<Client> {
  const client = createClient({ url: `file:${path}` });
  await client.execute(`
    CREATE TABLE IF NOT EXISTS facts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT NOT NULL,
      embedding F32_BLOB(${DIM}),
      source TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      superseded_by TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  return client;
}

export async function resetDb(client: Client): Promise<void> {
  await client.execute("DELETE FROM facts");
}
