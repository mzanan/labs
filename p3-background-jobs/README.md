**Question:** for fit-coach's P3 (autonomous background maintenance: stale-fact cleanup, memory re-grounding, weekly summaries), which of Vercel Cron, Vercel Workflow DevKit and Inngest actually fires reliably on a schedule inside each provider's free tier, without an always-on server, and what does each cost to integrate into a Next.js App Router app already deployed on Vercel?

**Date:** in progress, started 2026-08-06. This is a platform-primitive lab (see the exception in `labs/CLAUDE.md`): it cannot be answered by a local script, so it ships a deployable Next.js app instead of a `src/run.ts`.

## Candidates under test

1. **`/api/cron-direct`**: plain Vercel Cron Job (`vercel.json` `crons`) hitting a route handler directly. The baseline, no extra package.
2. **`/api/cron-workflow-trigger`**: Vercel Cron Job that calls `start()` from the `workflow` package (Workflow DevKit, `'use workflow'` / `'use step'`). Confirmed against current docs (2026-07-15): Workflow DevKit has no native scheduling primitive of its own, it is always started from a route, so this candidate measures whether wrapping the maintenance job in a durable workflow (auto-retry per step, resumable across deploys) is worth the extra package on top of the same Cron trigger candidate 1 uses.
3. **`/api/inngest`**: Inngest function with a native `triggers: { cron: ... }`, served from one route handler, scheduled from Inngest Cloud rather than `vercel.json`.

## How to deploy and verify

```
npm install
vercel link          # throwaway project, not fit-coach's
vercel env add CRON_SECRET production
# Inngest: create a free account at inngest.com, create an app, get signing key + event key
vercel env add INNGEST_SIGNING_KEY production
vercel env add INNGEST_EVENT_KEY production
vercel --prod
```

Verification is dashboard-based, not a DB, since all three candidates already have their own run history:

- Cron candidates: Vercel dashboard > Observability > Logs (or `vercel logs <deployment-url>`), filter for `[cron-direct]` / `[workflow-step]`.
- Workflow candidate: Vercel dashboard > Observability > Workflows, shows each run's steps, retries and duration natively.
- Inngest candidate: Inngest Cloud dashboard, shows each cron-triggered run natively, including replays on failure.

