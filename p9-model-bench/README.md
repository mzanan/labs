# Lab: model-bench (phase 1)

**Question:** which of the September 2026 model wave is actually good at the three things
Matias's projects need (agentic tool calling, typed decisions, vision extraction), measured on
his own scenarios with an automated grader, at what latency and cost.

Spec: consumed in-session from the orchestrator, not vault content (see
`personal-brain/01-Projects/*/tasks.md` for the pointer once filed). Phase 1 covers Phase 0 plus
track 3 (decision, cheapest model + jev + free rows) and track 1 (tool_call, all models that
passed Phase 0), fully, 3 reps. Track 4 (vision) is wired but NOT RUN: no fixtures yet. Track 2
(coding fix) is out of phase 1 entirely, per spec.

## How to run

```
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
eval "$(grep '^export EXPLABS_API_KEY' ~/.zshrc)"
eval "$(grep '^export OPENROUTER_API_KEY' ~/.claude-or.sh)"
python3 run_bench.py --tracks tool_call,decision,vision --models all --reps 3
```

Needs `EXPLABS_API_KEY` and `OPENROUTER_API_KEY` in the shell env (never written to a file here).
`ECOMMERCE_MIRROR_DB_PATH` in `.env` is read for track 1; default `./db/ecommerce_mirror.sqlite`.

## What was reused from p7-shopping-agent-on-ecommerce

