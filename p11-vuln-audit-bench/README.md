# Lab: vuln-audit-bench

**Question:** can a cheap model audit real application code for exploitable vulnerabilities well
enough to be useful, and which one, measured by planting known vulnerabilities in a copy of a real
repo and counting what each model finds and what it invents?

**Date:** 2026-09-24 ICT (results file stamped 2026-09-23 UTC). AI SDK `ai` 7.0.112,
`@ai-sdk/anthropic` 4.0.61, all models on the Experiential Labs gateway.

> `fixture/` is intentionally vulnerable code. It is a test input, never deploy or copy it.

## How it works

- `build_fixture.py` copies 11 real files from fit-coach at commit `ebe3235` (route handlers,
  server actions, a data module, a UI component, the session helper) and plants 8 known
  vulnerabilities by exact text replacement. It writes `fixture/manifest.json` with each plant's
  line range and the enclosing function range used for matching. Same commit in, same fixture out.
- `src/runBench.ts` sends all 11 files, line-numbered, in one prompt, and asks for structured
  findings (file, line, category, severity, title, evidence). System prompt: report only
  exploitable vulnerabilities with a concrete attacker, input and impact.
- `src/grade.ts` counts a finding as a hit when its file matches a plant and its line falls inside
  that plant's match ranges (the vulnerable function, plus the import line for V7). A second
  finding on an already-hit plant is a duplicate. Anything else is unmatched: a false positive, or
  a real pre-existing issue to triage by hand.
- `src/regrade.ts` re-grades stored findings against the current manifest without calling any
  model.

| Plant | Category | Where | What |
|---|---|---|---|
| V1 | authentication | cron route | open to anyone when `CRON_SECRET` is unset |
| V2 | csrf | Whoop OAuth callback | state check skipped when the state cookie is missing |
| V3 | authorization | push subscriptions | delete by endpoint ignores the user |
| V4 | authorization | `repeatMeal` action | reads another user's meal by id |
| V5 | mass-assignment | profile settings action | `.passthrough()` spread into the update |
| V6 | secret-exposure | AI settings action | returns the user's decrypted API key to the browser |
| V7 | xss | Markdown component | `rehype-raw` renders model output as HTML |
| V8 | open-redirect | Whoop connect route | `next` query param used as redirect target |

```bash
npm install
python3 build_fixture.py
EXPLABS_API_KEY=... REPS=3 npm run bench
```

## Results, 3 reps per model (regraded 2026-09-24)

`results/bench-2026-09-23.json` holds the raw runs, `results/bench-2026-09-23.regraded.json` the
grades below. The first grading used match ranges that ran into the next function and dropped
same-region findings silently; a Fable review caught it, and the regrade fixed both.

| Model | Recall, 8 plants | Plants found (completed runs) | Unmatched findings | Mean time, completed runs | Timeouts (600 s) |
|---|---|---|---|---|---|
| `deepseek-v4.1-flash` | 88 percent | V1-V5, V7, V8 in 3 of 3 | 0 | 40 s | 0 of 3 |
| `glm-5.3` | 88 percent | V1-V5, V7, V8 in 2 of 2 | 0 | 213 s | 1 of 3 |
| `kimi-k3` | 88 percent | V1-V5, V7, V8 in 1 of 1 | 0 | 261 s | 2 of 3 |
| `mimo-v2.5-pro` | 71 percent | V2, V3, V8 every run, others 2 of 3 | 1 | 80 s | 0 of 3 |
| `gpt-5.6-luna` | 58 percent | V1-V4 every run, V5 and V8 once, never V7 | 0 | 20 s | 0 of 3 |
| `nemotron-3-ultra-550b-a55b` | 46 percent | V1, V3 every run, V6 and V7 2 of 3, V8 once | 1 | 19 s | 0 of 3 |

- **Both unmatched findings are false positives.** Nemotron flagged `deleteSubscriptionByEndpoint`,
  which is only called with endpoints from the user's own subscription list. MiMo flagged a
  `javascript:` link, which react-markdown's default URL transform strips even with rehype-raw.
- **Nobody found anything real in the unplanted fit-coach code.** With 0 or 1 false positive per
  model across 15 completed audits, precision on real bugs is still unknown.
- **V6 was found only by Nemotron** (2 of 3), which chained it to the XSS. The system prompt asks
  for a concrete attacker, which may push models to omit a plant that needs a second bug.
- **Kimi K3 and GLM 5.3 match DeepSeek on recall but rest on 1 and 2 completed runs.** The 3 reps
  run concurrently, so their timeouts may be gateway queueing as much as model speed.
- V3's plant leaves `and` imported but unused in `pushSubscriptions.ts`, a hint any linter flags and
  that may have made V3 easier; the fixture is excluded from the labs lint for that reason.
- DeepSeek V4.1 Flash spends most of its output on hidden reasoning: at 8,000 output tokens it
  returned an empty result; 32,000 is the setting used.

### How exploitable each plant is

- **V2, V5**: direct. A forged OAuth callback, a crafted settings payload (it can overwrite other
  profile columns; not the primary key, which the update cannot change).
- **V1, V8**: only while an env var is missing (`CRON_SECRET`, the Whoop credentials).
- **V3, V4**: need the victim's identifier (a push endpoint, a random meal id).
- **V7**: needs attacker-controlled text in a coach reply, for example prompt injection.
- **V6**: needs a second bug to reach another user's browser; V7 supplies one in this fixture.

## Verdict

**Yes, with DeepSeek V4.1 Flash.** Seven of eight plants in every run, zero false positives, 40 s
for 11 files, and the lowest list price per token of the six on OpenRouter. GLM 5.3 and Kimi K3 may
match it but did not finish reliably. Luna (free) finds the plain access-control bugs and misses the
XSS. This is a floor: one pass, whole files in the prompt, no tools.

## Not measured

- Cost per audit (the Anthropic-compatible gateway response did not carry it through the AI SDK).
- A larger codebase than fits in one prompt, or an agent that reads files on its own.
- Real, unplanted vulnerabilities: none were found, so precision on real bugs is unknown.
- A sequential rerun to separate model speed from gateway queueing.
- Models only on OpenRouter (MiMo V2.6), which had no credit on the run date.
