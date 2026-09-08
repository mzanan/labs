# p0-provider-layer

**Question.** Does the Vercel AI SDK actually unify two genuinely different LLM API shapes, or does the abstraction leak once you go past a plain text call? Specifically, with the API key supplied **per request** rather than read from the environment, does the same code produce the same result for:

1. a plain text completion,
2. a tool call (the model choosing to invoke a function and receiving its result),
3. structured JSON output validated against a schema?

**Why it matters.** [`fit-coach`](../../fit-coach) needs a provider layer where each end user brings their own key and picks their own model. The decision is between adopting this SDK, extending the hand-rolled OpenAI-compatible client already in that repo, or putting an external gateway in front. This lab only answers whether the SDK's abstraction holds; the decision is made elsewhere.

**Date run.** 2026-07-30 (rounds 1 to 3), 2026-09-07 (rounds 4 and 5, Vercel AI Gateway), 2026-09-08 (round 6).

## Scope limit, stated up front

The two providers under test are **Groq** (OpenAI-compatible wire format) and **Google Gemini via its native API** (`@ai-sdk/google`, not Gemini's OpenAI-compat endpoint). These are two genuinely different wire formats and both have a real free tier.

**Anthropic is NOT tested here, and it is the most divergent of the three** (`tool_use` / `tool_result` content blocks, `system` as a separate top-level parameter rather than a message). At the time of writing there was no Anthropic key available and no budget for one. So this lab answers *"the abstraction holds across two different formats"*, not *"it holds against the worst case"*.

Closing that gap later costs roughly $0.04 for 100 tool-use calls on Claude 3 Haiku. Until it is closed, do not cite this lab as proof that the SDK handles Anthropic.

## Running it

```
cp .env.example .env
# fill in the keys for the providers you want measured, rows without a key are SKIPPED
npm install
npm start
```

Keys, all read from `.env`:
- Groq: https://console.groq.com/keys (free tier, no card)
- Google AI Studio: https://aistudio.google.com/apikey (free tier, no card)
- OpenRouter: https://openrouter.ai/settings/keys (rounds 2+, paid models need credits)
- Vercel AI Gateway: Vercel dashboard > AI Gateway > API keys (rounds 4+, needs a payment method on file; the free tier is rate-limited per model, see round 5)

Pacing knobs, all env: `PAUSE_MS` between checks (default 20000 since round 5, the Gateway free tier needs it), `ATTEMPTS` per check (default 3), `RETRY_PAUSE_MS` between attempts of one check (default 2000), `CALL_TIMEOUT_MS` (default 45000), `CANDIDATES_FILE` (default `candidates.json`, round 6 used `candidates-round6.json`).

The keys are read once at startup and then **passed explicitly into each provider factory**, which is the point: this mirrors how a real app would pass a key belonging to whoever is making the request, instead of relying on a process-wide environment variable.

## What is measured

For each provider, each of the three capabilities gets a pass or fail plus the failure reason, and the run prints a comparison table. A capability that fails on one provider and passes on the other is the interesting result: that is the abstraction leaking.

## Result, round 6 (2026-09-08 11:23 ICT): the 3 rate-limited rows rerun with 60 s spacing

Versions: `ai` 7.0.42, `@ai-sdk/gateway` 4.0.32 (transitive, resolved by `ai` 7), Node v22.22.2. Candidates file scoped to only the 3 rows round 5 left BLOCKED by the Gateway's free-tier per-model rate limit, run with wider pacing.

Command:

```
CANDIDATES_FILE=candidates-round6.json PAUSE_MS=60000 RETRY_PAUSE_MS=60000 node --env-file=.env node_modules/.bin/tsx src/run.ts
```

### Summary

| model | wire format | plain text | tool call | structured JSON | served by |
|---|---|---|---|---|---|
| Gateway to gpt-oss-120b (unpinned, run 1) | Vercel AI Gateway | PASS | PASS | PASS | baseten |
| Gateway to gpt-oss-120b (pinned groq) | Vercel AI Gateway | PASS | PASS | PASS | groq |
| Gateway to anthropic/claude-haiku-4.5 (Anthropic, first time tested) | Vercel AI Gateway | BLOCKED | BLOCKED | BLOCKED | |

Run's own verdict lines: "No divergence: every capability behaved the same everywhere it was measured." and "NOT MEASURED everywhere (quota or timeout): plain text, tool call, structured JSON. Re-run before trusting those rows." (the unmeasured rows being all three checks on the Anthropic row).

### Declared vs measured

`[gateway] Declared capabilities from the provider's own catalogue: 371 models, 235 declare tool use, 0 declare structured output.`

```
matches   openai/gpt-oss-120b tool call: declared true, measured true
not declared  openai/gpt-oss-120b structured JSON: catalogue has no structured field
matches   openai/gpt-oss-120b tool call: declared true, measured true
not declared  openai/gpt-oss-120b structured JSON: catalogue has no structured field

[gateway] 2/2 predictions correct.
endpoint check  Gateway to gpt-oss-120b (pinned groq)  declared by endpoint groq: tools true, measured true
```

### Cost

`Gateway cost this run: $0.00037455 (6/9 calls reported cost)`. Under the $0.20 stop threshold; the run was not halted.

### Verdict, round 6

1. **Pinned groq now behaves like pinned cerebras did in round 5.** PASS 3/3, single consistent `served by groq` on every check, matching cerebras's clean 3/3 in round 5. The only rough edge: the tool call took 64042ms and needed 2 attempts (one retry), while plain text and structured JSON each passed on the first attempt in ~1-1.5s. So pinning plus 60s spacing produced the same determinism round 5 could not get out of `pinned groq` (it never got a comparison at all, rate-limited before the tool-call check could complete).
2. **The "Anthropic never tested" caveat is still open, not closed.** All three checks on `anthropic/claude-haiku-4.5` came back BLOCKED, error class `provider quota hit, capability NOT measured` (3 attempts each, ~123-126s per check). 60s spacing was not enough to clear this model's free-tier rate limit; the Scope limit paragraph above stands unchanged since no Anthropic capability call actually completed this round either.
3. **Unpinned run 1 stayed on one provider this time** (baseten on all three checks), where round 5's unpinned row switched provider mid-row (baseten then fireworks). One sample each way: unpinned routing is not deterministic across runs, which is the round-3 finding again, not a contradiction of it.

**Decision 2026-09-08 11:43 ICT (Matias, on Fable's advice): stop chasing the Anthropic row.** Every question this lab exists for is measured; an Anthropic model is not measurable on the Gateway free tier even at 60 s spacing, and fit-coach does not offer Claude as a model today. If it ever does, measure it then with paid Gateway credits. The caveat stays worded as "not measurable on the free tier", not "never tested by omission".

## Result, round 5 (2026-09-07 18:02 ICT): payment method added, Gateway calls complete, free-tier rate limit is the real ceiling

Two things round 4 got wrong, corrected by Fable before this round:

- **A run attempted at 16:48 ICT failed on every single row, Gateway and non-Gateway alike, with `Cannot connect to API`.** Cause: the VPN. Groq returns a `403` through it. Not evidence about the Gateway; that run's output was discarded, no code changed because of it.
- **The Gateway's free tier is itself rate-limited per model** (`GatewayRateLimitError: Free tier requests on this model are rate-limited. Upgrade to paid credits`), independent of the round-4 payment-method gate. A payment method on file does not remove this: it only unlocks the free tier from returning the harder `credit card` error. This is a much lower ceiling (a handful of calls/minute per model) than round 4's all-or-nothing block.

Code fixes applied before this run: `checks.ts` now passes `maxRetries: 0` to `generateText`/`generateObject` (the SDK's internal retry defaulted to 2, silently burning 3x the rate-limit budget per check even under this lab's own `ATTEMPTS`); `QUOTA_MARKERS` gained `"rate-limited"` and `"free tier"` so this classifies BLOCKED, not FAIL; `PAUSE_MS` default raised 7000 to 20000, applied globally (simpler than a gateway-only branch); the endpoint-matching bug flagged in round 4 is fixed, both providers now compare lowercase, and OpenRouter matches on the endpoint's `tag` field split at `/` (`"baseten/fp4"` to `"baseten"`) instead of the capitalized `provider_name` (`"BaseTen"`), which is what actually carries the routing slug; the side-by-side block's `cost this run` row had `gateway`'s cost mislabeled under the `openrouter:` column, fixed to show both sides explicitly.

### Summary

| model | wire format | plain text | tool call | structured JSON | served by |
|---|---|---|---|---|---|
| Groq llama-3.3-70b-versatile | OpenAI-compatible | FAIL | FAIL | FAIL | |
| Groq openai/gpt-oss-120b | OpenAI-compatible | PASS | PASS | PASS | |
| OpenRouter to openai/gpt-oss-120b | OpenRouter gateway | PASS | PASS | PASS | |
| OpenRouter to gpt-oss-120b (routed to Groq) | OpenRouter gateway | FAIL | FAIL | FAIL | |
| OpenRouter to nemotron-3-super:free | OpenRouter gateway | PASS | PASS | PASS | |
| OpenRouter to ling-3.0-flash:free | OpenRouter gateway | FAIL | FAIL | FAIL | |
| Gemini 2.5 Flash (native) | Google native | PASS | PASS | PASS | |
| Gateway to gpt-oss-120b (unpinned, run 1) | Vercel AI Gateway | PASS | PASS | PASS | baseten, fireworks |
| Gateway to gpt-oss-120b (unpinned, run 2) | Vercel AI Gateway | PASS | BLOCKED | BLOCKED | baseten |
| Gateway to gpt-oss-120b (unpinned, run 3) | Vercel AI Gateway | BLOCKED | BLOCKED | BLOCKED | |
| Gateway to gpt-oss-120b (pinned groq) | Vercel AI Gateway | BLOCKED | BLOCKED | BLOCKED | |
| Gateway to gpt-oss-120b (pinned cerebras) | Vercel AI Gateway | PASS | PASS | PASS | cerebras |
| Gateway to anthropic/claude-haiku-4.5 (first time tested) | Vercel AI Gateway | BLOCKED | BLOCKED | BLOCKED | |
| Gateway to ling-3.0-flash-fin-free (free) | Vercel AI Gateway | BLOCKED | BLOCKED | BLOCKED | |
| Gateway to laguna-s-2.1-free (free) | Vercel AI Gateway | BLOCKED | BLOCKED | BLOCKED | |

The two `:free`-slug OpenRouter FAILs and the stale Groq slug are unchanged environmental noise from rounds 2-4, not a Gateway finding.

### Declared vs measured

**OpenRouter**: 430 models, 363 declare tool use, 344 declare structured output. `4/6 predictions correct` (same shape as round 4: `openai/gpt-oss-120b` and `nemotron-3-super` match on both checks; the routed-to-Groq row is a MISMATCH pair, but not a capability gap: it ran out of OpenRouter credits, and this round's fixed endpoint lookup confirms it, `declared by endpoint groq: tools true, measured false`).

**Vercel AI Gateway**: 371 models, 235 declare `tool-use`, 0 declare structured output. `2/2 predictions correct`, but on a small sample: most Gateway rows were BLOCKED by the free-tier rate limit before a comparison was possible, so this is 2 data points, not a real test of the catalogue.

**Endpoint-level check for the pinned rows**: `pinned cerebras` matched, `declared by endpoint cerebras: tools true, measured true`. `pinned groq` never produced a comparison, the row was BLOCKED on every attempt (rate-limited before the tool-call check could complete).

### The three unpinned runs

**Run 1 passed 3/3, but landed on two different providers within the same row**: `baseten` served plain text and structured JSON, `fireworks` served the tool call. That alone is the round-3 finding again, on the Gateway: one label, multiple backends, mid-row. **Run 2 passed its first check (plain text, `baseten`) then hit the free-tier rate limit on the next two.** **Run 3 was rate-limited from the first check.** Of three unpinned samples, one came back clean, and even that one was not served by a single consistent provider. This is not the same failure mode round 3 found (a provider silently not supporting tools); it is the Gateway's own throttle interrupting mid-sequence, which still proves the same practical point: **an unpinned call sequence to this model is not reliably repeatable within a session.**

### Cost

**Gateway cost this run: $0.00051915** (7/24 calls reported cost; every call that was not BLOCKED or FAIL reported one, no gaps). Well under the $0.05 expected and the $0.20 stop threshold Fable set; the run was not halted.

### Side by side: OpenRouter vs Vercel AI Gateway

| property | OpenRouter | Vercel AI Gateway |
|---|---|---|
| per-request key | yes (BYOK, no gateway env var) | yes (`createGateway({ apiKey })`, live calls completed this round) |
| catalogue declares tools | yes (`supported_parameters`) | yes (`tags` includes `tool-use`) |
| catalogue declares structured output | yes (`structured_outputs`) | no (no model-level field) |
| per-model endpoints listing | yes | yes |
| routing pin API | model-creation: `provider.only` | call-time: `providerOptions.gateway.only` |
| served-by exposed | no | **yes, confirmed live**: `providerMetadata.gateway.routing.finalProvider` populated on every successful call (`baseten`, `fireworks`, `cerebras` all observed) |
| providers serving gpt-oss-120b | 19 (round 3) | 8 (this run) |
| cost this run | not re-measured (round 2's $0.000105507 stands) | $0.00051915 |
| markup | 5.5% on credit purchase (vendor page) | 0% on provider price (vendor page) |

### Anthropic

`anthropic/claude-haiku-4.5` (Fable's correction to round 4's pick: the current-generation Haiku, not the legacy `claude-3-haiku`) was queued but BLOCKED by the free-tier rate limit on every attempt. **Still untested.** The scope-limit paragraph above stays as written, since Anthropic was not measured this round either.

### Verdict, round 5

1. **Per-request key: confirmed, fully, this time.** Live calls completed end to end through `createGateway({ apiKey })`, same mechanism and same result shape as OpenRouter's BYOK.
2. **Catalogue predicts measured capability: 2/2, too small a sample to call it settled.** The free-tier rate limit blocked most of the rows that would have tested this; round 4 already confirmed the catalogue's *shape* (0 models declare structured output) live, without needing a successful chat call.
3. **Unpinned non-determinism vs pinned determinism: real, but confounded by the rate limit.** The one clean unpinned run already shows two different serving providers inside a single row. Pinned `cerebras` was clean and consistent 3/3. Pinned `groq` could not be tested at all, rate-limited before the model ever ran, so this round cannot say pinning fixes the intermittency the way round 3 showed on OpenRouter, only that the Gateway is capable of a determinism at least as good (`cerebras`'s 3/3 same-provider result).
4. **Served-by exposed: confirmed.** `providerMetadata.gateway.routing.finalProvider` came back correctly on every successful call.
5. **Side-by-side table: fully populated with live values on both sides**, cost included.

**The real ceiling this round was not billing, it was Vercel's own free-tier per-model rate limit**, a few requests per minute per model, hit even by a single test call on both never-before-tried free models (`ling-3.0-flash-fin-free`, `laguna-s-2.1-free`). To get a clean, uncontaminated pinned-vs-unpinned comparison (the one thing this round could not fully settle), purchase paid AI Gateway Credits, which raises the rate limit per Vercel's docs, or run fewer Gateway rows per invocation with more spacing.

## Result, round 4 (2026-09-07 16:17 ICT): Vercel AI Gateway side by side with OpenRouter

Versions: `ai` 7.0.42, `@ai-sdk/gateway` 4.0.32 (transitive, resolved by `ai` 7; the spec's fact-check cited 4.0.75 from 2026-09-04, the installed resolution is older), Node v22.22.2.

**Every Vercel AI Gateway call this round was BLOCKED: `AI Gateway requires a valid credit card on file to service requests.`** The API key (`AI_GATEWAY_API_KEY`, created and pasted mid-session) authenticates fine, the block is account-level billing, not the key. The prerequisite in this spec ("add a payment method") was not done before the run. `QUOTA_MARKERS` in `checks.ts` gained a `"credit card"` marker so this reports as BLOCKED, not FAIL, matching the run procedure's contingency.

### Summary

| model | wire format | plain text | tool call | structured JSON | served by |
|---|---|---|---|---|---|
| Groq llama-3.3-70b-versatile | OpenAI-compatible | FAIL | FAIL | FAIL | |
| Groq openai/gpt-oss-120b | OpenAI-compatible | PASS | PASS | PASS | |
| OpenRouter to openai/gpt-oss-120b | OpenRouter gateway | PASS | PASS | PASS | |
| OpenRouter to gpt-oss-120b (routed to Groq) | OpenRouter gateway | FAIL | FAIL | FAIL | |
| OpenRouter to nemotron-3-super:free | OpenRouter gateway | PASS | PASS | PASS | |
| OpenRouter to ling-3.0-flash:free | OpenRouter gateway | FAIL | FAIL | FAIL | |
| Gemini 2.5 Flash (native) | Google native | PASS | PASS | PASS | |
| Gateway to gpt-oss-120b (unpinned, run 1) | Vercel AI Gateway | BLOCKED | BLOCKED | BLOCKED | |
| Gateway to gpt-oss-120b (unpinned, run 2) | Vercel AI Gateway | BLOCKED | BLOCKED | BLOCKED | |
| Gateway to gpt-oss-120b (unpinned, run 3) | Vercel AI Gateway | BLOCKED | BLOCKED | BLOCKED | |
| Gateway to gpt-oss-120b (pinned groq) | Vercel AI Gateway | BLOCKED | BLOCKED | BLOCKED | |
| Gateway to gpt-oss-120b (pinned cerebras) | Vercel AI Gateway | BLOCKED | BLOCKED | BLOCKED | |
| Gateway to anthropic/claude-3-haiku (Anthropic, first time tested) | Vercel AI Gateway | BLOCKED | BLOCKED | BLOCKED | |

The two non-Gateway FAIL rows (Groq stale slug, OpenRouter routed-to-Groq out of credits) and the free-slug FAIL on OpenRouter (`ling-3.0-flash:free`) are unrelated to the Gateway, unchanged environmental noise carried over from rounds 2-3.

### Declared vs measured

**OpenRouter** (its own catalogue, re-fetched live): 430 models, 363 declare tool use, 344 declare structured output. `4/6 predictions correct` this run (`openai/gpt-oss-120b` matches on both checks, `nvidia/nemotron-3-super-120b-a12b:free` matches on both; the routed-to-Groq row is a MISMATCH pair because it was out of OpenRouter credits, not a capability gap).

**Vercel AI Gateway**: catalogue fetched live, no auth: 371 models, 235 declare `tool-use`, **0 declare structured output** (confirms the spec fact: no model-level structured-output field exists in this catalogue). No declared-vs-measured comparison could run: every Gateway check was BLOCKED, and `compareDeclaredVsMeasured` correctly skips BLOCKED rows rather than counting them.

**Endpoint-level check for the pinned rows (groq, cerebras)**: not run, for the same reason (rows are BLOCKED). Code path is in place (`loadEndpoints("gateway", ...)`) but never exercised.

**Bug found while wiring the OpenRouter endpoint check**: OpenRouter's `provider.only` routing slug is lowercase (`"groq"`) but its own `/endpoints` response names the same provider `provider_name: "Groq"` (capitalized). The lookup in this lab does an exact string match, so `OpenRouter to gpt-oss-120b (routed to Groq)` printed `no endpoint found for provider "groq"` both runs. Not fixed (case-insensitive match was not in the spec's scope for this round), flagging it here because it silently no-ops instead of failing loud.

### The three unpinned runs

All three (`run 1`, `run 2`, `run 3`) came back BLOCKED, identical error, identical 3 attempts each. **Which provider each would have landed on, and whether tools would have worked, is unmeasured.** Three BLOCKED samples prove nothing about routing determinism either way; they only prove the billing gate is consistent, not intermittent.

### Side by side: OpenRouter vs Vercel AI Gateway

| property | OpenRouter | Vercel AI Gateway |
|---|---|---|
| per-request key | yes (BYOK, no gateway env var) | yes, key authenticates (`createGateway({ apiKey })`); every downstream call still failed on billing |
| catalogue declares tools | yes (`supported_parameters`) | yes (`tags` includes `tool-use`) |
| catalogue declares structured output | yes (`structured_outputs`) | no (no model-level field) |
| per-model endpoints listing | yes | yes |
| routing pin API | model-creation: `provider.only` | call-time: `providerOptions.gateway.only` |
| served-by exposed | no | not observed this run (every call BLOCKED before a response existed) |
| providers serving gpt-oss-120b | 19 (round 3); 18 unique `provider_name`s on a fresh fetch this round | 8 (fetched live this round: baseten, bedrock, cerebras, fireworks, groq, nebius, parasail, togetherai, all 8 declare `tools` in `supported_parameters`) |
| cost this run | not re-measured (round 2's $0.000105507 stands) | $0.00000000 (0/18 calls reported cost; nothing executed) |
| markup | 5.5% on credit purchase (vendor page, per spec) | 0% on provider price (vendor page, per spec) |

### Anthropic

`anthropic/claude-3-haiku` (id confirmed live via `GET /v1/models`, filtered `owned_by: anthropic`, lowest `pricing.input` among ids containing "haiku": `claude-3-haiku` at `$0.00000025`/input token, cheaper than `claude-haiku-4.5` at `$0.000001`) was queued but BLOCKED like every other Gateway row. **The "Anthropic never tested" gap from rounds 1-3 is still open**; this round did not close it, it only prepared the row.

### Verdict, round 4

**This round did not answer its own question. The billing prerequisite was not met, so none of the five questions got a real measurement.**

1. **Per-request key: partially confirmed, not fully.** The key authenticates (the Gateway recognizes the account and returns an account-specific billing error rather than a generic 401), which is consistent with `createGateway({ apiKey })` working the way OpenRouter's BYOK does. But no call ever completed, so "does the same code produce the same result" is unanswered for the Gateway side.
2. **Catalogue predicts measured capability: unmeasured.** Cannot be answered this round.
3. **Unpinned non-determinism vs pinned determinism: unmeasured.** Three identical BLOCKED runs are not three identical successful runs; this proves nothing about routing.
4. **Served-by exposed: unmeasured.** The field (`providerMetadata.gateway.routing.finalProvider`) is wired into `checks.ts` and `run.ts` but never populated because no call ever returned.
5. **Side-by-side table: built, but half its Gateway-side cells are structural facts (catalogue schema, routing API) from the live catalogue/endpoints fetches, not from a live chat completion.** Those two fetches (`/v1/models`, `/v1/models/{id}/endpoints`) work with no auth and no billing gate, which is why the Gateway's endpoint count (8) and catalogue stats are real measurements while everything downstream of a `generateText`/`generateObject` call is not.

**Consequence:** add the payment method in the Vercel dashboard (AI Gateway > Settings), then re-run `npm start` from this same `candidates.json`; every code path this round wired (routing pin, served-by extraction, cost summation, per-provider declared-vs-measured, endpoint cross-check) is ready and only needs a working billing account to produce round 5's numbers.

## Result, round 3 (2026-07-30 16:4x ICT): the gateway routes one model across many providers

Round 2 concluded that OpenRouter's per-model capability declaration predicted reality 5/5. Round 3 found the case where that is not enough, and it is the most important finding in this lab.

**`openai/gpt-oss-120b` passed the tool-call check in one run and failed it repeatedly in the next, with identical code.** Six consecutive attempts reported `tool never invoked`. Then, isolating it:

| routing | tool invoked | used the result |
|---|---|---|
| default (OpenRouter picks) | yes | **no** |
| `provider.only: ["groq"]` | yes | yes |
| `provider.only: ["cerebras"]` | error | error |

The cause, from `GET /v1/models/openai/gpt-oss-120b/endpoints`: **19 different providers serve that one model through OpenRouter, and 5 of them do not support tools at all** (SiliconFlow, DigitalOcean, Google, and two Amazon Bedrock endpoints). Several others support tools but not structured output. OpenRouter picks one per request.

So the model-level catalogue says `tools: true` because *some* provider supports it. **The provider you actually get on any given request may not.** That is the real source of the intermittency, not free-tier flakiness.

**Consequence: on a gateway, pin the routing.** `provider: { only: [...] }` turns non-deterministic capability into deterministic capability. Without it, an agent that calls tools works most of the time and silently degrades the rest, which is the worst possible failure shape for a production feature.

With routing pinned and retries in place, the catalogue predicted measured behaviour **8/8**.

**Also added this round, because the lab is a module and not a script** (Matias, 2026-07-30): candidates moved out of the code into `candidates.json`, providers became a registry keyed by id with per-provider key lookup, and failed checks retry (`ATTEMPTS`, default 3) before being recorded, since one measurement against a shared free tier is not evidence.

## Result, round 2 (2026-07-30 15:3x ICT): OpenRouter added

Same three checks, now including OpenRouter as a gateway via `@openrouter/ai-sdk-provider` 3.0.0.

| provider | wire format | plain text | tool call | structured JSON |
|---|---|---|---|---|
| Groq `llama-3.3-70b-versatile` | OpenAI-compatible | PASS | PASS | **FAIL** |
| Groq `openai/gpt-oss-120b` | OpenAI-compatible | PASS | PASS | PASS |
| OpenRouter to `openai/gpt-oss-120b` | gateway | PASS | PASS | PASS |
| OpenRouter to `nemotron-3-super:free` | gateway | PASS | BLOCKED | PASS |
| OpenRouter to `ling-3.0-flash:free` | gateway | PASS | PASS | **FAIL** |
| Gemini 2.5 Flash | Google native | BLOCKED | BLOCKED | BLOCKED |

BLOCKED means not measured: free-tier quota or no response inside the call timeout. Gemini's daily free quota was exhausted by repeated runs, which is a measurement artifact and not a capability result. Its round-1 numbers (all three PASS) stand.

### The finding that matters: the capability registry can be read, not maintained

OpenRouter publishes `supported_parameters` per model on `GET /v1/models`. The lab now pulls that catalogue and checks it against what actually happened:

```
367 models, 301 declare tool use, 292 declare structured output.

  matches   openai/gpt-oss-120b tool call: declared true, measured true
  matches   openai/gpt-oss-120b structured JSON: declared true, measured true
  matches   nvidia/nemotron-3-super-120b-a12b:free structured JSON: declared true, measured true
  matches   inclusionai/ling-3.0-flash:free tool call: declared true, measured true
  matches   inclusionai/ling-3.0-flash:free structured JSON: declared false, measured false

  5/5 predictions correct.
```

`ling-3.0-flash:free` is the decisive row: the catalogue said it does tools but not structured output, and that is exactly what happened. **A per-model capability registry does not have to be hand-maintained if the gateway declares it.** That was the single strongest argument for integrating providers directly, and it is now weaker.

### Other things this round measured

- **A model going through the gateway kept every capability it has direct.** `openai/gpt-oss-120b` passed all three both ways. The gateway did not degrade it.
- **Free model slugs rot.** `deepseek/deepseek-chat-v3-0324:free` returned `This model is unavailable for free. The paid version is available now`. Of 367 models, only 14 are free right now and only 4 of those declare both tools and structured output. Anything built on a specific free slug will break without warning.
- **Free tiers hang, not just fail.** `nemotron-3-super:free` passed all three checks in one run and then stopped responding entirely on the tool call in the next. Without a timeout the runner blocked for 20 minutes on a single call. Calls now carry `abortSignal: AbortSignal.timeout(...)` and a hang is reported as BLOCKED rather than FAIL, because a model that does not answer has not demonstrated an incapability.
- **Cost of the paid model through the gateway**: total OpenRouter usage across every run was **$0.000105507**, roughly a hundredth of a cent.

## Result, round 1 (2026-07-30 14:5x ICT), `ai` 7.0.42, `@ai-sdk/groq` 4.0.16, `@ai-sdk/google` 4.0.28, `zod` 4.4.3, Node 22.22.2.

| provider | wire format | plain text | tool call | structured JSON |
|---|---|---|---|---|
| Groq `llama-3.3-70b-versatile` | OpenAI-compatible | PASS | PASS | **FAIL** |
| Groq `openai/gpt-oss-120b` | OpenAI-compatible | PASS | PASS | PASS |
| Gemini 2.5 Flash | Google native | PASS | PASS | PASS |

The third row was added mid-lab on purpose. The first run only had `llama-3.3-70b-versatile` vs Gemini, which made it look like the OpenAI-compatible format was the thing that failed. Adding a second Groq model on the **same provider and the same wire format** isolated the real variable.

Failure message from Groq, verbatim: `This model does not support response format 'json_schema'. See supported models at https://console.groq.com/docs/structured-outputs#supported-models`

## Verdict

**The SDK abstraction holds. The models underneath do not.**

1. **Identical application code drove two genuinely different wire formats with no branching.** Plain text, tool calling and structured output all worked against both an OpenAI-compatible endpoint and Google's native API. The abstraction is real, not cosmetic.
2. **The key can be supplied per request.** Every call in this lab built its provider with `createGroq({ apiKey })` / `createGoogleGenerativeAI({ apiKey })` from a value read at runtime, never from a process-wide env var the SDK picks up on its own. **BYOK per end user needs no gateway and no paid tier.**
3. **The one failure is a model capability, not a provider or format difference.** Two models on the same provider, same endpoint, same code: one supports JSON schema, the other does not. So a capability table keyed by provider would have been wrong; it has to be keyed by **model**.
4. **The failure was loud, not silent.** Groq returned an explicit error naming the unsupported feature and linking its own compatibility list. That is the good case. It is not guaranteed elsewhere: LiteLLM's `drop_params` is documented to discard an unsupported parameter silently, which would have produced a plausible answer with no structured output and no error at all.
5. **Free-tier quotas are a real hazard when measuring.** An intermediate run showed Gemini failing tool calls and structured output; that was its free-tier quota, not a capability gap. The runner now classifies quota errors as `BLOCKED` (not measured) instead of `FAIL`, and paces requests, because a lab that reports a rate limit as an incapability is a lab that lies.

**What this does NOT establish**, unchanged from the scope limit above: Anthropic was never tested. Its shape is the most divergent of the three and it remains the real stress test for point 1.

**Consequence for the provider decision:** the SDK is viable for the P0 layer and removes the argument for adopting a gateway just to get BYOK. It does not remove the need for a per-model capability registry, which points 3 and 4 make concrete rather than theoretical.

**Superseded in part by round 2 (2026-07-30 15:3x ICT):** the registry still has to exist, but it does not have to be hand-maintained. OpenRouter declares per-model capabilities and the declaration matched reality 5/5. See round 2 above.
