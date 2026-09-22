"""MerchantBackend over noir.sqlite: reads NOIR's 5 real tables (products,
product_variants, orders, order_items, stock_movements), stages writes into
lab_staged_changes in the same file, and never applies anything to the 5 NOIR tables.
This lab has no host-approval surface, so apply_change is unreachable through the gate
in gates.py; see mapping.md.

Design decisions this file encodes (each is a gap noted in mapping.md):
- NOIR variants (sizes) carry no independent price or stock, so a product is modeled
  as a plain Listing, no options/family split. "Low-stock variant" maps to its
  product's single stock_quantity and threshold.
- No unit_cost/COGS anywhere in NOIR, so margin and min/max price are always None,
  never computed from an assumed cost.
- No traffic/analytics, campaigns, or order-issue system beyond shipping status, so
  those surfaces are partial or, for campaigns, fully disabled.
"""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from typing import Any

from merchant_agent import (
    ActorKind,
    AlertCounts,
    AnalysisTable,
    BusinessSnapshot,
    Campaign,
    CampaignDraft,
    ChangeItem,
    ChangeKind,
    ChangeLedger,
    DataLimitation,
    InventoryActionItem,
    InventoryAlert,
    Listing,
    ListingDetails,
    ListingFilters,
    MerchantAgentConfig,
    MerchantBackend,
    MerchantSessionContext,
    MetricPoint,
    MetricSeries,
    OrderIssue,
    PriceUpdateItem,
    PricingContext,
    PromotionDraft,
    StagedChange,
)
from merchant_agent.changes import ChangeNotApplicable

LOW_STOCK_THRESHOLD = 5
UNSHIPPED_DELAY_DAYS = 10
STATUS_ORDER_ISSUE_KIND = "delayed"


def _status(is_active: int, stock: int) -> str:
    if stock <= 0:
        return "out_of_stock"
    return "active" if is_active else "paused"


