import { fetchCandles, fetchTickers, mapWithConcurrency } from "./bybit.ts";
import { adx } from "./indicators.ts";
import { detectActiveRange } from "./range.ts";
import { scoreRange } from "./score.ts";
import type { ActiveRange, Candidate, Config } from "./types.ts";

export function positionInRange(price: number, low: number, high: number): number {
  const width = high - low;
  return width === 0 ? Number.NaN : ((price - low) / width) * 100;
}

export function distanceToNearestEdgePct(price: number, low: number, high: number): number {
  if (!(price > 0)) return Number.NaN;
  return (Math.min(Math.abs(price - low), Math.abs(high - price)) / price) * 100;
}

export function passesRangeFilters(range: ActiveRange, config: Config): boolean {
  const {
    minRotations,
    minRangeWidthPct,
    maxRangeWidthPct,
    maxOutsidePct,
    maxCandlesSinceLastTouch,
  } = config.filters;

  const impulseOk = range.impulseRatio === null || range.impulseRatio >= config.impulse.minRatio;

  return (
    impulseOk &&
    range.rotations >= minRotations &&
    range.widthPct >= minRangeWidthPct &&
    range.widthPct <= maxRangeWidthPct &&
    range.outsidePct <= maxOutsidePct &&
    range.candlesSinceLastTouch <= maxCandlesSinceLastTouch
  );
}

export async function scan(config: Config): Promise<{ scanned: number; candidates: Candidate[] }> {
  const tickers = (await fetchTickers(config)).slice(0, config.market.maxSymbolsScanned);

  const measured = await mapWithConcurrency(
    tickers,
    config.market.requestConcurrency,
    async (ticker): Promise<Candidate | null> => {
      try {
        const candles = await fetchCandles(config, ticker.symbol, config.structure);
        if (candles.length < config.impulse.lookbackCandles) return null;

        const range = detectActiveRange(candles, config);
        if (range === null || !passesRangeFilters(range, config)) return null;

        const lastClose = candles.at(-1)!.close;
        const position = positionInRange(lastClose, range.low, range.high);
        if (
          !Number.isFinite(position) ||
          position < config.filters.minPositionInRangePct ||
          position > config.filters.maxPositionInRangePct
        ) {
          return null;
        }

        const score = scoreRange(range, config);
        if (score.total < config.filters.minScore) return null;

        return {
          symbol: ticker.symbol,
          quoteVolume24h: ticker.quoteVolume,
          range,
          score,
          lastClose,
          chartCandles: candles.slice(Math.max(0, range.startIndex - config.report.contextCandles)),
          adx: adx(candles.slice(-config.indicators.adxCandles), config.indicators.adxPeriod),
          positionInRangePct: position,
          distanceToNearestEdgePct: distanceToNearestEdgePct(lastClose, range.low, range.high),
        };
      } catch {
        return null;
      }
    },
  );

  const candidates = measured
    .filter((item): item is Candidate => item !== null)
    .sort((a, b) => b.score.total - a.score.total)
    .slice(0, config.filters.topN);

  return { scanned: tickers.length, candidates };
}