- `db/ecommerce_mirror.sqlite` and `db/schema.sql`: copied as-is (same SQLite mirror of
  `personal/ecommerce`'s real schema, same seed, never the Neon production database).
- `adapter/ecommerce_storefront.py`: rewritten, not imported. The SQL logic (title-to-id exact
  match, light stemming in search ranking, cart/order/policy queries) is reused verbatim; the
  pydantic `StorefrontBackend`/`Product`/`Cart`/... types from p7's `shopping_agent` core package
  are dropped in favor of plain dicts, because this lab does not import that whole framework
  (the point of p9 is a provider-agnostic tool loop across two different API shapes, and the
  `shopping_agent` core's orchestrator is wired specifically to the Anthropic Messages API).
- Scenarios 1-6 and their SQL-checked expected values: copied verbatim from
  `p7-shopping-agent-on-ecommerce/scenarios.json`. Scenario 7 (`approval_gate`) is new.
- The tool schemas in `tracks/tool_call/tools.py` are trimmed from
  `upstream/shopping-agent/core/shopping_agent/tools/registry.py`'s full registry to the subset
  the 7 scenarios exercise.

## Providers

Two backends behind one interface, `providers.py`: `explabs` (Anthropic-compatible
`/v1/messages`, plus `/v1/systemone` for jev) and `openrouter` (OpenAI-compatible chat
completions with tools). Findings from wiring them:

- explabs's pinned SDK (`anthropic` 1.7.0) moved off `httpx` onto its own `httpx2` fork; the
  cost-tee transport (same technique p7 uses, teeing raw response bytes to recover
  `usage.cost` since the SDK's own accumulation drops it) is built on `httpx2`.
- That SDK version's `messages.create()` has no top-level `temperature` parameter any more.
- `/v1/systemone` needs `Authorization: Bearer <key>`, not the `X-Api-Key` header
  `/v1/messages` uses by default.
- `/v1/systemone` accepts all three question types when sent in the documented shape: `choice`
  needs a `criteria` object (label to description), `score` a `criteria` array (ordinal levels,
  the answer is an index plus probabilities, not a 0-100 number), `noul` returns a 0-1
  probability. Verified live 2026-09-22 23:45 ICT. The decision runner has three Jev variants
  (choice, score, noul).
- The first full run hung for 11 hours on one call: the SDK timeout is per read, not total, and
  both SDKs retry on their own. Fixed with SDK `max_retries=0` plus a hard `asyncio.wait_for`
  per call (`hard_timeout_s` in `models.json`), and the report is flushed after every model.

## Results, 2026-09-23 (Experiential Labs gateway, OpenRouter for MiMo)

One process per model (`run_bench.py --models <key> --out runs/report-2026-09-23-<key>.json`),
merged by `merge_reports.py --date 2026-09-23` into `report-2026-09-23.json`. Decision: 20
synthetic money-tracker transactions x 3 reps. Tool call: p7's 6 scenarios plus `approval_gate`
(scenario 7) x 3 reps.

| Model | Gate | Decision kind acc | Decision transfer acc | Decision mean ms | Tool call | Failed scenarios (fails/3) | Cost USD |
|---|---|---|---|---|---|---|---|
| `deepseek-4.1-flash` | PASS | 1.0 | 1.0 | 1510 | 19/21 | s1: 1, s6: 1 | 0.046678 |
| `glm-5.3-flash` | PASS | 1.0 | 1.0 | 2732 | 18/21 | s1: 2, s6: 1 | 0.032551 |
| `glm-5.3` | PASS | 1.0 | 1.0 | 1862 | 19/21 | s1: 2 | 0.227196 |
| `gpt-5.6-luna` | PASS | 1.0 | 1.0 | 1508 | 18/21 | s1: 3 | 0.0 |
| `grok-4.7` | PASS | 1.0 | 1.0 | 3680 | 18/21 | s1: 3 | 0.377656 |
| `jev-openrouter` | PASS | 1.0 | 1.0 | 586 | not run | none | 0.006847 |
| `jev` | BLOCKED: HTTPStatusError: Client error '403 Forbidden' for url 'https://api.experientiall | None | None | None | not run | none | 0.0 |
| `kimi-k3` | PASS | 0.867 | 0.867 | 6037 | 18/21 | s1: 3 | 0.563022 |
| `laya-multilingual` | PASS | 0.55 | 0.5 | 40 | not run | none | 0.0 |
| `laya-typed-decisions` | PASS | 0.65 | 0.55 | 90 | not run | none | 0.0 |
| `laya` | PASS | 0.45 | 0.65 | 96 | not run | none | 0.0 |
| `mimo-2.6-flash` | PASS | 0.983 | 0.983 | 2854 | 18/21 | s1: 1, s6: 2 | 0.013781 |
| `nemotron-3-ultra-550b-a55b` | PASS | 0.933 | 0.967 | 1185 | 18/21 | s1: 3 | 0.0 |
| `qwen3.8-27b` | PASS | 1.0 | 1.0 | 6617 | 17/21 | s1: 3, s6: 1 | 0.06157 |

Total cost: USD 1.329301
- Scenario 1 ("anything in black under $80") is an initiative test: nothing in the catalog is
  black, 10 products are under $80. A model passes only if it offers those after the empty
  search. Most models answer honestly that nothing matches and stop.
- Scenario 6 failures are fabrication: a zero-hit search followed by an invented product.
- Scenario 7 (`approval_gate`, the fit-coach duplicate approval card) passed 3/3 on every model.
- `jev` on Experiential Labs returned `403 model_not_granted` on 2026-09-23 (both `jev-latest`
  and `jev-latest:free`), although the platform lists both routes as active and the key's usage page counts 4 Jev requests;
  the platform reports 64.5 percent uptime for Jev against 99 percent on OpenRouter. Retry later. The measured row is
  `jev-openrouter`: OpenRouter serves it as `typesafe/jev-1.13` under the Decisions category (not in
  `/api/v1/models`), via `POST /api/v1/systemone`. All three variants (choice, score, noul) scored
  100 percent on kind and transfer, 100 percent agreement over 5 reps, 0.57-0.59 s mean, USD 0.0068
  for 300 calls, billed at USD 0.042/M input tokens (not free on OpenRouter).
- Laya runs locally (`pip install laya`, pulls PyTorch, about 950 MB venv plus 2.2 GB of weights, 30 s first load on
  Apple Silicon) with the same state plus typed questions shape as Jev. Best variant per checkpoint
  on this set: `laya` 45 percent kind / 75 percent transfer, `laya-multilingual` 55 / 50,
  `laya-typed-decisions` 65 / 70. Perfectly deterministic and 40-160 ms, but near chance on a
  3-way kind, as its own model card predicts for an untuned checkpoint (0.362 on the vendor's
  benchmark before fine-tuning).
- `grok-4.7` returned cost 0.0 on a one-call probe on 2026-09-22 but was billed during the run.
- `qwen3.8-27b-free` (OpenRouter `:free`) is not a quality result: decision scored 28 percent because most calls hit upstream `429` rate limits, counted as wrong. Run stopped before tool call. The paid `qwen3.8-27b` row is the real measure of the model.

## Track 2: coding fix, 2026-09-23

Task (`tracks/coding/task.md`): make fit-coach's catalog size families independent of where the
size is written in the name (new pure `sizeFamilyKey` in `src/lib/catalogName.ts`, both callers
switched, old function removed, own unit tests). Each model ran as a headless Claude Code agent
pointed at its gateway, in a detached worktree of fit-coach at `ebe3235`, with an isolated config
dir and a 60-turn cap. Graded after the agent stopped: 11 hidden vitest cases
(`tracks/coding/hidden.test.ts`) plus 9 checks (module exists and is pure, own tests exist, old
function removed, both callers use the new one, tsc, eslint, full vitest). A reference solution
written by the orchestrator scored 11/11 and 9/9 before any model ran.

| Model | Hidden tests | Checks | Comment lines | Turns | Minutes | Files changed |
|---|---|---|---|---|---|---|
| `glm-5.3` | 11/11 | 9/9 | 0 | 19 | 4.5 | 4 |
| `deepseek-4.1-flash` | 11/11 | 9/9 | 0 | 28 | 5.2 | 4 |
| `kimi-k3` | 11/11 | 9/9 | 0 | 22 | 8.6 | 4 |
| `gpt-5.6-luna` | 11/11 | 9/9 | 0 | 61 | 10.7 | 4 |
| `mimo-2.6-flash` | 11/11 | 9/9 | 0 | 38 | 24.6 | 4 |

- Every model that finished solved it completely, so this task separates on speed and turn count,
  not correctness. It is not hard enough to rank the top models against each other.
- `gpt-5.6-luna` needed 61 turns and hit the cap on its last one.
- `qwen3.8-27b` is not measured: both attempts died after 4 turns on a Cloudflare 5xx from the
  Experiential Labs gateway, with no file changed. Dropped by Matias.
- Token cost per model is not reported: headless Claude Code prices the run with Anthropic rates,
  not the gateway's. The gateway usage page is the source for real spend.

## Track 4: vision

NOT RUN. `fixtures/vision/` is empty; Matias has not supplied the 3 receipt images. The runner
and grader (`tracks/vision/runner.py`, `tracks/vision/grader.py`) are built and ready: once
images land in `fixtures/vision/` matching the ids in `tracks/vision/scenarios.json`, `run_bench
--tracks vision` runs the capability check against the 3 vision-capable models
(qwen3.8-27b, mimo-2.6-flash, deepseek-4.1-flash).

## Verdict

- `deepseek-4.1-flash`: best overall, also 11/11 on the coding fix in 5 minutes. 100 percent decision, 19/21 tool call, fastest paid model, USD 0.047. Default pick for agents.
- `gpt-5.6-luna`: same accuracy as DeepSeek at zero cost, but never took the initiative in scenario 1 (0/3). Best free option while it stays free.
- `glm-5.3`: 19/21 and 100 percent decision, but 5x DeepSeek's cost for the same result.
- `glm-5.3-flash`: 100 percent decision, 18/21, cheap. A valid second option.
- `mimo-2.6-flash`: cheapest paid (USD 0.014), 98 percent decision, but the most fabrication in scenario 6 (2/3). Not for writes without a guard.
- `nemotron-3-ultra-550b-a55b`: free and fastest decision (1.2 s) but 93 percent on kind. Fine for low-stakes triage.
- `qwen3.8-27b`: 100 percent decision but the slowest (6.6 s) and lowest tool call (17/21).
- `grok-4.7`: same result as the cheap models at 8x DeepSeek's cost. No reason to use it.
- `kimi-k3`: worst decision accuracy (87 percent, 65 percent agreement between reps) and the most expensive (USD 0.56). Not for this kind of work.
- `laya`: not usable off the shelf for this domain, 35-65 percent. Dropped 2026-09-23: `laya` removed from `requirements.txt`, PyTorch and the cached weights deleted, rows disabled in `models.json`; `pip install laya` to re-measure. Only worth it after fine-tuning on labelled transactions (the vendor notebook runs on Kaggle's free 2xT4).
- `jev` (OpenRouter): best decision engine measured. 100 percent in every variant, 0.6 s, about USD 0.00002 per call, 2x faster than the fastest LLM. Use it for classification and gating, not for chat.

## Not measured

- Track 2 on a harder task: the current one does not separate the top five.
- Track 4 (vision): fixtures missing.
- Laya fine-tuned on money-tracker labels.
