# p6-rain-nowcast-skill

**Question.** Does a free 15-minute precipitation nowcast (Open-Meteo `minutely_15`) predict rain at a point in Da Nang well enough, at 30 / 60 / 120 minutes ahead, to fire a "you are about to get soaked" push alert, measured against an independent surface observation rather than against the model's own analysis?

Consumer: `personal-brain/01-Projects/21-rainwindow`, whose entire product thesis depends on this number. Phase 0 of that project is gated on this lab: no repo, no UI until the hit rate exists.

## Why this lab exists

The rainwindow spec ruled out building a forecast model (ECMWF IFS, its AIFS, and DeepMind GenCast already win) and ruled out street-level precision beyond ~6 h (physically impossible in tropical convection). What is left is the 0-2 h nowcast plus the translation to a decision. That only works if the nowcast has real skill at the point scale. Nobody publishes that number for Da Nang, so it has to be measured.

## Ground truth

The open blocker in the project spec was that a "forecast accuracy" scoreboard built from the same provider's past values is circular: it scores the model against itself. This lab uses **METAR surface observations from VVDN (Da Nang International)** via `aviationweather.gov`, keyless and free. A METAR reports present weather every 30 minutes as an observation made at the airport, independent of any model.

Its limits, which the verdict must carry:

- Binary-ish, not quantitative. `-RA` / `RA` / `+RA` gives intensity class, not millimetres.
- One point. VVDN is ~5 km from the city centre, so a cell can hit one and not the other. The `danang-city` site in `config.json` exists to make that mismatch visible as a second, deliberately harder row.
- 30-minute cadence, so a 30-minute verification window holds exactly one observation.
- `VC*` (vicinity) and `RE*` (recent) tokens are excluded: rain near the station is not rain at the station.

## How to run

```
npm install
npm run collect     # one poll: forecast + observations, appended to ./data/*.jsonl
npm run score       # scores every stored forecast against stored observations
npm run typecheck
```

Config lives in `config.json` (sites, horizons, thresholds, endpoints), never as literals in code. `NOWCAST_SITE` selects the site, `NOWCAST_DATA_DIR` the output directory. No credentials: both APIs are keyless, so `.env` is optional.

`collect` must run on a schedule (every 15 minutes) for at least two weeks of rainy season to produce a usable sample. Locally:

```
*/15 * * * * cd <lab path> && /usr/local/bin/npm run collect >> data/collect.log 2>&1
```

## What is measured

Per horizon (`t+30`, `t+60`, `t+120`, each over a 30-minute window):

- **POD** (hit rate): of the times it rained, how often the forecast said so.
- **FAR** (false alarm ratio): of the times it alerted, how often nothing fell.
- **CSI**: hits over hits + misses + false alarms, the honest single number for a rare event.
- **Accuracy**: included, but it is the misleading one. In a dry fortnight a forecast that never alerts scores ~0.9.

A case is scored only when both a forecast step and an observation exist inside the window, so partial data never inflates the sample.

The decision threshold is configuration, not a constant: `thresholds.rule` switches between accumulated mm, probability, or either, so the same stored data can be rescored under a different alert rule without recollecting.

## Verdict

**Unmeasured, and it will stay that way.** The consumer project was closed 2026-09-12 11:43 ICT before the collector was ever scheduled, so no skill number exists. The scaffold below is verified and runnable if the question ever comes back.

Scaffold built and verified 2026-09-11 22:21 ICT: both APIs answered live (Open-Meteo returned 12 steps for VVDN, `aviationweather.gov` returned 6 METARs, 5 of them raining), the scoring path was exercised on synthetic data and produced a correct hit at `t+30` and a correct miss at `t+60`, and the METAR parser classified `-RA` light, `+TSRA` heavy, `VCSH` not raining. No real measurement yet: that needs the scheduled collector running through rainy season.

Gate for the consumer project: if CSI at `t+30` is not clearly better than a naive "it is the rainy season, assume rain" baseline, rainwindow does not get built.
