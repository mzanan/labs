# CLAUDE.md

Isolated experiments that answer one question about a technology before it touches a real project. Rules and the lab index live in `README.md`; read it first, it is the contract this file operationalizes.

Consumers so far: `personal/fit-coach` (provider layer, tool loop, tool approval, memory supersession). Findings are cross-referenced from `personal-brain/03-Resources/AI-agent-architecture.md`.

## Structure

One directory per lab, named after the question it answers, never after the technology it uses. Each lab is self-contained:

```
<lab-name>/
  README.md          # question, date, how to run, what was measured, verdict
  package.json       # own deps, own scripts
  tsconfig.json
  .env.example       # every credential the lab reads, empty values
  <fixtures>.json    # models, scenarios, thresholds: configuration, not literals in code
  src/
    run.ts           # entry point, orchestrates and prints results
    <module>.ts      # the reusable piece being measured
```

Root holds only `README.md` (rules + index), `eslint.config.mjs`, `.gitignore` and this file.

## Commands

Per lab, from inside its directory:

- `npm install`
- `node --env-file=.env node_modules/.bin/tsx src/run.ts` (also wired as `npm start`)
- `npm run typecheck`

Do not add a dev server, a build step or a test runner. A lab prints its measurement to stdout and exits.

## Writing a lab

- **A module, not a script.** Models, providers, thresholds, prompts and scenarios are configuration read from a JSON file or env, never literals buried in the run file. The goal is a shelf of pieces a real project can pull in, not a one-off answer.
- **Mirror the target system's real code path** where the question depends on it. If the app normalizes an embedding before storing it, the lab does too, or the numbers do not transfer.
- **Feed the lab what production will feed it.** A lab that hand-supplies a value the real system has a model infer proves less than it appears to. This has already produced one false pass: `p2-memory-supersession` validated a design that failed on its first real input for exactly that reason.
- **Make intermittent behavior deterministic** before measuring it. Injecting a fault with a middleware beats waiting for a flaky model to misbehave.
- **A lab with no verdict is unfinished.** The README states what was measured and what it means, including "this does not work" and "this was refuted".

## Hard rules

- **Never commit a key.** Credentials come from `.env` (gitignored); every lab ships a `.env.example` listing what it needs.
- **Never edit a past result.** A measurement is a dated snapshot with the versions it ran under. If the answer changes later, append a new dated section; do not rewrite the old one.
- **Labs are never deleted, and never closed.** A lab whose conclusion shipped is the more valuable one, because it carries the evidence behind a decision in production. Extend it when a new question about that component appears.
- **When a lab's conclusion is later contradicted by production, say so in that lab's README.** The failure is the finding.
- Keep the root `README.md` index row in sync with each lab's verdict.

## What does not apply here

`personal/CLAUDE.md` governs product repos. Its structural rules (`components/ui`, feature folders, server-first, design tokens) are irrelevant to a lab. What still applies: English docs, no code comments, no em dash, commits in English with no `Co-Authored-By`, and never pushing without an explicit go-ahead.
