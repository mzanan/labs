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
