# p1-tool-loop

**Question:** does the Vercel AI SDK's native tool loop (`generateText` + `tools` + `stopWhen`) work reliably on OpenRouter's free models with pinned routing, for a fit-coach-shaped agent (4 tools, 1-3 steps)?

**Date:** 2026-08-01

## How to run

```
cp .env.example .env   # set OPENROUTER_API_KEY
npm install
npm start
```

Config via env: `PAUSE_MS` (default 8000, free tier is 20 req/min), `TIMEOUT_MS` (90s per call), `MAX_STEPS` (6), `CANDIDATES_FILE`. Models and routing pins live in `candidates.json`; tools and fixture data in `src/tools.ts` / `src/fixtures.ts`; scenarios with expected tool sequences and exact-argument checks in `src/scenarios.ts`.

## What was measured

3 free models x 5 scenarios x 2 runs. Every call sent `require_parameters: true`; gemma additionally pinned to `darkbloom`. Scenarios: single tool read, search-then-log chain with catalog-exact macros, smalltalk that must trigger NO tool, two-tool read, direct log with user-stated macros.

| Model | Run 1 | Run 2 |
|---|---|---|
| google/gemma-4-26b-a4b-it:free (darkbloom) | 5/5 | 5/5 |
| openai/gpt-oss-20b:free | 4/5 (1 upstream timeout) | quota-blocked mid-run |
| nvidia/nemotron-3-super-120b-a12b:free | 5/5 | quota-blocked |

## Verdict

**Yes. The SDK loop holds on free models and no hand-rolled loop or ReAct fallback is justified.** Across every measurable cell (20): correct tool choice every time, no keyword-baiting (smalltalk never triggered a tool), argument accuracy exact (catalog macros 62/8/0 and user-stated 40/25/0 landed intact), chains completed in 2-3 steps. The only non-quota failure in 30 attempted cells was an upstream infra timeout (Darkbloom first-response timeout serving gpt-oss), the same transient class p0 found: retries stay mandatory.

**The real ceiling is operational, not capability: the $0 account's free-models-per-day cap (~50) died mid-run-2.** A tool loop spends 2-3 requests per user question, so quota exhaustion is the failure mode an in-app P1 must surface honestly (it arrives as a 429 with "Add 10 credits" in the message). gemma-4-26b (fit-coach's current pick) was the most reliable candidate measured: 10/10.

Not measured: models without native tool support (ReAct territory, ruled out by research), `toolApproval` flows, deeper chains (4+ steps).
