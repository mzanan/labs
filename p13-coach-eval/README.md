# p13-coach-eval

## Question

Which model should run fit-coach's in-app coach, and are its failures the model's or the architecture's? Measured on fit-coach's own coach code, against 35 scenarios of real use, not on public benchmarks.

## Date

2026-10-14. fit-coach at `a2ef3d8` plus 8 xpl model ids added locally to `EXPLABS_CAPABILITIES` in `src/lib/ai/capabilities.ts` (without them the app reports no tool support for those models).

## How it runs

This lab is the one exception to "self-contained": it drives fit-coach's real coach (`@/lib/ai/coach`, schema, dev database), so it runs against a fit-coach checkout instead of a copy.

- `FIT_COACH_DIR` points at the fit-coach checkout (default `../../fit-coach`). Its `.env.local` supplies the dev database and system keys.
- `npm run link` symlinks fit-coach's `node_modules` here, so the lab and the coach share one copy of every package.
- `EXPLABS_API_KEY` in the shell, then `npm run eval -- --models <ids> --reps <n> --scenarios <ids> --budget <usd>`. `--resume <runId>` skips finished runs, `--report <runId>` rebuilds a report.
- Each run seeds synthetic users in the dev database and sweeps them at the end. Raw runs land in `results/raw/` (gitignored); dated reports are copied to `results/<date>/`.

## What was measured

35 scenarios in 7 jobs: J1 catalog meal, J2 off-catalog meal, J3 corrections, J4 other logs, J5 reads, J6 memory, J9 negatives. Pass means every grader passed on every turn (database state, tool calls, reply language, false claims). 11 models via xpl, 1 screening rep each, 3 reps for the top 6. Cost and latency per message.

Reports: `results/2026-10-14/20261014T050225.md` (final, all reps) and `results/2026-10-14/screen-rep1.md` (screening).

## Verdict

**gemini-3.7-flash, provisionally: 84% rep-1 pass, but no model is near the 95% bar and the gap is architectural.**

- Rep-1 pass: gemini-3.7-flash 84%, glm-5.3-flash 81%, gemini-3.5-flash-lite, gemini-3.8-flash and claude-haiku-5.5 78%, deepseek-v4.1-flash 76%, deepseek-v4-flash (prod at the time) 62%.
- pass^3 on writes tops out at 69% (gemini-3.7-flash).
- **J3 corrections is 0% on every model.** The coach has no edit or delete tools and the history drops receipt-only turns, so the model re-inserts instead of correcting. A model swap buys about 20 points at most; the fix is the coach architecture.
- Cost per message: gpt-6-luna $0.0005, glm-5.3-flash $0.0024, deepseek-v4.1-flash $0.0027, claude-haiku-5.5 $0.0042, gemini-3.7-flash $0.016. p50 latency 11-24 s (mimo 51 s, qwen 34 s).

Re-run this lab after any coach architecture change before re-picking the model.

## 2026-11-08: live eval against the running app

### Question

Do the model swap and the new correction tools make the coach right on Matias's own phrases, judged by the meals rows the real app writes?

### How it runs

`src/live/` talks to the running coach instead of importing it: it POSTs each phrase to `/api/coach` on a local fit-coach dev server with a signed dev session for `EVAL_USER_ID`, approves any card, diffs the `meals` rows of today and yesterday, then reverts seeds and every change.

- `.env` (gitignored): `DEV_DATABASE_URL`, `BETTER_AUTH_SECRET` (both from fit-coach `.env.local`), `EVAL_USER_ID`, `EVAL_BASE_URL`. `PROD_DATABASE_URL` only for the sync step.
- `npm run live:sync-dev` copies that user's own prod rows into dev: prod is read in a read-only transaction, only that user's dev rows are replaced, and it refuses when both URLs share a host.
- fit-coach `npm run dev` on port 3040, then `node --env-file=.env node_modules/.bin/tsx src/live/run.ts [--model <xpl id>] [--only M1,C2]`. `--model` switches the user's Experiential Labs model in dev first. Raw output lands in `results/raw/live/`; dated copies in `results/2026-11-08/`.
- Phrases and seeds: `live-cases.json`. M cases are meal logging taken from his own days; C and G cases are corrections, deletions and non-writes.

### What was measured

Model comparison on the meal phrases M1-M8, fit-coach `33634fc`, one run each, correct writes out of 7 (M7 excluded as an invalid case):

| Model (xpl) | Correct | Notes |
|---|---|---|
| claude-haiku-5.5 | 7/7 | fastest (~18 s per message), ~0.004 USD per message |
| deepseek-v4.1-flash-1017 | 7/7 | ~32 s per message |
| glm-5.3-flash | 6/7 | one provider error |
| deepseek-v4.1-flash | 5/7 | |
| gemini-3.8-flash | 5/7 | dropped the sauce, asked the milk type |
| claude-sonnet-5.5 | best judgment | caught a breakfast already logged that day, ~18x the cost |
| deepseek-v4-flash (prod until this day) | 2/7 | asked instead of logging, said "guardado" with no write |

Corrections after fit-coach PR #128 (`update_meal`, `delete_meal`), claude-haiku-5.5: deleting yesterday's tequila, 2 beers instead of 3, the guacamole dinner, the chicken burger lunch, deleting the cheeseburger, and a calories question that must change nothing were right over 3 reps; with two identical bananas it asks which. Before the gate policy mentioned corrections, Jev denied every delete.

Still seen failing: receipts in English, unrequested reminders in most replies, a duplicate breakfast logged without a warning, "200 g de pollo a la plancha" sometimes asks the meal instead of logging, one run claimed a sauce was logged with no row written.

### Verdict

**The coach moves to claude-haiku-5.5.** On these phrases most failures of the old setup were the model, not the code; J3 corrections, 0% in October, now work in the app. The 35-scenario harness above has not been re-run since the correction tools shipped: re-run it before the next model or architecture decision.
