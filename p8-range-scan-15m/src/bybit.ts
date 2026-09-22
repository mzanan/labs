import type { Candle, Config, Ticker, Timeframe } from "./types.ts";

type BybitEnvelope<T> = {
  retCode: number;
  retMsg: string;
  result: T;
};

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} on ${url}`);
  }
  const payload = (await response.json()) as BybitEnvelope<T>;
  if (payload.retCode !== 0) {
    throw new Error(`bybit retCode ${payload.retCode}: ${payload.retMsg}`);
  }
  return payload.result;
}

export async function fetchExcludedSymbols(config: Config): Promise<Set<string>> {
  const { baseUrl, category, excludedSymbolTypes } = config.market;
  const excluded = new Set<string>();
  let cursor = "";

  do {
    const url = new URL(`${baseUrl}/v5/market/instruments-info`);
    url.searchParams.set("category", category);
    url.searchParams.set("limit", "1000");
    if (cursor !== "") url.searchParams.set("cursor", cursor);

    const result = await getJson<{
      list: Array<{ symbol: string; symbolType: string; status: string }>;
      nextPageCursor: string;
    }>(url.toString());

    for (const instrument of result.list) {
      if (excludedSymbolTypes.includes(instrument.symbolType) || instrument.status !== "Trading") {
        excluded.add(instrument.symbol);
      }
    }
    cursor = result.nextPageCursor;
  } while (cursor !== "");

  return excluded;
}

export async function fetchTickers(config: Config): Promise<Ticker[]> {
  const { baseUrl, category, quoteAsset, excludedBaseAssets, minQuoteVolume24h } = config.market;
  const [result, excludedSymbols] = await Promise.all([
    getJson<{
      list: Array<{ symbol: string; lastPrice: string; turnover24h: string }>;
    }>(`${baseUrl}/v5/market/tickers?category=${category}`),
    fetchExcludedSymbols(config),
  ]);

  return result.list
    .filter((entry) => entry.symbol.endsWith(quoteAsset))
    .filter((entry) => !excludedSymbols.has(entry.symbol))
    .filter((entry) => !excludedBaseAssets.includes(entry.symbol.slice(0, -quoteAsset.length)))
    .map((entry) => ({
      symbol: entry.symbol,
      quoteVolume: Number(entry.turnover24h),
      lastPrice: Number(entry.lastPrice),
    }))
    .filter((ticker) => Number.isFinite(ticker.quoteVolume) && ticker.quoteVolume >= minQuoteVolume24h)
    .sort((a, b) => b.quoteVolume - a.quoteVolume);
}

const MAX_CANDLES_PER_CALL = 1000;

async function fetchCandlePage(
  config: Config,
  symbol: string,
  timeframe: Timeframe,
  limit: number,
  endTime: number | null,
): Promise<Candle[]> {
  const url = new URL(`${config.market.baseUrl}/v5/market/kline`);
  url.searchParams.set("category", config.market.category);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", timeframe.interval);
  url.searchParams.set("limit", String(limit));
  if (endTime !== null) url.searchParams.set("end", String(endTime));

  const result = await getJson<{ list: string[][] }>(url.toString());

  return result.list
    .map((row) => ({
      openTime: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
    }))
    .sort((a, b) => a.openTime - b.openTime);
}

export async function fetchCandles(
  config: Config,
  symbol: string,
  timeframe: Timeframe,
): Promise<Candle[]> {
  const pages: Candle[][] = [];
  let remaining = timeframe.lookbackCandles;
  let endTime: number | null = null;

  while (remaining > 0) {
    const limit = Math.min(remaining, MAX_CANDLES_PER_CALL);
    const page: Candle[] = await fetchCandlePage(config, symbol, timeframe, limit, endTime);
    if (page.length === 0) break;

    pages.unshift(page);
    remaining -= page.length;
    endTime = page[0]!.openTime - 1;
    if (page.length < limit) break;
  }

  return pages.flat();
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]!);
    }
  });

  await Promise.all(runners);
  return results;
}
