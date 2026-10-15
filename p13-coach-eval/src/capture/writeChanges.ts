import { ownerDb } from "../fixtures/ownerDb";
import type { WriteChange } from "../grade/writes";

interface ChangeRow {
  id: string;
  table_name: string;
  op: string;
  source: string;
  row_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export async function writeCursor(userId: string): Promise<number> {
  const { rows } = await ownerDb().query<{ id: string | null }>(
    "select max(id)::text as id from write_changes where user_id = $1",
    [userId],
  );
  return Number(rows[0]?.id ?? 0);
}

export async function writesSince(userId: string, cursor: number): Promise<WriteChange[]> {
  const { rows } = await ownerDb().query<ChangeRow>(
    "select id::text as id, table_name, op, source, row_id, before, after from write_changes where user_id = $1 and id > $2 order by id",
    [userId, cursor],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    table: row.table_name,
    op: row.op,
    source: row.source,
    rowId: row.row_id,
    before: row.before,
    after: row.after,
  }));
}

export interface MealRow {
  id: string;
  name: string;
  category: string;
  catalog_item_id: string | null;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
}

export async function mealsOn(userId: string, day: string): Promise<MealRow[]> {
  const { rows } = await ownerDb().query<MealRow>(
    "select id, name, category, catalog_item_id, protein_g, fat_g, carbs_g from meals where user_id = $1 and logical_day = $2 order by created_at",
    [userId, day],
  );
  return rows;
}
