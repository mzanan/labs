import type { ActiveRange, Config, ScoreBreakdown } from "./types.ts";

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function scoreRange(range: ActiveRange, config: Config): ScoreBreakdown {
  const { weights, maxUsefulTouchesPerLevel, maxUsefulRotations, maxUsefulBars } = config.score;

  const touches =
    clamp01(range.lowTouches / maxUsefulTouchesPerLevel) *
    clamp01(range.highTouches / maxUsefulTouchesPerLevel);
  const rotation = clamp01(range.rotations / maxUsefulRotations);
  const containment = clamp01(1 - range.outsidePct / config.filters.maxOutsidePct);
  const freshness = clamp01(
    1 - range.candlesSinceLastTouch / config.filters.maxCandlesSinceLastTouch,
  );
  const maturity = clamp01(range.candlesInRange / maxUsefulBars);

  const total =
    weights.touches * touches +
    weights.rotation * rotation +
    weights.containment * containment +
    weights.freshness * freshness +
    weights.maturity * maturity;

  const weightSum =
    weights.touches + weights.rotation + weights.containment + weights.freshness + weights.maturity;

  return {
    touches,
    rotation,
    containment,
    freshness,
    maturity,
    total: weightSum === 0 ? 0 : (total / weightSum) * 100,
  };
}
