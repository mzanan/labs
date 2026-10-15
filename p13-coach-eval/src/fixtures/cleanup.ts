import { evalBaseEmailPattern, evalEmailPattern } from "../runConfig";
import { ownerDb } from "./ownerDb";

async function deleteUsersLike(pattern: string): Promise<number> {
  const result = await ownerDb().query(`delete from "user" where email like $1`, [pattern]);
  return result.rowCount ?? 0;
}

export async function deleteEvalUser(userId: string): Promise<void> {
  await ownerDb().query(`delete from "user" where id = $1 and email like 'eval+%@fit-coach.test'`, [userId]);
}

export function deleteEvalRun(runId: string): Promise<number> {
  return deleteUsersLike(evalEmailPattern(runId));
}

export function deleteEvalBaseRun(baseRunId: string): Promise<number> {
  return deleteUsersLike(evalBaseEmailPattern(baseRunId));
}
