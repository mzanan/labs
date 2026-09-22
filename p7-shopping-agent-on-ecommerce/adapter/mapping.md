# personal/ecommerce to StorefrontBackend mapping

Source: `personal/ecommerce/src/db/schema.ts` (559 lines, 22 tables at read time), mirrored
locally into `db/schema.sql` / `db/ecommerce_mirror.sqlite` (never the Neon production
database), plus this lab's own `lab_cart`, `lab_cart_items`, `lab_preferences`,
`lab_policies`, `lab_pickup_options` tables, none of which exist in the real schema. This
file records every place `ecommerce_storefront.py` had to make a call because the real
data does not fully back the `StorefrontBackend` interface, and, method by method, what
changed from the superseded NOIR-backed adapter (`p7-shopping-agent-on-own-store`'s
`sqlite_storefront.py` and its `mapping.md`, both gone now that this lab was rewritten in
place).

## Method count

`upstream/shopping-agent/core/shopping_agent/backend.py` (pin `fd4d5922`, same commit the
NOIR run used) has exactly 11 `@abstractmethod` declarations: `search_products`,
`get_product_details`, `get_cart`, `add_to_cart`, `update_cart_item`, `remove_from_cart`,
`get_preferences`, `get_orders`, `get_order`, `search_policies`,
`get_fulfillment_options`. This spec's own list already matches that count, unlike the
NOIR spec, which said 12; nothing to reconcile here.

## Table mapping

| personal/ecommerce table | StorefrontBackend surface | vs. NOIR |
|---|---|---|
| `products` + `product_categories` | `Product` / `ProductDetails` (plain, `options={}`) | NOIR's `category_id` was a bare text slug (`cat-tops`); this schema joins to a real `product_categories.name`, a small but genuine improvement |
| `product_images` | `Product.image_url` (first by `position`) | new; NOIR had no image table at all, `image_url` was always `None` |
| `product_variants` | `Product.attributes["sizes"]`, display only (see gap 1); `OrderItem.option_values["size"]` | identical structure and identical gap: still no independent price or stock per variant |
| `category_sizes` | not read by the adapter | new table, no `StorefrontBackend` surface uses a category's size vocabulary; noted, not wired in |
| `sets` / `set_products` | **not read by the adapter, and no method could read it if it were** | new gap, NOIR never had bundles to miss |
| `orders` + `order_items` | `Order`, `OrderItem`, via `get_orders` / `get_order` | identical shape, identical 3-state `shipping_status` |
| `pending_orders` | not read | new table, out of scope by construction (see below) |
| `country_shipping_prices` | `get_fulfillment_options`'s `delivery` row | new; NOIR had nothing here, this is real data |
| `user` | `Order.user_id` / `lab_preferences.user_id` join key only | real Better Auth table now (`id, name, email, emailVerified, image`); still no address, loyalty, or preference columns |
| `app_settings` | not read | new table, read for this report, found nothing shopping-relevant (only an "about page" CMS string) |
| (none) | `lab_cart` / `lab_cart_items`, the only tables `add_to_cart` / `update_cart_item` / `remove_from_cart` write to | identical to NOIR: fully lab-invented |
| (none) | `lab_preferences`, read by `get_preferences` | identical to NOIR: fully lab-invented |
| (none) | `lab_policies`, read by `search_policies` | identical to NOIR: fully lab-invented |
| (none) | `lab_pickup_options`, one of two rows `get_fulfillment_options` returns | narrower than NOIR's fully-invented 3-row table: only the pickup row is invented now, delivery is real |

## Gaps that survive unchanged from the NOIR run

1. **Variants have no independent price or stock**, in the real schema exactly as in
   NOIR's mock of it: `product_variants` is only `id, product_id, size_name, timestamps`;
   stock and price live on `products`. A product is modeled as a plain `Product`
   (`options={}`), sizes shown in `attributes["sizes"]` for context only.
