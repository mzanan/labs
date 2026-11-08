import { asUser, assertNotProd, connect, requireEnv, type Row } from "./db";

const TABLES = [
  "plans", "catalog_items", "catalog_components", "days", "meals", "workouts", "workout_exercises",
  "workout_sets", "routine_versions", "routine_slots", "routine_exercises", "user_rules", "user_facts",
  "coach_facts", "coach_memory", "health_events", "pending_items", "body_scans", "body_measurements", "fatigue_logs",
];

async function jsonColumns(client: Awaited<ReturnType<typeof connect>>, table: string): Promise<Set<string>> {
  const rows = await client.query(
    "select column_name from information_schema.columns where table_schema='public' and table_name=$1 and data_type like 'json%'",
    [table],
  );
  return new Set(rows.rows.map((row: { column_name: string }) => row.column_name));
}

function values(row: Row, names: string[], json: Set<string>): unknown[] {
  return names.map((name) => (json.has(name) && row[name] !== null ? JSON.stringify(row[name]) : row[name]));
}

async function main() {
  const devUrl = requireEnv("DEV_DATABASE_URL");
  assertNotProd(devUrl);
  const userId = requireEnv("EVAL_USER_ID");
  const prod = await connect(requireEnv("PROD_DATABASE_URL"));
  const dev = await connect(devUrl);

  const exported: Record<string, Row[]> = {};
  for (const table of ["profiles", ...TABLES]) {
    exported[table] = await asUser(prod, userId, `select * from "${table}" where user_id=$1`, [userId], true);
  }
  await prod.end();

  await dev.query("begin");
  await dev.query("select set_config('app.user_id',$1,true), set_config('app.source','app',true), set_config('app.ledger_id','',true)", [userId]);
  try {
    for (const table of [...TABLES].reverse()) {
      await dev.query(`delete from "${table}" where user_id=$1`, [userId]);
    }
    const profile = exported.profiles[0];
    if (profile) {
      const names = Object.keys(profile).filter((name) => name !== "user_id" && name !== "id");
      const json = await jsonColumns(dev, "profiles");
      await dev.query(
        `update profiles set ${names.map((name, i) => `"${name}"=$${i + 1}`).join(",")} where user_id=$${names.length + 1}`,
        [...values(profile, names, json), userId],
      );
    }
    for (const table of TABLES) {
      const json = await jsonColumns(dev, table);
      for (const row of exported[table]) {
        const names = Object.keys(row);
        await dev.query(
          `insert into "${table}" (${names.map((name) => `"${name}"`).join(",")}) values (${names.map((_, i) => `$${i + 1}`).join(",")})`,
          values(row, names, json),
        );
      }
      console.log(`${table}: ${exported[table].length}`);
    }
    await dev.query("commit");
  } catch (error) {
    await dev.query("rollback");
    throw error;
  } finally {
    await dev.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
