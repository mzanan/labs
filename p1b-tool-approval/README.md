# p1b-tool-approval

**Question:** does the Vercel AI SDK's native `toolApproval` (human in the loop before a write) actually work on the free small models fit-coach runs, and what does the app have to handle itself?

**Date:** 2026-08-02, round 2 on 2026-08-03.

**Round 2 question:** the app's coach is `streamText` over an ndjson route, not the two `generateText` passes round 1 used. Does the pause survive that, and does `repairToolCall` (the remedy for the malformed tool names round 1 measured) coexist with `toolApproval` in the same run, given there is no official example of the two together?

## How to run

```
cp .env.example .env   # set GROQ_API_KEY (OPENROUTER_API_KEY optional)
npm install
npm start     # round 1: generateText, two passes
npm run stream  # round 2: streamText + repairToolCall
```

Models live in `candidates.json`, the tools in `src/tools.ts` (one read, one write), the shared scenario in `src/scenario.ts`. The write tool is declared `toolApproval: { log_meal: "user-approval" }` and the prompt asks the coach to log a meal, so every run must stop before writing.

Round 1 (`src/run.ts`), four cases per model: **pauses** (the loop stops and nothing is written), **approve** (feeding the approval back resumes and writes exactly once, with the right values), **deny** (nothing is written), **deny-replay** (whether a tool-less closing call can still produce an answer after a denial).

Round 2 (`src/runStream.ts`), two experiments, `ONLY=stream` or `ONLY=repair` to run one:

- **streaming**: the same three cases driven through `streamText` and `fullStream` instead of `generateText`.
- **repair**: `src/corrupt.ts` wraps the model in a middleware that renames every `log_meal` call to `log_meal<|channel|>commentary`, reproducing the exact malformed name round 1 caught intermittently on `gpt-oss-20b`. That makes an intermittent bug deterministic, so the question stops being "does the model misbehave" and becomes "what does the SDK do when it does". Cases: **corrupt-repro** (baseline, no repair), **repair-approval** (does a repaired call still hit the approval gate, or does repairing bypass it), **repair-resume** (does approving a repaired call write correctly).

## What was measured

| Model | pauses | approve | deny | deny-replay |
|---|---|---|---|---|
| Groq `openai/gpt-oss-120b` | PASS | PASS, wrote `Pollo Avo` as lunch with the catalog's 45g protein | PASS, nothing written | FAIL |
| Groq `openai/gpt-oss-20b` | PASS on two runs, then emitted `log_meal<|channel|>commentary` as the tool name and the call was rejected | PASS when it got that far | PASS | not reached |
| OpenRouter `openai/gpt-oss-20b:free` | PASS | PASS, same write | PASS | FAIL, same error |
| OpenRouter `google/gemma-4-26b-a4b-it:free` (darkbloom) | **FAIL: never called the write tool at all**, so there was nothing to approve | not reached | not reached | not reached |

## Verdict

**Approval works where it matters: the loop reliably stops before a write, and an approval resumes it into exactly one correctly-valued write.** That is the whole point of the feature and it holds on a free small model.

Three things the app must own, all measured rather than assumed:

- **A denial leaves the model silent.** Nothing is written (safe), but the reply comes back empty. The app has to word the denial itself instead of asking the model to comment on it.
- **Never replay a denied history in a closing call.** The denied tool call has no result, so a plain `generateText` over those messages throws `Tool result is missing for tool call`. The tool-less rescue call that fit-coach uses for empty answers is safe today (no approvals in production yet) but must be skipped on the denial path.
- **Small models can emit a malformed tool name.** `gpt-oss-20b` produced `log_meal<|channel|>commentary`, a raw channel token leaking into the name, and the provider rejected the call. Intermittent: the same model passed the same case on an earlier run. A write path needs a retry and a clean user-facing error rather than trusting the first attempt.

- **The mechanism is gateway-independent, the models are not.** `gpt-oss-20b` behaved identically direct on Groq and through OpenRouter, so approval is not something the gateway breaks. But `gemma-4-26b:free`, the model fit-coach had configured on OpenRouter, never called the write tool at all on the same prompt that made both gpt-oss models call it, so there was nothing to approve. **Declaring tool support is not the same as using a write tool when asked**, and a logging feature has to state which models it actually works on rather than assume the capability flag covers it.

Not measured: approval on a model without native tool support, and multiple pending approvals in one turn.

## Round 2, measured 2026-08-03 on `ai` 7.0.48

| Model | stream-pauses | stream-approve | stream-deny | corrupt-repro | repair-approval | repair-resume |
|---|---|---|---|---|---|---|
| Groq `openai/gpt-oss-120b` | PASS | PASS | PASS | PASS | PASS | PASS |
| Groq `openai/gpt-oss-20b` | PASS | PASS | PASS | PASS | PASS | PASS |

**Streaming changes nothing.** `fullStream` emits `tool-approval-request` carrying the `approvalId` and the whole tool call, so the pause can be forwarded live over an ndjson channel and the resume is the same `role: "tool"` message round 1 used. Both models paused with the catalog's exact macros, wrote exactly once on approval, and stayed silent on denial exactly as they did through `generateText`.

**The approval signature is opt-in and absent by default.** Every `tool-approval-request` came back with no `signature` because nothing set `experimental_toolApprovalSecret`. Anything that lets the approval round-trip through a client has to set that secret explicitly, and even then the HMAC binds only the approval to its tool call, not the surrounding messages.

**`repairToolCall` and `toolApproval` compose, and repairing does NOT bypass the human gate.** This was the real risk: a repaired call skipping approval and writing straight through. It does not. On both models the repaired call still raised an approval request and wrote nothing until approved, and approving it then wrote exactly once with the right values.

**Without repair, a malformed tool name fails silently and expensively.** The corrupted run burned all 5 loop steps retrying, wrote nothing, and returned an empty answer. Whether an error reaches `fullStream` is itself intermittent: the same 20b model surfaced Groq's `Tool call validation failed: ... 'log_meal<|channel|>commentary' which was not in request.tools` on one run and nothing at all on the next. **So an app cannot detect this by waiting for an error.** An empty answer after a write was requested is indistinguishable from any other empty answer, which for fit-coach means it lands in the same rescue path it already has, silently.

**Method note:** the malformed name is injected by a `wrapLanguageModel` middleware (`src/corrupt.ts`) rather than waited for. The model behaviour was already measured in round 1; what needed measuring was the SDK's reaction, and that has to be deterministic to be worth anything.
