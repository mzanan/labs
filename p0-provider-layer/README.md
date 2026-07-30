# p0-provider-layer

**Question.** Does the Vercel AI SDK actually unify two genuinely different LLM API shapes, or does the abstraction leak once you go past a plain text call? Specifically, with the API key supplied **per request** rather than read from the environment, does the same code produce the same result for:

1. a plain text completion,
2. a tool call (the model choosing to invoke a function and receiving its result),
3. structured JSON output validated against a schema?

**Why it matters.** [`fit-coach`](../../fit-coach) needs a provider layer where each end user brings their own key and picks their own model. The decision is between adopting this SDK, extending the hand-rolled OpenAI-compatible client already in that repo, or putting an external gateway in front. This lab only answers whether the SDK's abstraction holds; the decision is made elsewhere.

**Date run.** 2026-07-30.

## Scope limit, stated up front

The two providers under test are **Groq** (OpenAI-compatible wire format) and **Google Gemini via its native API** (`@ai-sdk/google`, not Gemini's OpenAI-compat endpoint). These are two genuinely different wire formats and both have a real free tier.

**Anthropic is NOT tested here, and it is the most divergent of the three** (`tool_use` / `tool_result` content blocks, `system` as a separate top-level parameter rather than a message). At the time of writing there was no Anthropic key available and no budget for one. So this lab answers *"the abstraction holds across two different formats"*, not *"it holds against the worst case"*.

Closing that gap later costs roughly $0.04 for 100 tool-use calls on Claude 3 Haiku. Until it is closed, do not cite this lab as proof that the SDK handles Anthropic.

## Running it

```
cp .env.example .env
# fill in GROQ_API_KEY and GOOGLE_API_KEY
npm install
npm start
```

Both keys have free tiers that do not require a card:
- Groq: https://console.groq.com/keys
- Google AI Studio: https://aistudio.google.com/apikey

The keys are read once at startup and then **passed explicitly into each provider factory**, which is the point: this mirrors how a real app would pass a key belonging to whoever is making the request, instead of relying on a process-wide environment variable.

## What is measured

For each provider, each of the three capabilities gets a pass or fail plus the failure reason, and the run prints a comparison table. A capability that fails on one provider and passes on the other is the interesting result: that is the abstraction leaking.

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
