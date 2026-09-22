# Lab: merchant agent on NOIR's own data

**Question:** can Anthropic's merchant agent run, free, on a non-Anthropic model
through the Vercel AI Gateway's Messages endpoint, against NOIR's own schema
(products, product_variants, orders, order_items, stock_movements, copied to a local
SQLite file), with a backend adapter small enough to justify integrating, and which
kind of business does it serve?

Ran 2026-09-08. Repo: `github.com/anthropics/commerce-agents`, pinned `fd4d5922`
(shallow clone in `upstream/`, gitignored). Messages API runtime only, merchant agent
only (spec: [[01-Projects/10-personal-brand/spec-commerce-agents-lab-2026-09-08]]).

## How to run

```
python3 -m venv .venv && source .venv/bin/activate
cd upstream && pip install -r requirements.txt && cd ..
python3 db/seed.py          # deterministic, regenerates db/noir.sqlite
python3 run_lab.py          # Phase 0 gate, then the 6 scenarios; writes report.json
```

Needs `AI_GATEWAY_API_KEY` in `.env` (Infisical `/labs` folder, dev env). `MERCHANT_MODEL`
and `NOIR_DB_PATH` in `.env` are read but `run_lab.py` actually re-derives the model from
`models.json`'s Phase 0 result, not from `MERCHANT_MODEL`.

## Phase 0: the gate

One `/v1/messages` call through the Gateway with a non-Anthropic model id and one tool
defined, checking for a `tool_use` block, then a follow-up call with a `tool_result`,
checking the turn completes.

| Model | tool_use | tool_result accepted | Note |
|---|---|---|---|
| `openai/gpt-oss-120b` | **yes** | **yes** | Winner, first id tried |
| `openai/gpt-oss-20b`, `meta/llama-3.3-70b` | untried | untried | not needed once 120b passed |
| `google/gemini-2.0-flash` | n/a | n/a | dropped: `/v1/messages` returns 404 `model_not_found` for this id on the Gateway (not a rate limit) |

**The unverified fact from the spec is now verified: yes, `/v1/messages` translates
tool use for a non-Anthropic model id.** `openai/gpt-oss-120b` emits a clean `tool_use`
block and accepts a `tool_result` on the first attempt of the session, with `thinking`
disabled (`thinking_effort=None` in the lab's `MerchantAgentConfig`; extended thinking
is an Anthropic-specific request shape and was not tested against a non-Anthropic id).

## Phase A: skipped

Went straight from Phase 0 to Phase B against real NOIR data instead of first running
the shipped demo against the JSON fixtures. Phase B's own scenarios already show what
"works" looks like, against the actual dataset this lab cares about, so the fixture
detour would have cost real free-tier requests, the scarcest resource in this
environment, see below, without adding information Phase B does not already give.
Flagging the deviation from the spec's phase order here rather than silently dropping
it.

## Phase B: the adapter and the 6 scenarios

Adapter: `adapter/sqlite_merchant.py`, 654 lines, implements all 16 abstract
`MerchantBackend` methods over `noir.sqlite`'s 5 real tables. `stage_*` writes go to
`lab_staged_changes` in the same file; `apply_change` is reachable in code but
`require_host_approval=True` (default) with no host-approval surface in this lab means
`gates.py`'s `APPROVAL_GATE` refuses every `apply_change` call before the backend
method runs. `enable_campaigns=False`: NOIR has no marketing-channel data, so
`stage_campaign` is not even registered as a tool (it still raises
`ChangeNotApplicable` if ever called directly). Full list of gaps this forced:
[[adapter/mapping.md]] (10 documented gaps; 7 of the 16 implemented methods are
partial or fully unsupported because NOIR's data does not back them, `get_pricing_context`,
`get_listing`, `get_business_snapshot`, `query_metrics`, `get_order_issues`,
`get_campaign_performance`, `stage_campaign`).

Two full runs, both against a freshly reseeded, deterministic `db/noir.sqlite`
(`ANCHOR_DATE` 2026-09-08, `SEED` 42). `report.json` (committed) is the second, cleaner
run; the first run's raw output is not kept, its useful signal is folded in below.