**Known constraint (Hobby plan, confirmed 2026-08-06 against Vercel's pricing docs)**: Vercel Cron on Hobby has a once-per-day minimum cadence, so confirming candidates 1 and 2 actually fire on schedule needs roughly a 24h wait after deploy, not an instant check. Inngest's own cron does not share that floor, so candidate 3 can likely be confirmed faster.

## Open before this can run

- Needs a throwaway Vercel project (`vercel link` creates one, decided 2026-08-06: not fit-coach's own project).
- Needs an Inngest account (free tier) for candidate 3's signing/event keys. Not created yet.
- Exact shape of `start()`'s return value (`workflow/api`) and whether `next.config.ts` needs anything beyond the default has not been verified live, only read from docs; first deploy will surface any gap.

## What was measured, 2026-08-06

Deployed to a throwaway Vercel project (`matias-projects-0e6c3e25/p3-background-jobs`, Hobby plan), `vercel link --yes` + `vercel --prod --yes`. Both `vercel.json` crons registered without error alongside the account's two other existing crons (`hangout-next`, `portfolio`), confirming the limit is 100 jobs per project (Vercel docs, `last_updated: 2026-07-15`), not account-wide.

**No 24h wait needed**: `vercel crons run <path>` (CLI, beta) triggers a registered cron immediately without changing its schedule. Both candidates fired and were confirmed in `vercel logs --expand`:

```
14:13:02.07  GET /api/cron-direct              200   [cron-direct] fired at 2026-08-06T07:13:02.263Z
14:13:10.34  GET /api/cron-workflow-trigger     200
14:13:11.90  POST /.well-known/workflow/v1/flow 200   [workflow-step] ran at 2026-08-06T07:13:13.478Z, trigger=vercel-cron
```

Candidate 2's Cron hit only started the workflow (fast 200); the actual step execution happened a beat later through the SDK's own internal route (`/.well-known/workflow/v1/flow`), exactly as the docs describe (workflow suspends and resumes through that route). No extra config was needed beyond `withWorkflow()` wrapping `next.config.ts`, confirmed against the current Next.js setup guide (this app has no `proxy.ts`, so the middleware-matcher exclusion the guide warns about did not apply).

Unauthenticated requests to both routes correctly returned 401 (`CRON_SECRET` check), confirming Vercel's automatic bearer-token injection is the only thing that can call them in production.

**Candidate 3 (Inngest) deliberately not run.** Decided 2026-08-06: candidates 1 and 2 already cover what P3 needs (weekly-cadence, low-volume scheduling) without leaving Vercel, and Inngest's only edge over them, sub-daily precision or event triggers, is not a P3 requirement. Signing up for a third account to re-confirm a result already covered was judged not worth it.

## Round 2 (2026-09-08 11:10 ICT): durability for a long single run, Workflow DevKit for fit-coach's md import

**Question:** does Workflow DevKit give fit-coach's `/api/import/extract` durability worth its cost over the inline streaming route it uses today? Round 1's Cron verdict for the daily maintenance job stands untouched. Spec: [[01-Projects/15-fit-coach/spec-workflow-lab-2026-09-07]].

**Versions used:** `workflow` 5.0.0-beta.47 (see below, not beta.48), `ai` 7.0.93, `@ai-sdk/groq` 4.0.37, `zod` 4.5.4, `next` 16.3.0, Node 22.22.2. Model: Groq `openai/gpt-oss-120b` (the model that passed structured JSON in `p0-provider-layer` round 1), `EXTRACT_PROVIDER=groq`.

**The round-1 throwaway Vercel project no longer existed.** `vercel project ls` did not list `p3-background-jobs` under `matias-projects-0e6c3e25` (deleted at some point between round 1 and now, cause unknown). Recreated it with `vercel link --yes`, same project name, new project id in `.vercel/project.json`.

**`workflow@beta` is currently a broken publish.** `npm view workflow dist-tags` resolves `beta` to `5.0.0-beta.48`, but `@workflow/nest@5.0.0-beta.48` (a hard dependency of the `workflow` meta-package) was never published to npm (`npm view @workflow/nest versions` tops out at beta.47, `beta.45` also missing), so `npm install` fails `ETARGET`. Installed `5.0.0-beta.47` instead, the latest internally-consistent release.

### Two NOT CONFIRMED items, pinned from installed types (no live run needed)

- `Run.status` enum (`@workflow/world/dist/runs.d.ts`, `WorkflowRunStatusSchema`): `pending | running | completed | failed | cancelled`. `Run` also exposes `createdAt`, `startedAt`, `completedAt` as `Promise<Date | undefined>` getters.
- `getStepMetadata()` **does** expose an attempt counter: `StepMetadata.attempt: number`, "increases with each retry" (`@workflow/core/dist/step/get-step-metadata.d.ts`). No module-level `Map` fallback needed; `extractChunk.ts` reads `getStepMetadata().attempt` directly to decide whether the injected retryable fault should fire.

### Two spec assumptions corrected by the SDK

- **`getWritable()` cannot be called directly inside a `'use workflow'` function**, only inside a step: this spec's fact list paraphrased the docs as "inside a workflow or step," but the installed package's own docstring says "intended to be used within step functions." A paraphrase error in the spec, not an SDK bug. Real error hit: `This API is not available inside a workflow function. Workflow functions run in a deterministic VM; move the call to a step function for full Node.js access.` Fixed by wrapping every stream write in its own `'use step'` function (`writeStreamEventStep`) instead of holding a writer across the workflow body.
- **`ai@7`'s `generateObject` rejects a `role: "system"` message inside `messages[]`**: `Invalid prompt: System messages are not allowed in the prompt or messages fields. Use the instructions option instead.` This is a documented API rule of `ai@7`, not a bug: the spec's code sketch assumed the older messages-array shape. Fixed by passing the system prompt via the separate `system` option instead of a `messages[0]` entry.

### Runner table (final clean pass per scenario, Groq real TPM limit, 8000 tokens/min on `gpt-oss-120b`, forced 40-60s spacing between live-model scenarios, noted per row where it fired first)

| scenario | status | meals | wall ms | reconnect ok | note |
|---|---|---|---|---|---|
| direct-happy | completed | 17 | 10966 | - | baseline, 1 invocation |
| workflow-happy | completed | 17 | 14729 | - | 2 invocations in the clean case (see Overhead) |
| direct-disconnect | aborted-client-side | 0 | 3005 | - | matches fit-coach's current behavior, nothing recoverable |
| workflow-disconnect | completed | 17 | 17550 | - | run kept executing after the stream client aborted at 3000ms |
| workflow-retryable | completed | 17 | 24757 | - | chunk 1 attempt=1, chunk 2 attempt=1 then attempt=2, chunk 3 attempt=1 (confirmed in `vercel logs`); real Groq 429 hit first attempt, rerun after 60s wait |
| workflow-schema | completed | 12 | 13162 | - | warning `Part 2 could not be parsed and was skipped.` present; real Groq 429 hit first attempt, rerun after 40s wait |
| workflow-reconnect | completed | 17 | 12900 | **true** | `stream?startIndex=0` after completion returned exactly 3 progress + 1 done |
| workflow-cancel | cancelled | 0 | 3650 | - | `cancel()` called at 2000ms; `Run.status` confirms the run reached a terminal `cancelled` state; whether chunk 3's in-flight execution actually stopped was not read from logs (they scrolled out of the CLI's window), not measured |
| workflow-sleep | completed | - | 364170 | - | two `[sleep-workflow]` log lines, real gap confirmed twice: `2026-09-08T03:37:50.921Z` to `03:43:52.511Z` and `03:46:34.898Z` to `03:52:36.394Z`, both about 6m1-2s, driven by a single `POST /.well-known/workflow/v1/flow` resumption each time |
| workflow-large | completed | 0 (dryRun) | 41828 | - | `start()` accepted a 299,259-byte payload (`log.md`, 7299 bytes, repeated 41x); produced **123 chunks**, not "about 75", see below |
| proxy-fitcoach-matcher | **failed** | 0 | 905-10352 | - | see Proxy matcher below |
| proxy-docs-matcher | completed | 23 | 12903 | - | see Proxy matcher below |

The `meals` column counts `extraction.meals.length` from the merged result, not chunk count: this fixture has 3 chunks regardless of scenario, chunk counts are read from the `[extract-step]` log lines (see the retryable row and Question 8). Warnings/notes text itself (not just counts) verified by hand for `direct-happy`, `workflow-happy` and `workflow-schema`: real per-chunk model output, not placeholders.

### Question 7, payload size: the "about 75 chunks" estimate was wrong, not the mechanism

The spec guessed a fixture of "about 12 KB" would `repeat()` into "about 75" chunks at 300 KB. The actual fixture (`fixtures/log.md`, built to have exactly 3 `chunkMarkdown` sections) is 7299 bytes with 3 level-1 headers. `repeat(41)` gives 299,259 bytes but **123 section boundaries** (41 x 3 headers), and `chunkMarkdown`'s greedy merge produced 123 chunks, not about 75: the estimate assumed a byte-count-only heuristic (`300000/4000`, about 75) that ignores where the markdown headers actually fall. The functional claim question 7 cares about, **`start()` accepts a payload this size and the run completes**, is confirmed; the chunk-count prediction was refuted by measurement.

### Question 8, overhead: workflow does not fragment into one invocation per step in the happy path

Direct route: **1 invocation** (`POST /api/extract/direct`), handles all 3 chunks inline, confirmed in `vercel logs` (`[extract-direct] chunk=1/2/3` inside one log block).

Workflow route, no fault: **2 invocations**: `POST /api/extract/start` (dispatch) plus a single `POST /.well-known/workflow/v1/flow` that ran all 3 `extractChunkStep` calls (attempt=1 each) back to back without suspending, confirmed in `vercel logs` for run `wrun_41M1ZK8GWR0GXKK4H467NB1JRX`. The runtime only opens a **new** invocation when a step actually has to wait on something external to the process (a `RetryableError`'s `retryAfter` delay, `sleep()`): the `workflow-retryable` run split into 2 separate `POST /.well-known/workflow/v1/flow` invocation blocks, one before and one after the 10s `retryAfter` delay. So the real overhead of Workflow DevKit over the inline route, for a 3-chunk happy-path run, is **one extra invocation and one extra network hop** (start to internal flow route), not a per-step multiplication: cheaper than the round-1 lab's mental model assumed.

### Question 9, proxy matcher: fit-coach's real matcher breaks the SDK's internal route, confirmed with a real failure

Deployed with fit-coach's exact `proxy.ts` matcher copied verbatim (`"/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"`). `workflow-happy` under this matcher: `POST /api/extract/start` returns 200 (excluded, matches `api`), but the internal `POST /.well-known/workflow/v1/flow` is NOT excluded (it does not start with `api`), so the lab's own proxy (redirect-to-`/` when no `LAB_COOKIE`, mirroring fit-coach's redirect-to-`/login` when no session) intercepted it. Result: `vercel logs` showed 6x `GET /` in place of the expected internal POST, then `[workflow-sdk] Error while running workflow WorkflowRuntimeError ... code RUNTIME_ERROR`, run status **`failed`**. This is not hypothetical, it is the exact failure a real deploy of fit-coach's current matcher would hit.

Fix tested: fit-coach's matcher with `.well-known/workflow/` added to the negative lookahead (kept `api` excluded too: the docs' own bare example, `"/((?!_next/static|_next/image|favicon.ico|.well-known/workflow/).*)"`, does NOT exclude `api` and would have broken the lab's own `/api/extract/*` routes, an unrelated regression not worth conflating with this question). Redeployed, `proxy-docs-matcher` (`workflow-happy` rerun) **completed** cleanly, 23 chunks. fit-coach's `src/proxy.ts` needs `.well-known/workflow/` added to its existing negative lookahead before Workflow DevKit could ever be adopted there, full stop.

### What did not match the spec

- `workflow@beta` resolves to a broken release (`beta.48`); used `beta.47`.
- `getWritable()` is step-only, not "workflow or step" as the spec's fact-check summarized; fixed by adding a dedicated write step.
- `ai@7`'s `generateObject` rejects an inline `system` role message; fixed by using the `system` option.
- The 300 KB payload produced 123 chunks, not "about 75" (estimate error in the spec's fixture-size math, not a product bug).
- Groq's real free-tier TPM limit (8000 tokens/min on `gpt-oss-120b`) was hit repeatedly running scenarios back-to-back; the step's own `RetryableError` retry does not help against a real, persistent-for-the-minute 429 (it is not a transient fault the 3 retries can outlast), unpaced scenarios failed and needed re-running 40-60s apart. Worth pacing (`PAUSE_MS`-style) if this lab is extended again. Landing-time note: a per-minute provider 429 needs a `RetryableError` `retryAfter` of at least 60s, or reading the provider's own `retry-after` header, since 3 retries spaced 10s apart cannot outlast a 60s rate-limit window.
- The round-1 throwaway Vercel project no longer existed and was recreated (see above).

### Verdict, round 2

**Workflow DevKit answers all 9 questions the way the spec expected, at a real but bounded cost: durability, chunk-level retry/skip semantics identical to today, and stream reconnect all work; cancel flips `Run.status` to `cancelled`, whether in-flight execution actually stops was not measured; the overhead over the inline route is one extra invocation in the happy path, not per-step fragmentation; and adopting it requires one one-line fix to fit-coach's `proxy.ts` matcher first (add `.well-known/workflow/` to the exclusion) or every run silently fails in production.** Round-1's plain-Cron verdict for the daily maintenance job is untouched.

**Corrections 2026-09-08 11:21 ICT (Fable review):** renamed the runner table's `chunks` column to `meals` (it was `extraction.meals.length`, not a chunk count) and added a sentence pointing chunk counts to the `[extract-step]` logs; reworded the `workflow-cancel` row and the verdict sentence to say only that `Run.status` reached `cancelled`, not that in-flight execution was confirmed stopped; renamed "Two real SDK bugs" to "Two spec assumptions corrected by the SDK" (a paraphrase error and a documented `ai@7` API rule, neither is a bug); added the round-1 Vercel project recreation and a landing-time note on `retryAfter` needing to be at least 60s against a per-minute rate limit. No measured numbers changed.

## Verdict

**Plain Vercel Cron (candidate 1). Final.** Both candidates 1 and 2 deployed and fired on the first try, on the Hobby plan, with `vercel crons run` closing the "would need to wait 24h" gap this README originally flagged. Candidate 2 (Workflow DevKit) adds the `workflow` + `@workflow/next` packages, a `next.config.ts` wrapper, and an extra internal round-trip per run, in exchange for step-level auto-retry and durability across deploys, neither of which this maintenance job's single-step, sub-second logic needs. Ship fit-coach's P3 (stale-fact cleanup, memory re-grounding, weekly summary) as a plain `vercel.json` cron hitting a route handler, same pattern already used in `hangout-next` and `portfolio`. Workflow DevKit is the documented upgrade path if a maintenance job ever needs multi-step retry or to span longer than one function invocation; revisit only if that need appears. Inngest untested by decision, not by failure, see above.

**Verdict, round 2 (2026-09-08 11:10 ICT):** unrelated to this candidate, does not reopen it. See "Round 2" above: Workflow DevKit is worth adopting for `/api/import/extract` specifically, not for this daily cron.
