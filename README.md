# labs

Isolated experiments. One directory per lab, self-contained, kept forever.

A lab exists to answer **one question** about a technology before that technology touches a real project. It is throwaway code that is deliberately not thrown away: six months later the measured numbers should live next to the code that produced them, not transcribed into prose somewhere else.

Method: [`personal-brain/02-Areas/Architecture-first-methodology.md`](../personal-brain/02-Areas/Architecture-first-methodology.md). Findings get written up in `personal-brain/03-Resources/AI-agent-architecture.md` (for AI/agent labs) and linked back here.

## Rules

- **One directory per lab**, named after the thing it answers, not the tech it uses.
- **Every lab has a `README.md`** with: the question, the date it ran, how to run it, what was measured, and the verdict. A lab with no verdict is unfinished.
- **Never commit a key.** Every lab reads credentials from the environment and ships a `.env.example` listing what it needs.
- **A lab is never imported by a real project.** If it works, the pattern gets reimplemented properly in the project. Copying lab code into production is how throwaway code becomes load-bearing.
- **Do not update a lab when the world changes.** Labs are dated snapshots. If the answer changes, write a new lab and link it from the old one.

## Index

| Lab | Question | Date | Verdict |
|---|---|---|---|
| [`p0-provider-layer`](./p0-provider-layer) | Does the Vercel AI SDK actually unify two genuinely different LLM API shapes, with the key passed per request? | 2026-07-30 | **Yes.** The abstraction holds and takes a per-request key; the only failure was a per-model capability gap (JSON schema), not a format or provider one. Anthropic untested. |