2. **No color, material, or any other filterable attribute anywhere in the schema.**
   Confirmed by reading `products` and every action file under `src/lib/actions/` that
   touches it: no column, no free-text field holds a color word. Scenario 1 ("something
   in black under $80") is only partly answerable for the same reason it was in NOIR:
   the price ceiling is real and SQL-checkable (10 active products qualify), "black"
   matches nothing.
3. **No rating or review system anywhere in the schema.** `Product.rating` and
   `.review_count` stay `None`; `sort="rating"` and `filters.min_rating` remain accepted
   but inert.
4. **No brand data.** `Product.brand` is always `None`; the schema has no brand column at
   all, on `products` or anywhere else.
5. **No spec/attribute table.** `ProductDetails.specs` is always `{}`.
6. **Cart is entirely lab-local.** See "The cart" below; this is the one finding the spec
   asked to not paper over.
7. **Preferences, policies, and fulfillment-pickup are lab-invented**, not because a real
   system exists and this adapter reads it partially, but because none of that data
   exists in `personal/ecommerce` at all (confirmed for policies by grepping the whole
   repo for "return", "warranty", "refund", "policy", "exchange": zero hits outside
   `schema.ts`'s own unrelated `type` column). `lab_policies` here drops NOIR's flat
   shipping-cost policy text, since real per-country shipping numbers now exist and
   supersede it (see gap improvements below); it keeps returns, exchanges, warranty, and
   price-match, unchanged in wording from the NOIR run since none of that content is
   real either way.
8. **Order status maps 3 real states onto an 8-value enum**, and the CHECK constraint
   that limits it is in the real schema itself, not something NOIR simplified:
   `orders_shipping_status_check` allows only `pending`, `in_transit`, `delivered`. The
   other 5 `OrderStatus` values (`OUT_FOR_DELIVERY`, `DELAYED`, `CANCELLED`,
   `RETURN_INITIATED`, `REFUNDED`) can never be produced by this adapter for the same
   reason they never could for NOIR: the source data has no such states, full stop, not
   an adapter shortcut.
9. **No delivery estimate or tracking URL.** `Order.estimated_delivery` and
   `.tracking_url` stay `None`; no carrier integration anywhere in the schema.
10. **`get_order` enforces ownership the schema does not itself enforce** in this lab's
    query (`id = ? AND user_id = ? AND status = 'paid'`), per the interface's own
    contract, exactly as the NOIR adapter did.

## Gaps that are new, specific to the real schema

11. **Bundles (`sets` / `set_products`) have no `StorefrontBackend` method at all.**
    `personal/ecommerce` has a genuine "shop the look" concept (DAY/NIGHT capsules, a
    `discount_percentage`, a computed `final_price`) that NOIR never had to miss, and
    none of the 11 abstract methods can surface a set as a set; the only path is
    `search_products` returning the set's member products individually, with the bundle
    framing and any bundle discount invisible to the agent. This is a real product gap
    the interface itself creates, not a data gap: even a perfect adapter could not fix it
    without a 12th method.
12. **`orderStatusEnum` and `paymentStatusEnum` are declared in `schema.ts` but neither is
    used by any table column.** `orders.status` is plain `text` defaulting to
    `"processing"`; this lab seeds it `"paid"` (matching the schema's own comment on
    `pending_orders`, "the Stripe webhook promotes a draft into a paid order"), since
    `get_orders`/`get_order` only surface `status = 'paid'` orders, same filter NOIR
    used. Noted as an observation about the real repo, not fixed: `personal/ecommerce`
    is read-only for this lab.
13. **`pending_orders` and `app_settings` were read and back nothing.** Both are on the
    spec's list of 12 relevant tables; both were checked and neither has any bearing on
    the 11 methods. `pending_orders` is a pre-payment draft, relevant only to a checkout
    flow this lab explicitly excludes ("no checkout completion"); `app_settings` holds a
    single `about_content` CMS string, not shopping-relevant. This is a confirmed
    negative result, not a skipped table.

## Gaps that genuinely improved over NOIR

- **`image_url` is now real**, sourced from `product_images`, ordered by `position`.
  NOIR had no image table; every `Product.image_url` was `None`.
- **`category` is now a real name** (`product_categories.name` via a join), not a bare
  text slug (`cat-tops`) invented for NOIR's flat schema.
- **`get_fulfillment_options`'s delivery leg is now real data**, not lab-invented: it
  reads `country_shipping_prices` (5 countries seeded: Vietnam, Thailand, Singapore, the
  United States, Australia; real `shipping_price`, `min_delivery_days`,
  `max_delivery_days` columns) keyed off the customer's `lab_preferences.default_location`
  (that link is still lab-invented, since the real `user` table carries no
  address/country column at all, only `id, name, email, emailVerified, image`). Only the
  `pickup` leg (`lab_pickup_options`) is fully invented now, versus all 3 fulfillment
  rows in NOIR.

## Fixes this rewrite adds, both proven against Phase B

Two fixes carried over as requirements from the NOIR run's findings, both scoped to
`search_products` (and the first one only there):

1. **Title-to-id lookup.** An exact, case-insensitive title match against the
   already-filtered candidate set short-circuits ranking entirely and returns that
   product first. This exists because NOIR's Phase B showed a model guessing a
   slug-shaped id from a title ("outerwear-item-07"), failing `get_product_details`, and
   only then falling back to a text search that (correctly) found the real product;
   customers here can never guess an id at all, since real ids are opaque uuids
   (`fa3c1115-23e6-589f-8dc8-015fc89ecffb`, not a readable slug), which makes this fix
   more load-bearing on the real schema than it was on NOIR's.
2. **Light stemming plus a substring fallback in term-overlap ranking.** Each term is
   reduced by stripping one trailing "s" or "es" before the overlap is scored, so a
   singular query word ("top") now matches a plural catalog word ("tops"); if stemmed
   overlap still scores 0 for every candidate, a raw substring check against the title
   engages as a fallback. Verified directly (see README's method-by-method section) that
   `query="top", filters.category="tops"` now returns 6 results instead of NOIR's 0.

`search_policies` keeps NOIR's tokenized-overlap approach (title/category/content
overlap, not one big substring) unchanged; it still has the same coincidental-overlap
property NOIR's had (a full-sentence paraphrase like "return window for changing your
mind" can rank a related policy, here `pol-exchanges`, ahead of the one it was really
asking about, `pol-returns`, since exchanges' own text happens to repeat the phrase
"30-day return window"). This does not fail scenario 5 in practice: `search_policies`
returns every scored entry, not just the top one, and both policies state the 30-day
figure, so the agent has it either way. Left as-is rather than over-fit to one query,
consistent with not inventing precision the real data does not support.

## Adapter size

`ecommerce_storefront.py` is 397 lines and implements all 11 of the 11 abstract
`StorefrontBackend` methods (see "Method count" above), larger than the NOIR-backed
adapter's 346 lines mostly because of the module docstring documenting the title-to-id
and stemming fixes and the extra joins/lookups (`product_categories`, `product_images`,
`country_shipping_prices`) the richer real schema gives it to read.
