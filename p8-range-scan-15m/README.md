# p8-range-scan-15m

**Question.** Can a keyless Bybit scan return a short list of ranges that are alive right now on M15, ranked well enough that no manual chart triage is needed before picking one?

Consumer: `personal-brain/01-Projects/09-orderflow-trading`. The scan replaces manual chart-by-chart hunting; it never replaces the chart validation itself.

## How the range is found

Everything runs on M15, over 8000 candles (about 83 days, paginated 1000 at a time). H1 was the first attempt and it loses the middle touch: Matias had to drop to M30 to see it on the chart.

A range is a **pair of horizontal levels that are both still alive**, not a continuous window. That distinction came from WLDUSDT: the 0.3558-0.4427 zone it respects since July is interrupted by three weeks near 0.29 in August. Any window-based detector either rejects it or reports a range that does not exist. So:

1. Find swing pivots on M15 (fractal, 6 candles each side).
2. Cluster the pivot lows, and the pivot highs, by price (`clusterTolerancePct`). Each cluster is a level: its price is the median of its pivots, its strength is how many times it was touched, and it carries the index of every touch.
3. Keep the levels with at least `minTouchesPerLevel` touches and a touch inside `maxCandlesSinceTouch`. Support levels sit below the current price, resistance levels above it.
4. Score every support/resistance pair whose width, containment and freshness pass, and keep the best one.

That is the range. It survives excursions by construction: a level does not stop existing because price left the zone for three weeks, only because nobody defended it since.

Reported per range: `since` and `days` (first touch of either level), `touches` (per level), `lastTouchLow` / `lastTouchHigh` (hours, both must be recent enough), `impulse` (how far price travelled into the range start, over the range height, `na` when there is not enough history before it), `rotations` (alternations between edges over time, the criterion that a range actually rotates), `outside` (share of closes outside the pair, the excursion tolerance) and `posInRange`.

Filters and thresholds live in `config.json`, not in code.

## Ranking, so the list needs no manual triage

Every surviving range gets a 0-100 quality score, and the table is sorted by it. The score is structural: how much of a range this is, not how good the entry is. `toEdge` stays as a separate column for picking the entry.

- `touches` both levels confirmed repeatedly, as a product of the two sides, so 8/1 scores near zero.
- `rotation` how many times price crossed from one edge to the other.
- `containment` the inverse of `outside`.
- `freshness` how recently an edge was touched.
- `maturity` how long the range has lasted.

Hard filters run first, and these are the ones that remove junk outright:

- `excludedSymbolTypes: ["stock", "commodity", "index", "forex"]` removes Bybit's tokenised equity and commodity perps (UBERUSDT is Uber, SKHYUSDT is SK Hynix, XAGUSDT is silver). `instruments-info` carries `symbolType`, so this is data, not a name blacklist. Non-`Trading` instruments go with them.
- `minRotations: 3` removes the structures that never rotated.
- `maxCandlesSinceLastTouch` removes ranges whose last edge touch is days old.
- `impulse.minRatio` removes the ones with no impulse into them, which is what a trend looks like. DOTUSDT, which earlier versions ranked first, drops out here and on the level test.

## Output

A table in the terminal, one row per candidate, and an HTML report with the real charts. The ASCII chart that sat between the two was tried and dropped: at terminal resolution it was unreadable and the HTML already answers the same question better.

## HTML report

Every run also writes `out/report.html` (gitignored): one card per candidate with the same header and facts, and a real candlestick chart drawn with TradingView's `lightweight-charts` from a CDN, with the detected edges as solid green price lines, a sticky timeframe switch (15m, 30m, 1h, 4h, aggregated in the browser from the M15 data) and a volume profile drawn over the range zone, with the POC highlighted. Open it in a browser, no server needed. `report.autoOpen` in `config.json` opens it automatically on macOS.

## Data source

Bybit v5 public market endpoints, no key required:

- `GET /v5/market/tickers?category=linear` for the USDT perp universe and `turnover24h`.
- `GET /v5/market/kline?category=linear&symbol=<s>&interval=<60|15>&limit=<n>`, whose list comes newest first and is reversed on read.

Stablecoin pairs are excluded and the universe is cut to the top `maxSymbolsScanned` by 24h turnover, which also filters out the illiquid alts whose ranges are noise. The 15m call is made only for symbols that already have an active range.

## How to run

```
npm install
npm start
```

Manual runs only, no cron. The H1 range is stable for days; the 15m position is not, so the ordering goes stale within about half an hour.

## Verdict (2026-09-21 22:41 ICT)

Works, and it now agrees with the chart. 56 crypto symbols cleared the 20M turnover floor, scanned in 12.7s over 8000 M15 candles each, 15 ranges returned. WLDUSDT comes back as 0.3529-0.4547 since 01-07 with 20/5 touches and 5 rotations, against the 0.3558-0.4427 Matias drew by hand. DOTUSDT, which three earlier versions ranked first, returns no range at all: it is the uptrend itself.

Output is a candidate list, not a range confirmation: swing structure and volume profile still get read on the chart before any trade. Not measured: whether these candidates are profitable to trade. The lab answers a screening question, not an edge question.
