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
  that plant's enclosing function. Everything else is an unmatched finding (a false positive, or a
  real pre-existing issue to triage).

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

## Results, 3 reps per model

| Model | Recall, all 8 | Recall, 7 exploitable | False positives | Found every rep | Never found | Mean time | Timeouts (600 s) |
|---|---|---|---|---|---|---|---|
| `deepseek-v4.1-flash` | 88 percent | 100 percent | 0 | V1-V5, V7, V8 | V6 | 40 s | 0 of 3 |
| `glm-5.3` | 88 percent | 100 percent | 0 | V1-V5, V7, V8 | V6 | 213 s | 1 of 3 |
| `kimi-k3` | 88 percent | 100 percent | 0 | V1-V5, V7, V8 | V6 | 261 s | 2 of 3 |
| `mimo-v2.5-pro` | 75 percent | 86 percent | 0 | V2, V3, V7, V8 | V6 | 80 s | 0 of 3 |
| `gpt-5.6-luna` | 58 percent | 67 percent | 0 | V1-V4 | V6, V7 | 20 s | 0 of 3 |
| `nemotron-3-ultra-550b-a55b` | 46 percent | 52 percent | 0 | V1, V3 | V2, V4, V5, V6 | 19 s | 0 of 3 |

- **No model reported a single false positive** across 15 completed audits, and none reported a
  real issue in the unplanted fit-coach code either.
- **V6 is a weak plant, not a model miss.** The key belongs to the signed-in user and goes back to
  that same user's browser; with no second vulnerability there is no concrete attacker, and the
  prompt asks for exactly that. Every model agreed. The second recall column excludes it.
- **Kimi K3 and GLM 5.3 match DeepSeek but are 5-6x slower and time out**: Kimi's 100 percent rests
  on one completed run, GLM's on two.
- V3's plant leaves `and` imported but unused in `pushSubscriptions.ts`, a hint any linter flags and
  that may have made V3 easier; the fixture is excluded from the labs lint for that reason.
- DeepSeek V4.1 Flash spends most of its output on hidden reasoning: at 8,000 output tokens it
  returned an empty result; 32,000 is the setting used.

## Verdict

**Yes, with DeepSeek V4.1 Flash.** Every exploitable plant found in every run, zero false
positives, 40 s for 11 files, the cheapest paid model of the set. Luna (free) finds the obvious
access-control bugs but misses the XSS and the subtler ones, so it is not a substitute. The result
is a floor for what the models can do: one pass, whole files in the prompt, no tools.

## Not measured

- Cost per audit (the Anthropic-compatible gateway response did not carry it through the AI SDK).
- A larger codebase than fits in one prompt, or an agent that reads files on its own.
- Real, unplanted vulnerabilities: none were reported, so precision on real bugs is unknown.
- Models only on OpenRouter (MiMo V2.6), which had no credit on the run date.
