# NOIR to MerchantBackend mapping

Source: `personal/ecommerce/supabase/migrations/001_initial_schema.sql` and
`005_stock_management.sql`, translated to SQLite in `db/schema.sql`. This file
records every place the adapter (`sqlite_merchant.py`) had to make a call because
NOIR's data does not fully back the `MerchantBackend` interface.

## Table mapping

| NOIR table | MerchantBackend surface |
|---|---|
| `products` | `Listing` / `ListingDetails` (plain, no options) |
| `product_variants` | `Listing.attributes["sizes"]`, display only, see gap 1 |
| `orders` + `order_items` | `BusinessSnapshot`, `query_metrics`, `OrderIssue` |
| `stock_movements` | not read directly; `products.stock_quantity` already holds the current level, movements exist for audit only and are unused by this adapter |
| (none) | `lab_staged_changes`, the only table `stage_*` writes to |

## Gaps

1. **Variants have no independent price or stock.** `product_variants` is only
   `id, product_id, size_name`; stock and price live on `products`. A product is
   modeled as a plain `Listing` (`has_options` false), sizes are shown in
   `attributes["sizes"]` for context only. A "low-stock variant" in the spec's
   scenario 2 maps to its product's single `stock_quantity`.
2. **No unit cost / COGS field anywhere in NOIR.** `PricingContext.unit_cost`,
   `.margin_pct`, `.min_price`, `.max_price` are always `None`. `StagedChange`'s
   margin fields are always `None` too. The guardrail's cost-based checks never
   fire, only the percent-delta ones do.
3. **No price-history table.** `PricingContext.last_changed` is always `None`.
4. **No traffic or conversion data.** `BusinessSnapshot.traffic` /
   `.conversion_rate` are always `None` with a note; `query_metrics` refuses
   `traffic` and `conversion` metrics with a note instead of fabricating a series.
5. **No campaigns or marketing-channel system.** `enable_campaigns=False` in the
   lab's `MerchantAgentConfig`, so `get_campaign_performance` and `stage_campaign`
   are not even registered as tools. `stage_campaign` still raises
   `ChangeNotApplicable` if ever called directly, naming the gap.
6. **No content-quality signal, no buyer reviews.** `Listing.content_quality` is
   always `None`, `ListingDetails.review_snippets` is always empty,
   `missing_attributes` is always empty.
7. **No return tracking.** `ListingDetails.return_rate_pct` is always `None`,
   even though `stock_movements.movement_type` has a `'return'` value in the
   schema, no return rows exist or are computed from in this lab.
8. **No order-issue system beyond shipping status.** Only the `delayed` kind of
   `OrderIssue` is derivable (paid, not delivered, more than
   `UNSHIPPED_DELAY_DAYS` days old). `return_spike`, `buyer_message`, `damaged`
   have no backing data in NOIR at all.
9. **"Slow mover" is a heuristic, not a system signal.** The adapter flags a
   product as `slow_mover` when it sold 0 units in the last 30 days and is not
   already `low_stock`; NOIR has no dedicated slow-mover computation to mirror.
10. **`apply_change` never reaches the 5 NOIR tables in this lab.** There is no
    host-approval surface, so `require_host_approval=True` (the default) means
    `gates.py`'s `APPROVAL_GATE` refuses every `apply_change` call before the
    backend method runs. If it ever ran, it still would not write to `products`,
    `orders`, `order_items`, or `stock_movements`, staging is the only write path
    this lab exercises, matching the safety requirement in the spec.

## Adapter size

See the lab README for the measured line count and method count once Phase B
finishes; this section is filled in there, not duplicated here.
