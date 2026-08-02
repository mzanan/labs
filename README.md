# labs

Isolated experiments. One directory per lab, self-contained, kept forever.

A lab exists to answer **one question** about a technology before that technology touches a real project. It is throwaway code that is deliberately not thrown away: six months later the measured numbers should live next to the code that produced them, not transcribed into prose somewhere else.

## Rules

- **One directory per lab**, named after the thing it answers, not the tech it uses.
- **Every lab has a `README.md`** with: the question, the date it ran, how to run it, what was measured, and the verdict. A lab with no verdict is unfinished.
- **Never commit a key.** Every lab reads credentials from the environment and ships a `.env.example` listing what it needs.
- **Build every lab as a reusable module, not as a throwaway script.** Nothing hardcoded that a consumer would need to change: models, providers, thresholds and prompts are configuration, not literals in an array. Export a clear surface. The point is that after enough labs there is a shelf of working modules covering search, memory, providers and whatever else, ready to be pulled into a real project instead of rewritten.
- **The measurement is still a dated snapshot even when the module is not.** Record the result with the date and versions it was measured under. If the answer changes later, add a new dated result rather than editing the old one, so the history of what was true when stays readable.

## Index

| Lab | Question | Date | Verdict |
|---|---|---|---|
| [`p0-provider-layer`](./p0-provider-layer) | Does the Vercel AI SDK unify genuinely different LLM API shapes with a per-request key, and can a gateway supply the per-model capability data? | 2026-07-30 | **Yes, with one caveat that matters.** The abstraction holds across direct providers and a gateway, and takes a per-request key. OpenRouter's published per-model capabilities predicted real behaviour 5/5, so the capability registry can be read rather than hand-maintained. **But a gateway routes one model across many providers with different capabilities (19 for one model, 5 without tool support), so the routing has to be pinned or tool calling degrades silently.** Anthropic untested. |
| [`p1b-tool-approval`](./p1b-tool-approval) | Does the SDK's native tool approval (human in the loop before a write) work on free small models, and what must the app handle itself? | 2026-08-02 | **Yes for the path that matters:** the loop stops before writing and an approval resumes it into exactly one correct write, on `gpt-oss-120b`. **Three things the app must own:** a denial leaves the model silent so the app words it, a denied history cannot be replayed in a closing call (throws `Tool result is missing`), and small models intermittently emit a malformed tool name, so a write path needs a retry and a clean error. |
| [`p1-tool-loop`](./p1-tool-loop) | Does the AI SDK's native tool loop work reliably on OpenRouter free models with pinned routing, for a 4-tool coach agent? | 2026-08-01 | **Yes, no hand-rolled loop or ReAct fallback justified.** 20/20 measurable cells: correct tool choice, no keyword-baiting, exact arguments, 2-3 step chains completed. gemma-4-26b (darkbloom) 10/10. Only non-quota failure was an upstream infra timeout, retries stay mandatory. **The real ceiling is the free-tier daily quota (~50 req/day): a tool loop spends 2-3 requests per question and the cap died mid-run.** |
