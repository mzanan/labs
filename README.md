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
