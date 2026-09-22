export type Candle = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type Ticker = {
  symbol: string;
  quoteVolume: number;
  lastPrice: number;
};

export type Pivot = {
  index: number;
  price: number;
  kind: "high" | "low";
};

export type Level = {
  price: number;
  kind: "high" | "low";
  touches: number;
  firstTouchIndex: number;
  lastTouchIndex: number;
  touchIndexes: number[];
};

export type ActiveRange = {
  startIndex: number;
  startTime: number;
  candlesInRange: number;
  low: number;
  high: number;
  widthPct: number;
  outsidePct: number;
  rotations: number;
  impulseRatio: number | null;
  lowTouches: number;
  highTouches: number;
  candlesSinceLowTouch: number;
  candlesSinceHighTouch: number;
  candlesSinceLastTouch: number;
};

export type ScoreBreakdown = {
  touches: number;
  rotation: number;
  containment: number;
  freshness: number;
  maturity: number;
  total: number;
};

export type Candidate = {
  symbol: string;
  quoteVolume24h: number;
  range: ActiveRange;
  score: ScoreBreakdown;
  lastClose: number;
  adx: number;
  chartCandles: Candle[];
  positionInRangePct: number;
  distanceToNearestEdgePct: number;
};

export type Timeframe = {
  interval: string;
  lookbackCandles: number;
};

export type Config = {
  market: {
    baseUrl: string;
    category: string;
    quoteAsset: string;
    minQuoteVolume24h: number;
    maxSymbolsScanned: number;
    requestConcurrency: number;
    excludedBaseAssets: string[];
    excludedSymbolTypes: string[];
  };
  structure: Timeframe;
  impulse: {
    lookbackCandles: number;
    minRatio: number;
  };
  range: {
    pivotStrength: number;
    clusterTolerancePct: number;
    minTouchesPerLevel: number;
    maxCandlesSinceTouch: number;
  };
  indicators: {
    adxPeriod: number;
    adxCandles: number;
  };
  score: {
    maxUsefulTouchesPerLevel: number;
    maxUsefulRotations: number;
    maxUsefulBars: number;
    weights: {
      touches: number;
      rotation: number;
      containment: number;
      freshness: number;
      maturity: number;
    };
  };
  report: {
    outputPath: string;
    chartHeight: number;
    maxCandlesPerChart: number;
    contextCandles: number;
    profileBins: number;
    autoOpen: boolean;
  };
  filters: {
    minRotations: number;
    minRangeWidthPct: number;
    maxRangeWidthPct: number;
    maxOutsidePct: number;
    minPositionInRangePct: number;
    maxPositionInRangePct: number;
    maxCandlesSinceLastTouch: number;
    minScore: number;
    topN: number;
  };
};
