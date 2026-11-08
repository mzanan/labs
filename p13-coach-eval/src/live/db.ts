import pg from "pg";

export type Row = Record<string, unknown>;

export async function connect(url: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

export async function asUser<T extends Row = Row>(
  client: pg.Client,
  userId: string,
  sql: string,
  params: unknown[] = [],
  readOnly = false,
): Promise<T[]> {
  await client.query(readOnly ? "begin read only" : "begin");
  await client.query(
    "select set_config('app.user_id',$1,true), set_config('app.source','app',true), set_config('app.ledger_id','',true)",
    [userId],
  );
  try {
    const result = await client.query(sql, params);
    await client.query(readOnly ? "rollback" : "commit");
    return result.rows as T[];
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function assertNotProd(devUrl: string): void {
  const prod = process.env.PROD_DATABASE_URL;
  if (prod && new URL(prod).hostname === new URL(devUrl).hostname) {
    throw new Error("DEV_DATABASE_URL points at the production host");
  }
}
