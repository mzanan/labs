import type { Candle, Pivot } from "./types.ts";

export function findPivots(candles: Candle[], strength: number): Pivot[] {
  const pivots: Pivot[] = [];

  for (let i = strength; i < candles.length - strength; i += 1) {
    const candle = candles[i]!;
    let isHigh = true;
    let isLow = true;

    for (let offset = 1; offset <= strength; offset += 1) {
      const left = candles[i - offset]!;
      const right = candles[i + offset]!;
      if (left.high >= candle.high || right.high > candle.high) isHigh = false;
      if (left.low <= candle.low || right.low < candle.low) isLow = false;
    }

    if (isHigh) pivots.push({ index: i, price: candle.high, kind: "high" });
    if (isLow) pivots.push({ index: i, price: candle.low, kind: "low" });
  }

  return pivots;
}
