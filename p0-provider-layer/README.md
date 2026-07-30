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

## Result

Run 2026-07-30 14:5x ICT, `ai` 7.0.42, `@ai-sdk/groq` 4.0.16, `@ai-sdk/google` 4.0.28, `zod` 4.4.3, Node 22.22.2.

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
