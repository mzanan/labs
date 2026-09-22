import { median } from "./indicators.ts";
import type { Level, Pivot } from "./types.ts";

export function clusterPivots(pivots: Pivot[], tolerancePct: number): Level[] {
  const sorted = [...pivots].sort((a, b) => a.price - b.price);
  const levels: Level[] = [];
  let bucket: Pivot[] = [];

  const flush = (): void => {
    if (bucket.length === 0) return;
    const prices = bucket.map((pivot) => pivot.price);
    const indexes = bucket.map((pivot) => pivot.index);
    levels.push({
      price: median(prices),
      kind: bucket[0]!.kind,
      touches: bucket.length,
      firstTouchIndex: Math.min(...indexes),
      lastTouchIndex: Math.max(...indexes),
      touchIndexes: [...indexes].sort((a, b) => a - b),
    });
    bucket = [];
  };

  for (const pivot of sorted) {
    if (bucket.length === 0) {
      bucket.push(pivot);
      continue;
    }
    const anchor = bucket[0]!.price;
    if (((pivot.price - anchor) / anchor) * 100 <= tolerancePct) {
      bucket.push(pivot);
    } else {
      flush();
      bucket.push(pivot);
    }
  }
  flush();

  return levels;
}

export function eligibleLevels(
  levels: Level[],
  side: "support" | "resistance",
  price: number,
  minTouches: number,
  maxCandlesSinceTouch: number,
  lastIndex: number,
): Level[] {
  return levels
    .filter((level) => (side === "support" ? level.price < price : level.price > price))
    .filter((level) => level.touches >= minTouches)
    .filter((level) => lastIndex - level.lastTouchIndex <= maxCandlesSinceTouch);
}

export function countRotations(low: Level, high: Level): number {
  const sequence = [
    ...low.touchIndexes.map((index) => ({ index, side: "low" })),
    ...high.touchIndexes.map((index) => ({ index, side: "high" })),
  ].sort((a, b) => a.index - b.index);

  let rotations = 0;
  for (let i = 1; i < sequence.length; i += 1) {
    if (sequence[i]!.side !== sequence[i - 1]!.side) rotations += 1;
  }
  return rotations;
}
