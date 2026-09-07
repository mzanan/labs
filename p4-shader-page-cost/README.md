# p4-shader-page-cost

**Question.** How many kilobytes and how many milliseconds per frame does an animated shader background cost, with [vgpu](https://vgpu.sh) versus three.js, and does either fit a landing page's performance budget?

Measured 2026-09-06 on `vgpu@0.4.0`, `three@0.181.2`, `next@16.3.4`, `esbuild@0.25.12`, node v22.22.2, Apple Silicon macOS 26.6.2. Two rounds: headless Dawn/Metal, then a real browser page.

## How to run

Headless measurement, prints and exits:

```bash
npm install
./node_modules/.bin/tsx src/run.ts
npm run typecheck
```

Browser measurement, a real Next.js page rendering the same shaders on a canvas:

```bash
npm run build
./node_modules/.bin/next start -p 4400
```

Both read the same `scenarios.json`, so the headless run and the page run byte-identical WGSL. The page reports live FPS, rAF delta and GPU pass time from `timestamp-query` spans, with shader and DPR-cap toggles.

No credentials needed. `.env` is optional: `VGPU_ADAPTER` (`auto` | `hardware` | `software`) forces the headless adapter.

## What was measured

Three costs, because they have different answers.

**Bundle.** `src/bundleCost.ts` builds a real mount entry point per candidate with esbuild (`esm`, `es2022`, minified) and gzips the output. Three candidates in `scenarios.json`: vgpu's browser entry (`init + surface + effect + frameLoop + clock`), three's `WebGPURenderer` + TSL `wgslFn` (the apples-to-apples backend, same WGSL), and three's older `WebGLRenderer` + `ShaderMaterial` (the cheapest three can be).

**Frame, headless.** `src/renderCost.ts` renders through `vgpu/node` (Dawn) into an offscreen target and reports two separate numbers per cell: GPU pass duration from real `timestamp-query` spans, and CPU encode+submit wall time. 60 warmup + 300 measured frames per cell. Two shaders (an animated gradient as the floor, a six-octave domain-warped fbm as what a hero background actually runs) across two resolutions (1920x1080, and 3840x2160 for a DPR 2 display).

**Frame, browser.** `src/app/` is a Next.js 16 page mounting the same shaders on a real canvas through vgpu's browser entry (`surface` + `frameLoop` + `clock`). Added after the headless round, because the headless round could not answer whether its own numbers transfer. Same `timestamp-query` spans, plus rAF deltas for the real presented frame rate.

## Results, 2026-09-06

### Bundle, gzipped

| Candidate | gzip | minified | vs vgpu |
|---|---|---|---|
| `vgpu` | 43.2 KB | 134.2 KB | 1.00x |
| `three-webgl` | 125.9 KB | 485.8 KB | 2.91x (+82.7 KB) |
| `three-webgpu` | 215.1 KB | 767.8 KB | 4.98x (+171.9 KB) |

**Confirmed against the real build.** The Next.js production build emits vgpu as its own lazy chunk (the page imports it with `await import("vgpu")`): 135,734 bytes minified, 43,982 gzipped. The synthetic esbuild number is within 0.5% of what Turbopack actually ships, so the bundle table transfers.

### Frame, headless Dawn/Metal, p95 against a 16.67 ms budget

| Shader | Resolution | GPU p95 | CPU p95 | Total | Budget used |
|---|---|---|---|---|---|
| gradient | 1920x1080 | 0.197 ms | 0.128 ms | 0.325 ms | 1.9% |
| fbm | 1920x1080 | 1.835 ms | 0.261 ms | 2.096 ms | 12.6% |
| gradient | 3840x2160 | 0.328 ms | 0.132 ms | 0.460 ms | 2.8% |
| fbm | 3840x2160 | 5.767 ms | 0.358 ms | 6.125 ms | 36.7% |

### Frame, real browser (Chromium, Apple GPU, 1200x897 CSS viewport)

| Shader | DPR cap | Backbuffer | GPU p50 | GPU p95 | Share of 16.67 ms |
|---|---|---|---|---|---|
| gradient | 1 | 1200x897 (1.08 Mpx) | 0.197 ms | 1.114 ms | 6.7% |
| fbm | 1 | 1200x897 (1.08 Mpx) | 2.490 ms | 3.342 ms | 20.1% |
| fbm | 2 | 2400x1794 (4.30 Mpx) | 5.767 ms | 7.864 ms | 47.2% |

Presented frame rate was 120 fps throughout (ProMotion), rAF delta p50 8.30 ms.

**The headless round underestimated the browser by roughly 3x per pixel, and that is the most important number in this lab.** Headless Dawn ran fbm at 0.66 ms per megapixel; the same shader in the browser on the same machine costs 2.30 ms per megapixel at DPR 1. Fitting the two browser fbm points gives ~1.0 ms/Mpx marginal plus ~1.4 ms of fixed per-frame cost that headless does not have at all, which is the canvas configure/present/composite path that an offscreen target never pays. **A headless WebGPU measurement is a lower bound on browser cost, not a prediction of it.**

The display also moves the goalposts: on a 120 Hz panel the real budget is 8.33 ms, not 16.67 ms. fbm at DPR 2 (p95 7.86 ms) is at that limit with nothing left for anything else on the page.

### Secondary findings on vgpu 0.4.0

- **Headless cost is pure fill rate; browser cost is not.** Headless, 4x the pixels cost 3.95x the GPU time and CPU encode+submit stays flat at ~0.1-0.4 ms. In the browser the same 4x jump costs only 2.3x, because of the fixed per-frame overhead above.
- **The published "25 KB gzipped" is not what a plain bundler produces.** The package declares an `effect-only` CI budget of 25.0 KB and a `full-root` budget of 38.0 KB. The same entries through esbuild measure 43.8 KB and 43.2 KB, and Turbopack agrees with esbuild. The gap is not caused by `surface`/`clock`/`frameLoop`: an `init`-only entry is 5.9 KB and everything above that is `effect`. Cause unverified, most likely a build-pipeline difference rather than a package problem.
- **The build-time `.wgsl` loader does not shrink the bundle in 0.4.0.** 32% of the minified output (44.0 KB of 137.3 KB) is `@vgpu/wgsl`, the runtime WGSL reflector, and `reflectSource` is a static unconditional import in both `effect.js` and `draw.js`. `@vgpu/wgsl/loader-webpack` moves parsing to build time but the parser still ships. No `zod` and no MCP server code reach the browser bundle.
- **`timestamp-query` is not requested by default.** `init()` yields only `core-features-and-limits`. Real GPU pass timing needs `init({ requiredFeatures: ["timestamp-query"] })`, headless and in the browser alike.
- **`effect.draw(target)` is not a frame-recording call.** It creates and submits its own command encoder, so calling it inside `frame(gpu, ...)` submits two command buffers per frame. The recording form is `frame(gpu, (f) => f.pass(target, effect))`.

## Verdict

**Yes, a shader background is sellable on a landing page, and vgpu is the only one of the three candidates that fits. But the honest budget is roughly 3x what a headless measurement suggests.**

- **On bundle, three.js is disqualified and vgpu barely qualifies.** 43.2 KB gzip spends 86% of a 50 KB hero budget on the background alone, so it must be dynamically imported below the fold or behind an interaction, never in the initial route bundle. Three's WebGPU path at 215.1 KB is not a landing-page option at any budget worth defending. Confirmed against a real Turbopack build, not just a synthetic one.
- **On frame time, the shader and the pixel count are the bill, and DPR is the only lever that pays.** A gradient is free anywhere (under 7% even in the browser). A realistic fbm hero costs 20% of a 60 Hz frame at DPR 1 and 47% at DPR 2, on a top-end Apple GPU. Clamping to `dpr: [1, 1.5]` roughly halves that and is the single highest-value change.
- **Do not trust headless numbers for a browser decision.** This lab's first round said fbm at DPR 2 cost 36.7% of the budget. The browser says 47.2% at 40% of the pixel count. The gap is a fixed per-frame canvas cost that offscreen rendering never pays, and it is large enough to change a ship/no-ship call.

**The remaining hard limit: everything here ran on an Apple Silicon GPU.** These are still best-case numbers. The 47% figure is a floor for mid-range integrated graphics or an Android phone, where the same shader can plausibly miss the budget outright. Before this ships to a real landing page it still needs a run on integrated graphics, a `prefers-reduced-motion` path, and a no-WebGPU static fallback. The page already handles the no-WebGPU case by reporting it rather than crashing, but a real fallback image was not part of this lab.
