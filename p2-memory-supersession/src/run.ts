import { readFileSync } from "node:fs";
import { embed, cosineDistance } from "./embeddings.js";
import { openDb, resetDb } from "./db.js";
import {
  saveFactBaseline,
  saveFactV2,
  retrieveBaseline,
  retrieveV2,
  DEDUP_MAX_DISTANCE,
  RETRIEVAL_MAX_DISTANCE,
  SUPERSESSION_MAX_DISTANCE,
} from "./memory.js";

interface Scenarios {
  distancePairs: {
    name: string;
    original: { content: string; category: string };
    correction: { content: string; category: string };
    expect: "supersede" | "distinct";
  }[];
  timeline: {
    userId: string;
    events: { content: string; category: string; source: string; atMinute: number }[];
    query: string;
  };
}

const scenarios: Scenarios = JSON.parse(readFileSync(new URL("../scenarios.json", import.meta.url), "utf8"));

async function part1DistanceMeasurement() {
  console.log("\n=== Part 1: real cosine distances, opposite-polarity vs distinct facts ===");
  console.log(`Existing calibrated thresholds: retrieval=${RETRIEVAL_MAX_DISTANCE}, dedup=${DEDUP_MAX_DISTANCE}\n`);

  const results: { name: string; expect: string; distance: number }[] = [];
  for (const pair of scenarios.distancePairs) {
    const [vOriginal, vCorrection] = await Promise.all([
      embed(pair.original.content),
      embed(pair.correction.content),
    ]);
    const distance = cosineDistance(vOriginal, vCorrection);
    results.push({ name: pair.name, expect: pair.expect, distance });
    console.log(
      `[${pair.expect === "supersede" ? "SHOULD SUPERSEDE" : "SHOULD STAY DISTINCT"}] ${pair.name}: distance=${distance.toFixed(4)}`,
    );
    console.log(`   original:   "${pair.original.content}"`);
    console.log(`   correction: "${pair.correction.content}"`);
  }

  const supersedeDistances = results.filter((r) => r.expect === "supersede").map((r) => r.distance);
  const distinctDistances = results.filter((r) => r.expect === "distinct").map((r) => r.distance);
  const maxSupersede = Math.max(...supersedeDistances);
  const minDistinct = Math.min(...distinctDistances);
  const separates = maxSupersede < minDistinct;

  console.log(
    `\nSupersede-pair distances: [${supersedeDistances.map((d) => d.toFixed(4)).join(", ")}] (max ${maxSupersede.toFixed(4)})`,
  );
  console.log(
    `Distinct-pair distances:  [${distinctDistances.map((d) => d.toFixed(4)).join(", ")}] (min ${minDistinct.toFixed(4)})`,
  );
  console.log(
    separates
      ? `RESULT: a threshold band exists between ${maxSupersede.toFixed(4)} and ${minDistinct.toFixed(4)} that separates the two classes cleanly.`
      : `RESULT: NO clean separation, similarity alone cannot distinguish "same slot, opposite polarity" from "genuinely distinct facts" for these examples.`,
  );

  return { maxSupersede, minDistinct, separates };
}

async function part2TimelineComparison() {
  console.log("\n=== Part 2: timeline replay, baseline vs v2 (active/superseded_by + newest-wins) ===");

  const baselineDb = await openDb("baseline.db");
  const v2Db = await openDb("v2.db");
  await resetDb(baselineDb);
  await resetDb(v2Db);

  const { userId, events, query } = scenarios.timeline;
  const baseTime = Date.now();

  for (const ev of events) {
    const createdAt = baseTime + ev.atMinute * 60_000;
    console.log(`\n-- event: [${ev.category}] "${ev.content}"`);
    await saveFactBaseline(baselineDb, userId, ev.content, ev.category, ev.source, createdAt);
    const { superseded } = await saveFactV2(v2Db, userId, ev.content, ev.category, ev.source, createdAt);
    console.log(superseded ? `   v2: superseded fact ${superseded}` : "   v2: no supersession triggered");
  }

  console.log(`\nQuery: "${query}"`);

  const baselineResults = await retrieveBaseline(baselineDb, userId, query);
  console.log(`\nBASELINE retrieval (today's fit-coach behavior), ${baselineResults.length} facts returned:`);
  for (const f of baselineResults) console.log(`   [${f.category}] "${f.content}" (distance ${f.distance.toFixed(4)})`);

  const v2Results = await retrieveV2(v2Db, userId, query);
  console.log(`\nV2 retrieval, default same-slot=${SUPERSESSION_MAX_DISTANCE} (active filter + newest-wins), ${v2Results.length} facts returned:`);
  for (const f of v2Results) console.log(`   [${f.category}] "${f.content}" (distance ${f.distance.toFixed(4)})`);

  const TIGHT_SAME_SLOT = 0.06;
  const v2Tight = await retrieveV2(v2Db, userId, query, TIGHT_SAME_SLOT);
  console.log(`\nV2 retrieval, tight same-slot=${TIGHT_SAME_SLOT} (dedup-level), ${v2Tight.length} facts returned:`);
  for (const f of v2Tight) console.log(`   [${f.category}] "${f.content}" (distance ${f.distance.toFixed(4)})`);

  const hasBothTrainingFacts = (facts: { content: string }[]) =>
    facts.some((f) => f.content === "The user prefers training in the morning.") &&
    facts.some((f) => f.content === "The user now prefers training in the evening instead of the morning.");
  const hasStaleQuinoa = (facts: { content: string }[]) =>
    facts.some((f) => f.content === "The user enjoys quinoa and it appears often in meal suggestions.");
  const hasShellfish = (facts: { content: string }[]) => facts.some((f) => f.content.includes("shellfish"));

  console.log("\n--- Verdict signals (exact-content checks, not substring) ---");
  console.log(
    `Stale quinoa preference still returned: baseline=${hasStaleQuinoa(baselineResults)}, v2(0.45)=${hasStaleQuinoa(v2Results)}, v2(0.06)=${hasStaleQuinoa(v2Tight)} (should be false once corrected)`,
  );
  console.log(
    `Both contradictory training-time facts returned: baseline=${hasBothTrainingFacts(baselineResults)}, v2(0.45)=${hasBothTrainingFacts(v2Results)}, v2(0.06)=${hasBothTrainingFacts(v2Tight)} (should be false)`,
  );
  console.log(
    `Unrelated shellfish allergy fact survives: baseline=${hasShellfish(baselineResults)}, v2(0.45)=${hasShellfish(v2Results)}, v2(0.06)=${hasShellfish(v2Tight)} (should stay true, it must never be dropped)`,
  );
}

async function main() {
  const dist = await part1DistanceMeasurement();
  await part2TimelineComparison();
  console.log("\n=== Done. Copy the numbers above into README.md's measured section. ===");
  console.log(`SUPERSESSION_MAX_DISTANCE currently set to ${SUPERSESSION_MAX_DISTANCE}; part 1 measured separation up to ${dist.maxSupersede.toFixed(4)} / from ${dist.minDistinct.toFixed(4)}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
