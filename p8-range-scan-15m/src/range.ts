import { clusterPivots, countRotations, eligibleLevels } from "./levels.ts";
import { scoreRange } from "./score.ts";
import { findPivots } from "./pivots.ts";
import type { ActiveRange, Candle, Config, Level } from "./types.ts";

export function impulseRatio(
  candles: Candle[],
  startIndex: number,
  rangeHeight: number,
  lookback: number,
): number | null {
  const from = Math.max(0, startIndex - lookback);
  if (startIndex - from < lookback / 4 || !(rangeHeight > 0)) return null;

  const approach = candles.slice(from, startIndex + 1);
  const atStart = candles[startIndex]!.close;
  const travelled = Math.max(
    Math.abs(atStart - Math.max(...approach.map((candle) => candle.high))),
    Math.abs(atStart - Math.min(...approach.map((candle) => candle.low))),
  );
  return travelled / rangeHeight;
}

function outsidePct(candles: Candle[], from: number, low: number, high: number): number {
  const window = candles.slice(from);
  if (window.length === 0) return Number.NaN;
  const outside = window.filter((candle) => candle.close < low || candle.close > high).length;
  return (outside / window.length) * 100;
}

export function buildRange(
  candles: Candle[],
  support: Level,
  resistance: Level,
  config: Config,
): ActiveRange {
  const lastIndex = candles.length - 1;
  const startIndex = Math.min(support.firstTouchIndex, resistance.firstTouchIndex);
  const low = support.price;
  const high = resistance.price;

  return {
    startIndex,
    startTime: candles[startIndex]!.openTime,
    candlesInRange: candles.length - startIndex,
    low,
    high,
    widthPct: ((high - low) / low) * 100,
    outsidePct: outsidePct(candles, startIndex, low, high),
    rotations: countRotations(support, resistance),
    impulseRatio: impulseRatio(candles, startIndex, high - low, config.impulse.lookbackCandles),
    lowTouches: support.touches,
    highTouches: resistance.touches,
    candlesSinceLowTouch: lastIndex - support.lastTouchIndex,
    candlesSinceHighTouch: lastIndex - resistance.lastTouchIndex,
    candlesSinceLastTouch: Math.min(
      lastIndex - support.lastTouchIndex,
      lastIndex - resistance.lastTouchIndex,
    ),
  };
}

export function detectActiveRange(candles: Candle[], config: Config): ActiveRange | null {
  const { pivotStrength, clusterTolerancePct, minTouchesPerLevel, maxCandlesSinceTouch } =
    config.range;

  const pivots = findPivots(candles, pivotStrength);
  if (pivots.length === 0) return null;

  const lastIndex = candles.length - 1;
  const price = candles[lastIndex]!.close;

  const supports = eligibleLevels(
    clusterPivots(
      pivots.filter((pivot) => pivot.kind === "low"),
      clusterTolerancePct,
    ),
    "support",
    price,
    minTouchesPerLevel,
    maxCandlesSinceTouch,
    lastIndex,
  );
  const resistances = eligibleLevels(
    clusterPivots(
      pivots.filter((pivot) => pivot.kind === "high"),
      clusterTolerancePct,
    ),
    "resistance",
    price,
    minTouchesPerLevel,
    maxCandlesSinceTouch,
    lastIndex,
  );

  let best: ActiveRange | null = null;
  let bestScore = -1;

  for (const support of supports) {
    for (const resistance of resistances) {
      const range = buildRange(candles, support, resistance, config);
      if (range.widthPct < config.filters.minRangeWidthPct) continue;
      if (range.widthPct > config.filters.maxRangeWidthPct) continue;
      if (range.outsidePct > config.filters.maxOutsidePct) continue;

      const score = scoreRange(range, config).total;
      if (score > bestScore) {
        bestScore = score;
        best = range;
      }
    }
  }

  return best;
}
