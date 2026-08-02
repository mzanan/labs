# p1b-tool-approval

**Question:** does the Vercel AI SDK's native `toolApproval` (human in the loop before a write) actually work on the free small models fit-coach runs, and what does the app have to handle itself?

**Date:** 2026-08-02

## How to run

```
cp .env.example .env   # set GROQ_API_KEY (OPENROUTER_API_KEY optional)
npm install
npm start
```

Models live in `candidates.json`, the tools in `src/tools.ts` (one read, one write), the scenario in `src/run.ts`. The write tool is declared `toolApproval: { log_meal: "user-approval" }` and the prompt asks the coach to log a meal, so every run must stop before writing.

Four cases per model: **pauses** (the loop stops and nothing is written), **approve** (feeding the approval back resumes and writes exactly once, with the right values), **deny** (nothing is written), **deny-replay** (whether a tool-less closing call can still produce an answer after a denial).

## What was measured

| Model | pauses | approve | deny | deny-replay |
|---|---|---|---|---|
| Groq `openai/gpt-oss-120b` | PASS | PASS, wrote `Pollo Avo` as lunch with the catalog's 45g protein | PASS, nothing written | FAIL |
| Groq `openai/gpt-oss-20b` | PASS on two runs, then emitted `log_meal<|channel|>commentary` as the tool name and the call was rejected | PASS when it got that far | PASS | not reached |

## Verdict

**Approval works where it matters: the loop reliably stops before a write, and an approval resumes it into exactly one correctly-valued write.** That is the whole point of the feature and it holds on a free small model.

Three things the app must own, all measured rather than assumed:

- **A denial leaves the model silent.** Nothing is written (safe), but the reply comes back empty. The app has to word the denial itself instead of asking the model to comment on it.
- **Never replay a denied history in a closing call.** The denied tool call has no result, so a plain `generateText` over those messages throws `Tool result is missing for tool call`. The tool-less rescue call that fit-coach uses for empty answers is safe today (no approvals in production yet) but must be skipped on the denial path.
- **Small models can emit a malformed tool name.** `gpt-oss-20b` produced `log_meal<|channel|>commentary`, a raw channel token leaking into the name, and the provider rejected the call. Intermittent: the same model passed the same case on an earlier run. A write path needs a retry and a clean user-facing error rather than trusting the first attempt.

Not measured: OpenRouter models (the free daily quota was spent), approval on a model without native tool support, and multiple pending approvals in one turn.
