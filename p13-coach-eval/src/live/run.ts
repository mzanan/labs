import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { asUser, assertNotProd, connect, requireEnv, type Row } from "./db";
import { openSession } from "./session";

interface SeedRef { seed: string; day: "today" | "yesterday" }
interface Case { id: string; q: string; expect: string; seeds?: SeedRef[] }
interface Seed { category: string; name: string; protein_g: number; fat_g: number; carbs_g: number; catalog_item_id: string | null }
interface Config { timezoneOffsetHours: number; dayCutoffHour: number; seeds: Record<string, Seed>; cases: Case[] }
interface Meal extends Row { id: string; logical_day: string; name: string; protein_g: number; fat_g: number; carbs_g: number; alcohol_g: number }
interface CoachEvent { type?: string; tool?: string; text?: string; approvalId?: string }

const config = JSON.parse(readFileSync(new URL("../../live-cases.json", import.meta.url), "utf8")) as Config;

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}

function logicalDay(offsetDays: number): string {
  const shifted = Date.now() + (config.timezoneOffsetHours - config.dayCutoffHour) * 3_600_000;
  return new Date(shifted - offsetDays * 86_400_000).toISOString().slice(0, 10);
}

async function post(url: string, cookie: string, body: unknown): Promise<CoachEvent[]> {
  const response = await fetch(url, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await response.text())
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as CoachEvent;
      } catch {
        return { type: "unparsed", text: line };
      }
    });
}

const fmt = (m: Meal) =>
  `${m.logical_day} ${m.name.slice(0, 70)} | P${m.protein_g} F${m.fat_g} C${m.carbs_g} A${m.alcohol_g}`;

async function main() {
  const devUrl = requireEnv("DEV_DATABASE_URL");
  assertNotProd(devUrl);
  const userId = requireEnv("EVAL_USER_ID");
  const base = process.env.EVAL_BASE_URL ?? "http://localhost:3040";
  const model = arg("model");
  const only = arg("only")?.split(",");
  const cases = config.cases.filter((c) => !only || only.includes(c.id));
  const days = { today: logicalDay(0), yesterday: logicalDay(1) };
  const db = await connect(devUrl);
  const q = <T extends Row = Row>(sql: string, params: unknown[] = []) => asUser<T>(db, userId, sql, params);

  if (model) await q("update ai_credentials set model=$2 where user_id=$1 and provider='explabs'", [userId, model]);
  const [active] = await q<{ model: string }>("select model from ai_credentials where user_id=$1 and provider='explabs'", [userId]);
  await q("delete from meals where user_id=$1 and id like 'eval-%'", [userId]);
  const session = await openSession(db, userId, requireEnv("BETTER_AUTH_SECRET"));
  const out = [`# Live coach eval ${new Date().toISOString()}`, `model: ${active?.model}`, `days: ${days.today} / ${days.yesterday}`];

  try {
    for (const c of cases) {
      await q("delete from coach_pending_writes where user_id=$1", [userId]);
      await q("delete from coach_messages where user_id=$1", [userId]);
      const seedIds: string[] = [];
      for (const [index, ref] of (c.seeds ?? []).entries()) {
        const seed = config.seeds[ref.seed];
        const id = `eval-${c.id}-${index}`;
        seedIds.push(id);
        await q(
          "insert into meals (id,user_id,logical_day,category,name,protein_g,fat_g,carbs_g,alcohol_g,catalog_item_id,created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,0,$9,now())",
          [id, userId, days[ref.day], seed.category, seed.name, seed.protein_g, seed.fat_g, seed.carbs_g, seed.catalog_item_id],
        );
      }
      const dayList = [days.today, days.yesterday];
      const before = await q<Meal>("select * from meals where user_id=$1 and logical_day = any($2)", [userId, dayList]);
      const started = Date.now();
      let events = await post(`${base}/api/coach`, session.cookie, { question: c.q });
      const approval = events.find((e) => e.type === "approval");
      if (approval) {
        events = events.concat(await post(`${base}/api/coach/approve`, session.cookie, { approvalId: approval.approvalId, approved: true }));
      }
      const after = await q<Meal>("select * from meals where user_id=$1 and logical_day = any($2)", [userId, dayList]);
      const beforeById = new Map(before.map((m) => [m.id, m]));
      const afterIds = new Set(after.map((m) => m.id));
      const added = after.filter((m) => !beforeById.has(m.id));
      const removed = before.filter((m) => !afterIds.has(m.id));
      const changed = after.filter((m) => beforeById.has(m.id) && JSON.stringify(m) !== JSON.stringify(beforeById.get(m.id)));
      const tools = events.filter((e) => e.type === "status").map((e) => e.tool).join(",");
      const reply = events.filter((e) => e.type === "done").map((e) => e.text).join(" ").replace(/\n+/g, " ");
      out.push(
        `\n## ${c.id}. "${c.q}"`,
        `expect: ${c.expect}`,
        `time: ${((Date.now() - started) / 1000).toFixed(1)}s | tools: ${tools}${approval ? " | approval card" : ""}`,
        `added: ${added.map(fmt).join(" || ") || "none"}`,
        `removed: ${removed.map(fmt).join(" || ") || "none"}`,
        `changed: ${changed.map((m) => `${fmt(beforeById.get(m.id) as Meal)} => ${fmt(m)}`).join(" || ") || "none"}`,
        `reply: ${reply.slice(0, 600)}`,
      );

      const leftovers = [...added.map((m) => m.id), ...seedIds];
      if (leftovers.length) await q("delete from meals where user_id=$1 and id = any($2)", [userId, leftovers]);
      for (const m of removed.filter((m) => !seedIds.includes(m.id))) {
        await q(
          "insert into meals (id,user_id,logical_day,category,name,place,protein_g,fat_g,carbs_g,alcohol_g,fat_quality,catalog_item_id,created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
          [m.id, userId, m.logical_day, m.category, m.name, m.place, m.protein_g, m.fat_g, m.carbs_g, m.alcohol_g, m.fat_quality, m.catalog_item_id, m.created_at],
        );
      }
      for (const m of changed.filter((m) => !seedIds.includes(m.id))) {
        const o = beforeById.get(m.id) as Meal;
        await q("update meals set name=$2, category=$3, protein_g=$4, fat_g=$5, carbs_g=$6, alcohol_g=$7 where id=$1", [o.id, o.name, o.category, o.protein_g, o.fat_g, o.carbs_g, o.alcohol_g]);
      }
      console.log(`${c.id} done`);
    }
  } finally {
    await session.close();
    const dir = new URL("../../results/raw/live/", import.meta.url);
    mkdirSync(dir, { recursive: true });
    const file = new URL(`${new Date().toISOString().replace(/[:.]/g, "-")}-${active?.model ?? "model"}.md`, dir);
    writeFileSync(file, `${out.join("\n")}\n`);
    console.log(`results: ${file.pathname}`);
    await db.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
