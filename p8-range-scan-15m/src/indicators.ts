import type { Candle } from "./types.ts";

export function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function wilderSmooth(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const smoothed: number[] = [];
  let accumulator = values.slice(0, period).reduce((sum, value) => sum + value, 0);
  smoothed.push(accumulator);
  for (let i = period; i < values.length; i += 1) {
    accumulator = accumulator - accumulator / period + values[i]!;
    smoothed.push(accumulator);
  }
  return smoothed;
}

export function adx(candles: Candle[], period: number): number {
  if (candles.length < period * 2 + 1) return Number.NaN;

  const trueRanges: number[] = [];
  const plusDm: number[] = [];
  const minusDm: number[] = [];

  for (let i = 1; i < candles.length; i += 1) {
    const current = candles[i]!;
    const previous = candles[i - 1]!;
    const upMove = current.high - previous.high;
    const downMove = previous.low - current.low;

    plusDm.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDm.push(downMove > upMove && downMove > 0 ? downMove : 0);
    trueRanges.push(
      Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close),
      ),
    );
  }

  const smoothedTr = wilderSmooth(trueRanges, period);
  const smoothedPlus = wilderSmooth(plusDm, period);
  const smoothedMinus = wilderSmooth(minusDm, period);

  const dx: number[] = [];
  for (let i = 0; i < smoothedTr.length; i += 1) {
    const tr = smoothedTr[i]!;
    if (tr === 0) {
      dx.push(0);
      continue;
    }
    const plusDi = (smoothedPlus[i]! / tr) * 100;
    const minusDi = (smoothedMinus[i]! / tr) * 100;
    const sum = plusDi + minusDi;
    dx.push(sum === 0 ? 0 : (Math.abs(plusDi - minusDi) / sum) * 100);
  }

  if (dx.length < period) return Number.NaN;

  let value = dx.slice(0, period).reduce((sum, item) => sum + item, 0) / period;
  for (let i = period; i < dx.length; i += 1) {
    value = (value * (period - 1) + dx[i]!) / period;
  }
  return value;
}