class SqliteMerchantBackend(MerchantBackend):
    def __init__(
        self,
        db_path: str,
        config: MerchantAgentConfig | None = None,
        merchant_id: str = "noir-store",
    ) -> None:
        self.db_path = db_path
        self.config = config or MerchantAgentConfig(brand_name="NOIR")
        self.merchant_id = merchant_id
        self.ledger = ChangeLedger(self.config)
        self.conn = sqlite3.connect(db_path)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")

    # ------------------------------------------------------------------
    # Shared reads
    # ------------------------------------------------------------------

    def _reference_date(self) -> str:
        """The last day this dataset has orders for. Periods are computed relative to
        this, not wall-clock time, because the seed is anchored to a fixed date."""
        row = self.conn.execute("SELECT MAX(date(created_at)) FROM orders").fetchone()
        return row[0]

    def _product_row(self, product_id: str) -> sqlite3.Row | None:
        return self.conn.execute(
            "SELECT * FROM products WHERE id = ?", (product_id,)
        ).fetchone()

    def _sizes_for(self, product_id: str) -> list[str]:
        rows = self.conn.execute(
            "SELECT size_name FROM product_variants WHERE product_id = ? ORDER BY size_name",
            (product_id,),
        ).fetchall()
        return [r[0] for r in rows]

    def _sales_last_30d(self, product_id: str, as_of: str) -> int:
        row = self.conn.execute(
            """SELECT COALESCE(SUM(oi.quantity), 0)
               FROM order_items oi
               JOIN product_variants pv ON pv.id = oi.product_variant_id
               JOIN orders o ON o.id = oi.order_id
               WHERE pv.product_id = ? AND o.status = 'paid'
                 AND date(o.created_at) > date(?, '-30 days')
                 AND date(o.created_at) <= date(?)""",
            (product_id, as_of, as_of),
        ).fetchone()
        return int(row[0])

    def _listing(self, row: sqlite3.Row) -> Listing:
        return Listing(
            listing_id=row["id"],
            title=row["name"],
            status=_status(row["is_active"], row["stock_quantity"]),
            price=row["price"],
            currency="USD",
            stock=row["stock_quantity"],
            category=row["category_id"],
            content_quality=None,  # gap: NOIR does not track content quality
            attributes={"sizes": ", ".join(self._sizes_for(row["id"])) or "one size"},
            image_url=None,
            short_description=row["description"],
            options={},  # gap: variants carry no independent price/stock, see mapping.md
            option_values={},
            variant_of=None,
        )

    # ------------------------------------------------------------------
    # Performance
    # ------------------------------------------------------------------

    async def get_business_snapshot(
        self, session: MerchantSessionContext, period: str | None = None
    ) -> BusinessSnapshot:
        del session
        as_of = self._reference_date()
        window = 30 if not period or period == "last_30_days" else None
        note = None
        if window is None:
            note = f"period {period!r} not recognized, showing the last 30 days"
            window = 30

        def totals(end: str, days: int) -> tuple[float, int]:
            row = self.conn.execute(
                f"""SELECT COALESCE(SUM(oi.quantity * oi.price_at_purchase), 0),
                           COUNT(DISTINCT o.id)
                    FROM order_items oi JOIN orders o ON o.id = oi.order_id
                    WHERE o.status = 'paid' AND date(o.created_at) > date(?, '-{days} days')
                      AND date(o.created_at) <= date(?)""",
                (end, end),
            ).fetchone()
            return round(row[0], 2), int(row[1])

        sales, orders = totals(as_of, window)
        prev_end = self.conn.execute(
            "SELECT date(?, ?)", (as_of, f"-{window} days")
        ).fetchone()[0]
        prev_sales, prev_orders = totals(prev_end, window)

        def change_pct(current: float, prior: float) -> float | None:
            if prior == 0:
                return None
            return round((current - prior) / prior * 100, 1)

        alerts = await self._alert_counts()
        return BusinessSnapshot(
            period=f"last_{window}_days",
            compare_to=f"previous_{window}_days",
            sales=sales,
            orders=orders,
            traffic=None,
            conversion_rate=None,
            average_order_value=round(sales / orders, 2) if orders else None,
            sales_change_pct=change_pct(sales, prev_sales),
            orders_change_pct=change_pct(orders, prev_orders),
            traffic_change_pct=None,
            conversion_change_pct=None,
            currency="USD",
            alerts=alerts,
            note=note or "traffic and conversion are unavailable, NOIR has no analytics system",
        )

    async def query_metrics(
        self,
        session: MerchantSessionContext,
        metric: str,
        period: str | None = None,
        granularity: str = "day",
        segment: str | None = None,
    ) -> MetricSeries:
        del session
        cleaned = metric.strip().lower().replace(" ", "_")
        as_of = self._reference_date()
        window = 30
        if cleaned not in {"sales", "revenue", "orders"}:
            return MetricSeries(
                metric=cleaned,
                granularity=granularity if granularity in ("day", "week", "month") else "day",
                period=period,
                segment=segment,
                points=[],
                note=f"{cleaned!r} is unavailable, NOIR has no traffic or conversion data",
            )
        params: list[Any] = [as_of, window, as_of]
        category_clause = ""
        if segment:
            category_clause = "AND p.category_id = ?"
            params.append(segment)
        select = (
            "SUM(oi.quantity * oi.price_at_purchase)" if cleaned in {"sales", "revenue"}
            else "COUNT(DISTINCT o.id)"
        )
        rows = self.conn.execute(
            f"""SELECT date(o.created_at) AS d, COALESCE({select}, 0)
                FROM order_items oi
                JOIN product_variants pv ON pv.id = oi.product_variant_id
                JOIN products p ON p.id = pv.product_id
                JOIN orders o ON o.id = oi.order_id
                WHERE o.status = 'paid' AND date(o.created_at) > date(?, '-' || ? || ' days')
                  AND date(o.created_at) <= ? {category_clause}
                GROUP BY d ORDER BY d""",
            params,
        ).fetchall()
        points = [MetricPoint(date=r[0], value=round(r[1], 2)) for r in rows]
        return MetricSeries(
            metric=cleaned,
            unit="USD" if cleaned in {"sales", "revenue"} else None,
            granularity="day",
            period=f"last_{window}_days",
            segment=segment,
            points=points,
        )

    async def get_campaign_performance(
        self, session: MerchantSessionContext, campaign_id: str | None = None
    ) -> list[Campaign]:
        del session, campaign_id
        return []  # gap: NOIR has no campaigns/marketing-channel system

    # ------------------------------------------------------------------
    # Catalog
    # ------------------------------------------------------------------

    async def search_listings(
        self,
        session: MerchantSessionContext,
        query: str,
        filters: ListingFilters | None = None,
        limit: int = 8,
    ) -> list[Listing]:
        del session
        clauses = ["1=1"]
        params: list[Any] = []
        q = (query or "").strip()
        if q and q.lower() not in {"all", "*", "everything", "catalog"}:
            clauses.append("(name LIKE ? OR slug LIKE ? OR category_id LIKE ?)")
            like = f"%{q}%"
            params += [like, like, like]
        if filters:
            if filters.category:
                clauses.append("category_id = ?")
                params.append(filters.category)
            if filters.max_stock is not None:
                clauses.append("stock_quantity <= ?")
                params.append(filters.max_stock)
        sort = filters.sort if filters else "relevance"
        order_by = {
            "stock_asc": "stock_quantity ASC",
            "price_desc": "price DESC",
            "price_asc": "price ASC",
        }.get(sort, "name ASC")
        rows = self.conn.execute(
            f"SELECT * FROM products WHERE {' AND '.join(clauses)} "
            f"ORDER BY {order_by} LIMIT ?",
            (*params, limit),
        ).fetchall()
        listings = [self._listing(r) for r in rows]
        if filters and filters.status:
            listings = [listing for listing in listings if listing.status == filters.status]
        return listings

    async def get_listing(
        self, session: MerchantSessionContext, listing_id: str
    ) -> ListingDetails | None:
        del session
        row = self._product_row(listing_id)
        if row is None:
            return None
        as_of = self._reference_date()
        base = self._listing(row)
        return ListingDetails(
            **base.model_dump(),
            long_description=row["description"],
            review_snippets=[],  # gap: NOIR has no buyer review data
            sales_last_30d=self._sales_last_30d(listing_id, as_of),
            return_rate_pct=None,  # gap: no returns tracked in this dataset
            missing_attributes=[],
            variants=[],
        )

    # ------------------------------------------------------------------
    # Inventory and order health
    # ------------------------------------------------------------------

    async def _alert_counts(self) -> AlertCounts:
        internal = MerchantSessionContext(
            session_id="internal", merchant_id=self.merchant_id, operator="system"
        )
        alerts = await self.get_inventory_alerts(internal)
        issues = await self.get_order_issues(internal)
        return AlertCounts(
            low_stock=sum(1 for a in alerts if a.kind == "low_stock"),
            slow_movers=sum(1 for a in alerts if a.kind == "slow_mover"),
            order_issues=len(issues),
            pending_changes=len(self.ledger.pending()),
        )

    async def get_inventory_alerts(self, session: MerchantSessionContext) -> list[InventoryAlert]:
        del session
        as_of = self._reference_date()
        rows = self.conn.execute("SELECT * FROM products WHERE is_active = 1").fetchall()
        alerts: list[InventoryAlert] = []
        for row in rows:
            stock = row["stock_quantity"]
            sales_30d = self._sales_last_30d(row["id"], as_of)
            daily_pace = sales_30d / 30
            if stock <= LOW_STOCK_THRESHOLD:
                alerts.append(
                    InventoryAlert(
                        listing_id=row["id"],
                        title=row["name"],
                        kind="low_stock",
                        stock=stock,
                        threshold=LOW_STOCK_THRESHOLD,
                        days_of_cover=round(stock / daily_pace, 1) if daily_pace else None,
                        sales_last_30d=sales_30d,
                        storefront_visible=stock > 0,
                    )
                )
            elif sales_30d == 0:
                # Heuristic (0 units sold in 30 days), not a real slow-mover system.
                # See mapping.md.
                alerts.append(
                    InventoryAlert(
                        listing_id=row["id"],
                        title=row["name"],
                        kind="slow_mover",
                        stock=stock,
                        threshold=LOW_STOCK_THRESHOLD,
                        days_of_cover=None,
                        sales_last_30d=sales_30d,
                        storefront_visible=True,
                    )
                )
        alerts.sort(key=lambda a: (a.kind != "low_stock", a.stock))
        return alerts

    async def get_order_issues(self, session: MerchantSessionContext) -> list[OrderIssue]:
        del session
        as_of = self._reference_date()
        rows = self.conn.execute(
            """SELECT * FROM orders WHERE status = 'paid' AND shipping_status != 'delivered'
               AND date(created_at) <= date(?, ?)""",
            (as_of, f"-{UNSHIPPED_DELAY_DAYS} days"),
        ).fetchall()
        issues = []
        for row in rows:
            days_row = self.conn.execute(
                "SELECT CAST(julianday(?) - julianday(?) AS INTEGER)", (as_of, row["created_at"])
            ).fetchone()
            days = days_row[0]
            issues.append(
                OrderIssue(
                    issue_id=f"issue-{row['id']}",
                    order_id=row["id"],
                    kind=STATUS_ORDER_ISSUE_KIND,
                    summary=f"Order {row['id']} paid {days}d ago, still {row['shipping_status']}",
                    listing_id=None,
                    buyer_message_excerpt=None,  # gap: no buyer-message system in NOIR
                    opened_at=None,
                )
            )
        return issues

    # ------------------------------------------------------------------
    # Pricing
    # ------------------------------------------------------------------

    async def get_pricing_context(
        self, session: MerchantSessionContext, listing_id: str
    ) -> PricingContext | None:
        del session
        row = self._product_row(listing_id)
        if row is None:
            return None
        as_of = self._reference_date()
        sales_30d = self._sales_last_30d(listing_id, as_of)
        demand = "rising" if sales_30d >= 8 else "falling" if sales_30d == 0 else "steady"
        return PricingContext(
            listing_id=listing_id,
            current_price=row["price"],
            currency="USD",
            unit_cost=None,  # gap: NOIR has no COGS/unit-cost field
            margin_pct=None,
            min_price=None,
            max_price=None,
            max_price_delta_pct=self.config.max_price_delta_pct,
            max_promotion_discount_pct=self.config.max_promotion_discount_pct,
            min_price_basis=None,
            demand_signal=demand,
            last_changed=None,  # gap: no price-history table
        )

    # ------------------------------------------------------------------
    # Staged writes
    # ------------------------------------------------------------------

    def _persist_stage(self, change: StagedChange) -> None:
        self.conn.execute(
            """INSERT INTO lab_staged_changes
               (change_id, kind, status, summary, items, created_at, created_by,
                created_by_kind, currency, margin_impact, margin_before_pct, margin_after_pct)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                change.change_id,
                change.kind.value,
                change.status.value,
                change.summary,
                change.model_dump_json(include={"items"}),
                change.created_at.isoformat(),
                change.created_by,
                change.created_by_kind.value,
                change.currency,
                change.margin_impact,
                change.margin_before_pct,
                change.margin_after_pct,
            ),
        )
        self.conn.commit()

    def _persist_resolution(self, change: StagedChange) -> None:
        self.conn.execute(
            """UPDATE lab_staged_changes
               SET status = ?, applied_at = ?, applied_by = ?, discarded_at = ?,
                   discarded_by = ?, discarded_by_kind = ?
               WHERE change_id = ?""",
            (
                change.status.value,
                change.applied_at.isoformat() if change.applied_at else None,
                change.applied_by,
                change.discarded_at.isoformat() if change.discarded_at else None,
                change.discarded_by,
                change.discarded_by_kind.value if change.discarded_by_kind else None,
                change.change_id,
            ),
        )
        self.conn.commit()

    async def stage_listing_update(
        self,
        session: MerchantSessionContext,
        listing_id: str,
        fields: dict[str, Any],
        note: str | None = None,
    ) -> StagedChange:
        row = self._product_row(listing_id)
        if row is None:
            raise ChangeNotApplicable(f"no listing {listing_id}")
        allowed = {"title": "name", "short_description": "description",
                   "long_description": "description"}
        if "short_description" in fields and "long_description" in fields:
            raise ValueError("NOIR stores one description field, send only one of "
                              "short_description or long_description")
        unsupported = set(fields) - set(allowed)
        if unsupported:
            raise ChangeNotApplicable(
                f"NOIR products have no {', '.join(sorted(unsupported))} field(s)"
            )
        items = [
            ChangeItem(
                target=listing_id,
                field=name,
                before=row["name"] if allowed[name] == "name" else row["description"],
                after=value,
            )
            for name, value in fields.items()
        ]
        change = self.ledger.stage(
            kind=ChangeKind.LISTING_UPDATE,
            summary=note or f"Update listing content on {listing_id}",
            items=items,
            actor=session.operator,
            actor_kind=ActorKind.AGENT,
        )
        self._persist_stage(change)
        return change

    async def stage_price_update(
        self,
        session: MerchantSessionContext,
        items: list[PriceUpdateItem],
        note: str | None = None,
    ) -> StagedChange:
        change_items = []
        for item in items:
            row = self._product_row(item.listing_id)
            if row is None:
                raise ChangeNotApplicable(f"no listing {item.listing_id}")
            change_items.append(
                ChangeItem(
                    target=item.listing_id, field="price", before=row["price"], after=item.new_price
                )
            )
        change = self.ledger.stage(
            kind=ChangeKind.PRICE_UPDATE,
            summary=note or f"Price update for {len(items)} listing(s)",
            items=change_items,
            actor=session.operator,
            actor_kind=ActorKind.AGENT,
            currency="USD",
            margin_impact=None,  # gap: no unit_cost to compute margin impact from
        )
        self._persist_stage(change)
        return change

    async def stage_inventory_action(
        self,
        session: MerchantSessionContext,
        items: list[InventoryActionItem],
        note: str | None = None,
    ) -> StagedChange:
        change_items = []
        for item in items:
            row = self._product_row(item.listing_id)
            if row is None:
                raise ChangeNotApplicable(f"no listing {item.listing_id}")
            if item.action == "restock":
                before: Any = row["stock_quantity"]
                after: Any = before + (item.quantity or 0)
                field = "stock"
            else:
                before = "active" if row["is_active"] else "paused"
                after = "paused" if item.action == "pause" else "active"
                field = "status"
            change_items.append(
                ChangeItem(target=item.listing_id, field=field, before=before, after=after)
            )
        change = self.ledger.stage(
            kind=ChangeKind.INVENTORY_ACTION,
            summary=note or f"Inventory action for {len(items)} listing(s)",
            items=change_items,
            actor=session.operator,
            actor_kind=ActorKind.AGENT,
        )
        self._persist_stage(change)
        return change

    async def stage_promotion(
        self, session: MerchantSessionContext, promotion: PromotionDraft
    ) -> StagedChange:
        items = []
        for listing_id in promotion.listing_ids:
            row = self._product_row(listing_id)
            if row is None:
                raise ChangeNotApplicable(f"no listing {listing_id}")
            promo_price = round(row["price"] * (1 - promotion.discount_pct / 100), 2)
            items.append(
                ChangeItem(
                    target=listing_id, field="promotion_price", before=row["price"], after=promo_price
                )
            )
        change = self.ledger.stage(
            kind=ChangeKind.PROMOTION,
            summary=f"{promotion.name} ({promotion.discount_pct:.0f}% off, "
            f"{promotion.starts} to {promotion.ends})",
            items=items,
            actor=session.operator,
            actor_kind=ActorKind.AGENT,
            currency="USD",
        )
        self._persist_stage(change)
        return change

    async def stage_campaign(
        self, session: MerchantSessionContext, campaign: CampaignDraft
    ) -> StagedChange:
        del session, campaign
        raise ChangeNotApplicable(
            "this store has no campaign/marketing-channel system: no spend, budget, "
            "or audience data in NOIR"
        )

    async def get_pending_changes(self, session: MerchantSessionContext) -> list[StagedChange]:
        del session
        return self.ledger.pending()

    async def apply_change(self, session: MerchantSessionContext, change_id: str) -> StagedChange:
        # Reached only if a future extension adds a host-approval surface. This lab has
        # none, so gates.py's APPROVAL_GATE refuses every apply_change call before this
        # method runs (scenario 6). If it ever runs, it still never writes to the 5 NOIR
        # tables: staging is the only write path this lab exercises.
        applied = self.ledger.apply(change_id, actor=session.operator)
        self._persist_resolution(applied)
        return applied

    async def discard_change(
        self,
        session: MerchantSessionContext,
        change_id: str,
        actor_kind: ActorKind = ActorKind.OPERATOR,
    ) -> StagedChange:
        discarded = self.ledger.discard(change_id, actor=session.operator, actor_kind=actor_kind)
        self._persist_resolution(discarded)
        return discarded

    # ------------------------------------------------------------------
    # Merchant context
    # ------------------------------------------------------------------

    async def get_merchant_context(self, session: MerchantSessionContext) -> dict[str, Any] | None:
        as_of = self._reference_date()
        catalog_size = self.conn.execute("SELECT COUNT(*) FROM products").fetchone()[0]
        counts = await self._alert_counts()
        return {
            "store": self.config.brand_name,
            "operator": session.operator,
            "current_period": f"as of {as_of}",
            "catalog_size": catalog_size,
            "limitations": [
                DataLimitation(
                    source="analytics", note="no traffic, page views, or conversion data"
                ).model_dump(),
                DataLimitation(
                    source="cost", note="no unit cost/COGS; margin figures are never available"
                ).model_dump(),
                DataLimitation(
                    source="campaigns", note="no marketing-channel system; campaigns are unmanaged"
                ).model_dump(),
                DataLimitation(
                    source="order_issues",
                    note="only unshipped-after-10-days is derivable; no buyer messages, "
                    "damage reports, or return-spike data",
                ).model_dump(),
            ],
            "alerts": {
                "low_stock": counts.low_stock,
                "slow_movers": counts.slow_movers,
                "order_issues": counts.order_issues,
                "pending_changes": counts.pending_changes,
            },
        }
