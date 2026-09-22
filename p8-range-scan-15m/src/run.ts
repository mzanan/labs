import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { writeReport } from "./report.ts";
import { scan } from "./scan.ts";
import type { Candidate, Config } from "./types.ts";

function loadConfig(): Config {
  const path = new URL("../config.json", import.meta.url);
  return JSON.parse(readFileSync(path, "utf8")) as Config;
}

function price(value: number): string {
  if (!Number.isFinite(value)) return "na";
  if (value >= 100) return value.toFixed(2);
  if (value >= 1) return value.toFixed(4);
  return value.toFixed(6);
}

function day(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(5, 10);
}

function hours(candles: number): string {
  return `${Math.round(candles / 4)}h`;
}

function row(candidate: Candidate): Record<string, string> {
  const { range } = candidate;
  return {
    symbol: candidate.symbol,
    score: candidate.score.total.toFixed(0),
    low: price(range.low),
    high: price(range.high),
    width: `${range.widthPct.toFixed(1)}%`,
    since: day(range.startTime),
    days: (range.candlesInRange / 96).toFixed(0),
    touches: `${range.lowTouches}/${range.highTouches}`,
    rotations: String(range.rotations),
    lastLow: hours(range.candlesSinceLowTouch),
    lastHigh: hours(range.candlesSinceHighTouch),
    outside: `${range.outsidePct.toFixed(0)}%`,
    last: price(candidate.lastClose),
    posInRange: `${candidate.positionInRangePct.toFixed(0)}%`,
    toEdge: `${candidate.distanceToNearestEdgePct.toFixed(2)}%`,
    adx: candidate.adx.toFixed(1),
    vol24h: `${(candidate.quoteVolume24h / 1_000_000).toFixed(0)}M`,
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const startedAt = Date.now();
  const { scanned, candidates } = await scan(config);

  console.log(
    `bybit ${config.market.category}, live ranges on ${config.structure.interval}m over ${config.structure.lookbackCandles} candles, ${scanned} symbols scanned in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
  );

  if (candidates.length === 0) {
    console.log("no symbol has a live range right now, loosen filters in config.json");
    return;
  }

  console.table(candidates.map(row));

  const subtitle = `bybit ${config.market.category} &middot; ${config.structure.interval}m &middot; ${scanned} symbols scanned &middot; ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`;
  const reportPath = writeReport(candidates, subtitle, config);

  console.log(`report: ${reportPath}`);
  if (config.report.autoOpen) execFile("open", [reportPath]);
  console.log("price is inside every range listed, sorted by range quality score");
  console.log("candidates only, validate swings and volume profile on the chart before trading");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
