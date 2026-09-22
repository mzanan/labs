import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Candidate, Config } from "./types.ts";

type ChartPayload = {
  symbol: string;
  score: number;
  low: number;
  high: number;
  widthPct: number;
  positionInRangePct: number;
  distanceToNearestEdgePct: number;
  since: string;
  days: number;
  lowTouches: number;
  highTouches: number;
  rotations: number;
  lastTouchLowHours: number;
  lastTouchHighHours: number;
  outsidePct: number;
  quoteVolume24h: number;
  rangeStartTime: number;
  candles: Array<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
};

function toPayload(candidate: Candidate, config: Config): ChartPayload {
  const { range } = candidate;

  return {
    symbol: candidate.symbol,
    score: candidate.score.total,
    low: range.low,
    high: range.high,
    widthPct: range.widthPct,
    positionInRangePct: candidate.positionInRangePct,
    distanceToNearestEdgePct: candidate.distanceToNearestEdgePct,
    since: new Date(range.startTime).toISOString().slice(0, 10),
    days: range.candlesInRange / 96,
    lowTouches: range.lowTouches,
    highTouches: range.highTouches,
    rotations: range.rotations,
    lastTouchLowHours: range.candlesSinceLowTouch / 4,
    lastTouchHighHours: range.candlesSinceHighTouch / 4,
    outsidePct: range.outsidePct,
    quoteVolume24h: candidate.quoteVolume24h,
    rangeStartTime: Math.floor(range.startTime / 1000),
    candles: candidate.chartCandles.slice(-config.report.maxCandlesPerChart).map((candle) => ({
      time: Math.floor(candle.openTime / 1000),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
    })),
  };
}