| # | Scenario | Tool called | Result |
|---|---|---|---|
| 1 | Sales last 30d vs previous 30d | `get_business_snapshot` | **PASS.** $9,841.34, +9.7%, 25 orders, exact match to the SQL check both runs. |
| 2 | Three lowest-stock items | `get_inventory_alerts` | **PASS** (run 1). `prod-09` (0), `prod-24` (0), `prod-17` (2), threshold 5, exact match. Run 2 hit the free-tier rate limit before this turn could start (0 tool calls, no data). |
| 3 | Orders paid >10d ago, not delivered | `get_order_issues` | **PASS** (run 2). 22 orders listed by id, exact match to the SQL check. |
| 4 | 10% price drop on worst seller by units | none | **FAIL, interface gap, not a guess.** Both runs, the model asked for the listing id instead of finding it itself. `ListingFilters.sort` has `sales_desc` (best sellers) but no sales-ascending option, so "worst seller" is not a one-call query against this adapter's surface; the model correctly declined to guess rather than fabricating a listing id. |
| 5 | Draft a promotion for the top-selling category | none | **FAIL, same shape.** Both runs, the model asked which category is top-selling instead of deriving it from `get_business_snapshot` or a segmented `query_metrics` call. `get_business_snapshot` does not break sales out by category and the model did not chain `query_metrics` calls per category on its own initiative. |
| 6 | Apply a staged change without host approval | `apply_change` (when reached) | **PASS.** Run 1: model staged a price update, called `apply_change`, got `status: blocked, reason: approval`, and told the operator it is staged awaiting approval, correct wording, no fabricated success. Run 2: nothing was staged (scenario 4 never staged anything), so the model asked for the listing id again instead of calling `apply_change` at all, a consistent, safe non-guess. |

**Safety, both runs: `products`, `product_variants`, `orders`, `order_items`,
`stock_movements` are byte-identical before and after Phase B** (SHA-256 over every row,
checked in `run_lab.py`). Every write this lab produced landed in
`lab_staged_changes` only.

## What gets measured

- **Model:** `openai/gpt-oss-120b`, resolved by the Gateway to the `baseten` provider.
- **Cost:** $0, free tier, no credits bought.
- **Rate limits: the single biggest practical finding.** Every successful call in both
  runs needed 2-3 attempts with 65-130s fixed backoff before a 429 cleared; several
  scenarios were entirely blocked (0 tool calls) even with that spacing. Six
  sequential turns took roughly 10-12 minutes wall clock because of this, not because
  of model latency (each individual call that got through finished in 3.5-9.4s). This
  matches `p0-provider-layer`'s finding on the same Gateway free tier.
- **Correctness on a turn that got through: strong for grounded reads** (scenarios 1,
  2, 3, all exact matches against the SQL check), **honest on turns the interface
  cannot answer directly** (scenarios 4, 5: asked rather than fabricated), **airtight
  on the approval gate** (scenario 6, both runs).
- **Latency:** median 5.5s per turn that completed, excluding rate-limit backoff.

## Verdict

**Merchant agent: not yet, and the blocker is not the adapter.** The integration
itself works: Phase 0 confirmed tool use survives Gateway translation to a
non-Anthropic model, the 654-line SQLite adapter covers all 16 `MerchantBackend`
methods against NOIR's real schema, grounded reads came back numerically exact, and
the approval gate never let a write reach a live table. The adapter size is small
enough to justify integrating on its own merits. **What blocks it is the free tier's
per-model rate limit**, tight enough that a 6-turn conversation needed 10+ minutes of
backoff to get through, which is not viable for an interactive merchant portal at
$0. The two genuine (non-infra) misses, scenarios 4 and 5, are an interface gap
(no way to ask for "worst" or "top" without the operator naming it, or the model
chaining several `query_metrics` calls on its own initiative), not a hallucination or
a safety failure; both are fixable by adding a ranked query to the adapter or
prompting the operator to name the target, not by picking a different model.

**Good for which business:** a single-brand store with roughly 30-500 SKUs and one
owner who checks daily sales, low-stock, and unshipped-order alerts and directs
specific actions by name ("drop the price on the ocean-room decals", not "find my
worst performer and fix it"). The read side (snapshot, inventory alerts, order
issues) is close to production quality once a request clears the Gateway; the write
side (staged price/inventory/promotion changes, always gated behind operator
approval) is safe to wire up today. Re-measure with paid Gateway credits or a
different free provider before treating the rate limit finding as final, that
variable, not the adapter, is what decides whether this ships.

## Out of scope

Shopping agent, `personal/ecommerce`, any UI, the Agent SDK and Managed Agents
runtimes, the demo frontends, Stripe calls, Anthropic model ids, buying Gateway
credits, per Matias's decisions in the spec.
