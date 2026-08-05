# p2-memory-supersession

**Question:** can `coach_facts`'s known gap (a correction never flags an earlier belief as outdated, the "quinoa" bug) be fixed by the two mechanisms the 2026-08-05 research pass recommended, additive `active`/`superseded_by` columns plus deterministic newest-wins, on the exact same libSQL vector setup and calibrated thresholds fit-coach already runs (retrieval 0.45, dedup 0.06)?

**Date:** 2026-08-05.

## How to run

```
cp .env.example .env   # set AI_EMBEDDING_API_KEY (a Gemini key, same one fit-coach uses)
npm install
node --env-file=.env node_modules/.bin/tsx src/run.ts
```

`scenarios.json` holds the fact pairs and the timeline, both configuration, not code. `src/embeddings.ts` reproduces fit-coach's exact `embed`/`normalize`/`toVectorLiteral` pipeline (`gemini-embedding-001`, 768d, L2-normalized). `src/memory.ts` has two save/retrieve pairs: `*Baseline` reproduces today's `src/lib/ai/facts.ts` unchanged (dedup 0.06 only, no supersession, no active filter), `*V2` adds the recommended columns and both mechanisms.

**Part 1** measures raw cosine distance for 5 real sentence pairs: 3 where the second sentence should supersede the first (same slot, changed answer) and 2 where it should not (distinct facts). **Part 2** replays a 5-event timeline (the quinoa case plus a same-slot conflict with no explicit correction label) through both `Baseline` and `V2`, then retrieves with a query that touches both topics.

## What was measured, 2026-08-05

**Part 1, raw distances (Gemini `gemini-embedding-001`):**

| Pair | Expected | Distance |
|---|---|---|
| quinoa-correction | supersede | **0.1556** |
| training-time-correction | supersede | **0.2056** |
| training-time-same-slot-no-correction-label | supersede | **0.1152** |
| morning-training-vs-morning-breakfast | distinct | **0.1754** |
| quinoa-vs-shellfish-allergy | distinct | 0.3274 |

Supersede-pair distances range 0.1152 to 0.2056. Distinct-pair distances range 0.1754 to 0.3274. **0.1754 (a genuinely distinct pair) sits inside the supersede range (0.1152 to 0.2056).** No single threshold value separates the two classes on this sample.

**Part 2, timeline replay** (quinoa preference at t0, shellfish allergy at t1, quinoa correction at t2, morning-training preference at t3, evening-training preference at t4, no correction label on t4):

| Retrieval mode | Facts returned | Stale quinoa survives | Both training times survive | Shellfish fact survives |
|---|---|---|---|---|
| Baseline (today's code) | 5 | **true** | **true** | true |
| V2, same-slot = 0.45 (retrieval-level) | 1 | false | false | **false, wrongly dropped** |
| V2, same-slot = 0.06 (dedup-level) | 4 | false | **true, bug not fixed** | true |

## Verdict

**Mechanism 1 (`active`/`superseded_by`, triggered by an explicit `category: correction` fact) works and is safe to build.** In the timeline it correctly identified the nearest active fact at 0.1556 (well inside the existing 0.45 retrieval band, the only candidate at that point) and suppressed it. It never had to guess a distinct-vs-same-slot boundary because the *trigger* is the app's own categorization (already produced by the existing fact-extraction step), not a similarity threshold. The risk this mechanism still carries, not fully exercised here: if two unrelated facts both sit within 0.45 of a correction's embedding, "nearest neighbor" could attach the correction to the wrong one. Worth a follow-up round with more concurrent candidates before shipping.

**Mechanism 2 as originally proposed (similarity-based same-slot clustering with a single global threshold, no correction label required) does NOT hold up.** There is no `sameSlotDistance` that works: 0.45 catches the real conflict but also wrongly drops an unrelated active fact (shellfish allergy) and the correction record itself out of a `Promise.all`-free, sequential clustering pass; 0.06 protects the unrelated facts but misses the real conflict (0.1152 > 0.06). The measured overlap in Part 1 (a distinct pair at 0.1754 sitting inside the supersede range up to 0.2056) means this is not a tuning problem, it is a hard limit of the signal: **cosine distance on this embedding model does not reliably encode "same slot, contradicted" versus "different slot, coincidentally similar wording".** This independently confirms, with real numbers instead of literature, why arXiv 2606.01435 ("Don't Ask the LLM to Track Freshness") insists the freshness decision must be deterministic and NOT based on similarity at all.

**Practical consequence for `coach_facts`:** ship mechanism 1 (correction-triggers-supersession via nearest active neighbor) as designed. Do not ship mechanism 2 as a similarity-threshold clustering pass. If the same-slot conflict at t3/t4 (no explicit correction label, same attribute, different phrasing) needs solving, the next lab question is a **structured key** (e.g. the fact-extraction prompt tags each fact with a deterministic `(subject, attribute)` slot, "training_time", "food_preference:quinoa"), so newest-wins resolves by matching that key, not by embedding distance. That is a different, narrower question than this lab answered and belongs in its own round if picked up.

**Caveat on sample size:** 5 pairs and one timeline is enough to disprove "a single threshold separates the classes", it is not enough to establish the real-world false-positive/false-negative rate of mechanism 1's nearest-neighbor attachment. Treat the "mechanism 1 works" verdict as provisional until it is exercised against a fact table with more concurrent candidates.