function page(payloads: ChartPayload[], subtitle: string, config: Config): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Range scan</title>
<script src="https://unpkg.com/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.js"></script>
<style>
  :root { color-scheme: dark; --bg:#0e0f13; --panel:#15171d; --line:#262a33; --text:#e6e8ee; --muted:#8b93a7; --edge:#26a69a; }
  *{box-sizing:border-box}
  body { margin:0; padding:24px; background:var(--bg); color:var(--text); font:14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  h1 { font-size:18px; margin:0 0 4px; }
  .sub { color:var(--muted); margin:0 0 16px; font-size:13px; }
  .toolbar { position:sticky; top:0; z-index:10; display:flex; align-items:center; gap:8px; margin:0 -24px 24px; padding:12px 24px; flex-wrap:wrap; background:rgba(14,15,19,.92); backdrop-filter:blur(8px); border-bottom:1px solid var(--line); }
  .toolbar span { color:var(--muted); font-size:12px; margin-right:4px; }
  button { background:var(--panel); color:var(--text); border:1px solid var(--line); border-radius:8px; padding:6px 14px; font:inherit; font-size:13px; cursor:pointer; }
  button:hover { border-color:#3a4150; }
  button[aria-pressed="true"] { background:#1e2a3a; color:#7fb2ff; border-color:#2f4a6d; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:16px; margin-bottom:20px; }
  .head { display:flex; flex-wrap:wrap; align-items:baseline; gap:12px; margin-bottom:4px; }
  .sym { font-size:16px; font-weight:600; letter-spacing:.02em; }
  .score { font-variant-numeric:tabular-nums; background:#1e2a3a; color:#7fb2ff; border-radius:999px; padding:2px 10px; font-size:12px; }
  .range { color:var(--muted); font-variant-numeric:tabular-nums; }
  .facts { color:var(--muted); font-size:12px; margin-bottom:12px; font-variant-numeric:tabular-nums; }
  .stage { position:relative; height:${config.report.chartHeight}px; }
  .chart { position:absolute; inset:0; }
  .profile { position:absolute; inset:0; pointer-events:none; z-index:5; }
  .bar { position:absolute; left:0; background:rgba(127,178,255,.38); border-radius:0 2px 2px 0; }
  .bar.poc { background:rgba(255,193,94,.65); }
  @media (max-width:640px) { body { padding:12px; } .stage { height:260px; } .toolbar { margin:0 -12px 16px; padding:10px 12px; } }
</style>
</head>
<body>
<h1>Range scan</h1>
<p class="sub">${subtitle}</p>
<div class="toolbar" id="toolbar"><span>timeframe</span></div>
<div id="app"></div>
<script>
const DATA = ${JSON.stringify(payloads)};
const PROFILE_BINS = ${config.report.profileBins};
const TIMEFRAMES = [
  { label: "15m", factor: 1 },
  { label: "30m", factor: 2 },
  { label: "1h", factor: 4 },
  { label: "4h", factor: 16 },
];

const fmt = (value) => value >= 100 ? value.toFixed(2) : value >= 1 ? value.toFixed(4) : value.toFixed(6);

function aggregate(candles, factor) {
  if (factor === 1) return candles;
  const out = [];
  for (let i = 0; i < candles.length; i += factor) {
    const slice = candles.slice(i, i + factor);
    out.push({
      time: slice[0].time,
      open: slice[0].open,
      high: Math.max.apply(null, slice.map((c) => c.high)),
      low: Math.min.apply(null, slice.map((c) => c.low)),
      close: slice[slice.length - 1].close,
      volume: slice.reduce((sum, c) => sum + c.volume, 0),
    });
  }
  return out;
}

function volumeProfile(candles, low, high, bins, fromTime) {
  const size = (high - low) / bins;
  const buckets = new Array(bins).fill(0);
  if (!(size > 0)) return buckets;

  for (const candle of candles) {
    if (candle.time < fromTime) continue;
    const from = Math.max(0, Math.floor((Math.max(candle.low, low) - low) / size));
    const to = Math.min(bins - 1, Math.floor((Math.min(candle.high, high) - low) / size));
    if (to < from) continue;
    const share = candle.volume / (to - from + 1);
    for (let i = from; i <= to; i += 1) buckets[i] += share;
  }
  return buckets;
}

const cards = DATA.map((item) => {
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML =
    '<div class="head">' +
      '<span class="sym">' + item.symbol + '</span>' +
      '<span class="score">score ' + item.score.toFixed(0) + '</span>' +
      '<span class="range">' + fmt(item.low) + ' - ' + fmt(item.high) + ' (' + item.widthPct.toFixed(1) + '%) &middot; now at ' + item.positionInRangePct.toFixed(0) + '% &middot; ' + item.distanceToNearestEdgePct.toFixed(2) + '% to edge</span>' +
    '</div>' +
    '<div class="facts">since ' + item.since + ' (' + item.days.toFixed(0) + 'd) &middot; touches ' + item.lowTouches + '/' + item.highTouches + ' &middot; rotations ' + item.rotations + ' &middot; last touch ' + item.lastTouchLowHours.toFixed(0) + 'h low / ' + item.lastTouchHighHours.toFixed(0) + 'h high &middot; outside ' + item.outsidePct.toFixed(0) + '% &middot; vol ' + (item.quoteVolume24h / 1e6).toFixed(0) + 'M</div>';

  const stage = document.createElement("div");
  stage.className = "stage";
  const holder = document.createElement("div");
  holder.className = "chart";
  const profile = document.createElement("div");
  profile.className = "profile";
  stage.appendChild(holder);
  stage.appendChild(profile);
  card.appendChild(stage);
  document.getElementById("app").appendChild(card);

  const chart = LightweightCharts.createChart(holder, {
    layout: { background: { color: "#15171d" }, textColor: "#8b93a7" },
    grid: { vertLines: { color: "#1c1f27" }, horzLines: { color: "#1c1f27" } },
    rightPriceScale: { borderColor: "#262a33" },
    timeScale: { borderColor: "#262a33", timeVisible: true },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    autoSize: true,
  });

  const series = chart.addCandlestickSeries({
    upColor: "#26a69a", downColor: "#ef5350",
    borderUpColor: "#26a69a", borderDownColor: "#ef5350",
    wickUpColor: "#26a69a", wickDownColor: "#ef5350",
  });

  const lineOptions = { color: "#26a69a", lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Solid, axisLabelVisible: true, title: "" };
  series.createPriceLine(Object.assign({ price: item.high }, lineOptions));
  series.createPriceLine(Object.assign({ price: item.low }, lineOptions));

  const drawProfile = () => {
    const buckets = volumeProfile(item.candles, item.low, item.high, PROFILE_BINS, item.rangeStartTime);
    const peak = Math.max.apply(null, buckets);
    const topY = series.priceToCoordinate(item.high);
    const bottomY = series.priceToCoordinate(item.low);
    profile.innerHTML = "";
    if (!(peak > 0) || topY === null || bottomY === null) return;

    const height = (bottomY - topY) / PROFILE_BINS;
    const maxWidth = stage.clientWidth * 0.22;

    buckets.forEach((value, index) => {
      const bar = document.createElement("div");
      bar.className = value === peak ? "bar poc" : "bar";
      bar.style.top = (topY + (PROFILE_BINS - 1 - index) * height) + "px";
      bar.style.height = Math.max(2, height - 1) + "px";
      bar.style.width = Math.max(1, (value / peak) * maxWidth) + "px";
      profile.appendChild(bar);
    });
  };

  const render = (factor) => {
    series.setData(aggregate(item.candles, factor));
    chart.timeScale().fitContent();
    requestAnimationFrame(drawProfile);
    setTimeout(drawProfile, 120);
  };

  chart.timeScale().subscribeVisibleLogicalRangeChange(() => requestAnimationFrame(drawProfile));
  window.addEventListener("resize", () => requestAnimationFrame(drawProfile));

  return render;
});

const toolbar = document.getElementById("toolbar");
const buttons = TIMEFRAMES.map((tf) => {
  const button = document.createElement("button");
  button.textContent = tf.label;
  button.setAttribute("aria-pressed", String(tf.factor === 1));
  button.addEventListener("click", () => {
    buttons.forEach((other) => other.setAttribute("aria-pressed", String(other === button)));
    cards.forEach((render) => render(tf.factor));
  });
  toolbar.appendChild(button);
  return button;
});

cards.forEach((render) => render(1));
</script>
</body>
</html>
`;
}

export function writeReport(candidates: Candidate[], subtitle: string, config: Config): string {
  const path = new URL(`../${config.report.outputPath}`, import.meta.url).pathname;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    page(
      candidates.map((candidate) => toPayload(candidate, config)),
      subtitle,
      config,
    ),
  );
  return path;
}
