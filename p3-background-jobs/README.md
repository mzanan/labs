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

## Verdict

**Plain Vercel Cron (candidate 1). Final.** Both candidates 1 and 2 deployed and fired on the first try, on the Hobby plan, with `vercel crons run` closing the "would need to wait 24h" gap this README originally flagged. Candidate 2 (Workflow DevKit) adds the `workflow` + `@workflow/next` packages, a `next.config.ts` wrapper, and an extra internal round-trip per run, in exchange for step-level auto-retry and durability across deploys, neither of which this maintenance job's single-step, sub-second logic needs. Ship fit-coach's P3 (stale-fact cleanup, memory re-grounding, weekly summary) as a plain `vercel.json` cron hitting a route handler, same pattern already used in `hangout-next` and `portfolio`. Workflow DevKit is the documented upgrade path if a maintenance job ever needs multi-step retry or to span longer than one function invocation; revisit only if that need appears. Inngest untested by decision, not by failure, see above.
