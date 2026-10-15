import type { WriteChange } from "../grade/writes";
import type { WriteSummary } from "./records";

const NOISE_FIELDS = new Set(["id", "user_id", "created_at", "updated_at", "set_at", "embedding_model", "workout_id", "exercise_id"]);

export function summarizeWrite(change: WriteChange): WriteSummary {
  const source = change.after ?? change.before ?? {};
  const fields = Object.fromEntries(Object.entries(source).filter(([key, value]) => !NOISE_FIELDS.has(key) && value !== null));
  return { table: change.table, op: change.op, fields };
}
