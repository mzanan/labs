"""StorefrontBackend over ecommerce_mirror.sqlite: a local mirror of personal/ecommerce's
real schema (src/db/schema.ts), read for catalog, category, image, order and shipping
data, plus this lab's own lab_cart, lab_cart_items, lab_preferences, lab_policies and
lab_pickup_options for everything the real schema has no answer for. Never writes to a
mirrored real table; see mapping.md for the full method-by-method account, including
what changed from p7's original NOIR-backed adapter (sqlite_storefront.py, now
superseded).

Two fixes this rewrite adds because Phase B of the NOIR run proved they were needed,
both scoped to search_products and search_policies:

1. Title-to-id lookup: an exact (case-insensitive) title match short-circuits the
   ranking step entirely, so "Outerwear Item 07" as a query resolves to that one product
   deterministically instead of depending on term-overlap scoring. NOIR's run showed a
   model guessing a slug-shaped id from a title ("outerwear-item-07"), failing, then
   falling back to a text search that (correctly) found it; a customer names products by
   title, never by id, so this path should be the fast, common case, not a fallback.
2. Light stemming in the term-overlap ranking: each term is reduced by stripping one
   trailing "s" or "es" before matching, so a singular query word ("top") overlaps a
   plural catalog word ("tops"). NOIR's run showed qwen3.8-27b's query="top" scoring 0
   against every "tops" product and returning nothing, even though its own category
   filter had already found the right rows. A substring fallback (raw query as a
   substring of the title) also engages when stemmed term-overlap still scores 0
   everywhere, so a full free-text phrase (as gpt-5.6-luna sent for search_policies)
   still finds a match without needing the whole query to appear verbatim.
"""

from __future__ import annotations

import json
import re
import sqlite3
from datetime import UTC, datetime
from typing import Any

from shopping_agent import (
    Cart,
    CartItem,
    FulfillmentOption,
    Order,
    OrderItem,
    OrderStatus,
    Policy,
    Product,
    ProductDetails,
    SearchFilters,
    ShoppingSessionContext,
    StorefrontBackend,
    Unavailable,
    UserPreferences,
)

_SHIPPING_TO_ORDER_STATUS = {
    "pending": OrderStatus.PROCESSING,
    "in_transit": OrderStatus.SHIPPED,
    "delivered": OrderStatus.DELIVERED,
}
_WORD_RE = re.compile(r"[a-z0-9]+")


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _stem(word: str) -> str:
    if len(word) > 4 and word.endswith("es"):
        return word[:-2]
    if len(word) > 3 and word.endswith("s"):
        return word[:-1]
    return word


def _terms(text: str) -> set[str]:
    return {_stem(w) for w in _WORD_RE.findall((text or "").lower())}


class EcommerceStorefrontBackend(StorefrontBackend):
    def __init__(self, db_path: str) -> None:
        self.db_path = db_path
        self.conn = sqlite3.connect(db_path)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.search_log: list[dict[str, Any]] = []

    def _sizes_for(self, product_id: str) -> list[str]:
        rows = self.conn.execute(
            "SELECT size_name FROM product_variants WHERE product_id = ? ORDER BY size_name",
            (product_id,),
        ).fetchall()
        return [r[0] for r in rows]

    def _first_image(self, product_id: str) -> str | None:
        row = self.conn.execute(
            "SELECT image_url FROM product_images WHERE product_id = ? "
            "ORDER BY position ASC LIMIT 1",
            (product_id,),
        ).fetchone()
        return row[0] if row else None

    def _product_row(self, product_id: str) -> sqlite3.Row | None:
        return self.conn.execute(
            """SELECT p.*, c.name AS category_name
               FROM products p LEFT JOIN product_categories c ON c.id = p.category_id
               WHERE p.id = ?""",
            (product_id,),
        ).fetchone()

    def _to_product(self, row: sqlite3.Row) -> Product:
        return Product(
            product_id=row["id"],
            title=row["name"],
            brand=None,
            price=row["price"],
            currency="USD",
            rating=None,
            review_count=None,
            image_url=self._first_image(row["id"]),
            category=row["category_name"],
            labels=["featured"] if row["is_featured"] else [],
            attributes={"sizes": ", ".join(self._sizes_for(row["id"])) or "one size"},
            in_stock=bool(row["is_active"]) and row["stock_quantity"] > 0,
            short_description=row["description"],
            options={},
            option_values={},
            variant_of=None,
        )

    def _to_details(self, row: sqlite3.Row) -> ProductDetails:
        base = self._to_product(row)
        return ProductDetails(
            **base.model_dump(),
            long_description=row["description"],
            specs={},
            review_highlights=[],
            variants=[],
        )

    def _product_terms(self, row: sqlite3.Row) -> set[str]:
        return _terms(
            f"{row['name']} {row['slug']} {row['description']} {row['category_name'] or ''}"
        )

    async def search_products(
        self,
        session: ShoppingSessionContext,
        query: str,
        filters: SearchFilters | None = None,
        limit: int = 8,
    ) -> list[Product]:
        del session
        clauses = ["p.is_active = 1"]
        params: list[Any] = []
        if filters:
            if filters.category:
                clauses.append("c.name LIKE ?")
                params.append(f"%{filters.category}%")
            if filters.min_price is not None:
                clauses.append("p.price >= ?")
                params.append(filters.min_price)
            if filters.max_price is not None:
                clauses.append("p.price <= ?")
                params.append(filters.max_price)
            size = (filters.attributes or {}).get("size")
            if size:
                clauses.append(
                    "p.id IN (SELECT product_id FROM product_variants WHERE size_name = ?)"
                )
                params.append(size)
        candidates = self.conn.execute(
            f"""SELECT p.*, c.name AS category_name FROM products p
                LEFT JOIN product_categories c ON c.id = p.category_id
                WHERE {' AND '.join(clauses)}""",
            params,
        ).fetchall()

        q = (query or "").strip()
        q_lower = q.lower()

        title_match = next((row for row in candidates if row["name"].lower() == q_lower), None)

        if title_match is not None:
            ranked = [title_match] + [r for r in candidates if r["id"] != title_match["id"]]
        elif not q or q_lower in {"all", "*", "everything", "catalog"}:
            ranked = list(candidates)
        else:
            query_terms = _terms(q)
            scored = [(len(query_terms & self._product_terms(row)), row) for row in candidates]
            ranked = [row for score, row in scored if score > 0]
            ranked.sort(key=lambda row: -len(query_terms & self._product_terms(row)))
            if not ranked:
                ranked = [row for row in candidates if q_lower in row["name"].lower()]

        sort = filters.sort if filters else "relevance"
        if sort == "price_asc":
            ranked = sorted(ranked, key=lambda r: r["price"])
        elif sort == "price_desc":
            ranked = sorted(ranked, key=lambda r: -r["price"])

        results = [self._to_product(r) for r in ranked[:limit]]
        self.search_log.append({"query": q, "returned_ids": [p.product_id for p in results]})
        return results

    async def get_product_details(
        self, session: ShoppingSessionContext, product_id: str
    ) -> ProductDetails | None:
        del session
        row = self._product_row(product_id)
        if row is None:
            return None
        return self._to_details(row)

    def _cart_rows(self, session_id: str) -> list[sqlite3.Row]:
        return self.conn.execute(
            "SELECT * FROM lab_cart_items WHERE session_id = ? ORDER BY id",
            (session_id,),
        ).fetchall()

    def _to_cart(self, session_id: str) -> Cart:
        rows = self._cart_rows(session_id)
        return Cart(
            items=[
                CartItem(product_id=r["product_id"], title=r["title"], price=r["price"],
                          quantity=r["quantity"])
                for r in rows
            ],
            currency="USD",
        )

    def _ensure_cart_header(self, session_id: str) -> None:
        self.conn.execute(
            "INSERT INTO lab_cart (session_id, currency, updated_at) VALUES (?, 'USD', ?) "
            "ON CONFLICT(session_id) DO UPDATE SET updated_at = excluded.updated_at",
            (session_id, _now_iso()),
        )

    async def get_cart(self, session: ShoppingSessionContext) -> Cart:
        return self._to_cart(session.session_id)

    async def add_to_cart(
        self, session: ShoppingSessionContext, product_id: str, quantity: int
    ) -> Cart:
        row = self._product_row(product_id)
        if row is None:
            raise KeyError(product_id)
        if not bool(row["is_active"]) or row["stock_quantity"] <= 0:
            raise Unavailable(f"{product_id} is out of stock")
        self._ensure_cart_header(session.session_id)
        existing = self.conn.execute(
            "SELECT quantity FROM lab_cart_items WHERE session_id = ? AND product_id = ?",
            (session.session_id, product_id),
        ).fetchone()
        new_quantity = (existing["quantity"] if existing else 0) + quantity
        self.conn.execute(
            "INSERT INTO lab_cart_items (session_id, product_id, title, price, quantity, added_at) "
            "VALUES (?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(session_id, product_id) DO UPDATE SET quantity = excluded.quantity",
            (session.session_id, product_id, row["name"], row["price"], new_quantity, _now_iso()),
        )
        self.conn.commit()
        return self._to_cart(session.session_id)

    async def update_cart_item(
        self, session: ShoppingSessionContext, product_id: str, quantity: int
    ) -> Cart:
        self.conn.execute(
            "UPDATE lab_cart_items SET quantity = ? WHERE session_id = ? AND product_id = ?",
            (quantity, session.session_id, product_id),
        )
        self.conn.commit()
        return self._to_cart(session.session_id)

    async def remove_from_cart(self, session: ShoppingSessionContext, product_id: str) -> Cart:
        self.conn.execute(
            "DELETE FROM lab_cart_items WHERE session_id = ? AND product_id = ?",
            (session.session_id, product_id),
        )
        self.conn.commit()
        return self._to_cart(session.session_id)

    async def get_preferences(self, session: ShoppingSessionContext) -> UserPreferences:
        row = self.conn.execute(
            "SELECT * FROM lab_preferences WHERE user_id = ?", (session.user_id,)
        ).fetchone()
        if row is None:
            return UserPreferences(user_id=session.user_id)
        return UserPreferences(
            user_id=row["user_id"],
            display_name=row["display_name"],
            loyalty_tier=row["loyalty_tier"],
            default_location=row["default_location"],
            preferences=json.loads(row["preferences"]),
        )

    def _order_items(self, order_id: str) -> list[OrderItem]:
        rows = self.conn.execute(
            """SELECT oi.*, pv.product_id AS product_id
               FROM order_items oi
               JOIN product_variants pv ON pv.id = oi.product_variant_id
               WHERE oi.order_id = ?""",
            (order_id,),
        ).fetchall()
        return [
            OrderItem(
                product_id=r["product_id"],
                title=r["product_name"],
                quantity=r["quantity"],
                price=r["price_at_purchase"],
                option_values={"size": r["product_size"]} if r["product_size"] else {},
            )
            for r in rows
        ]

    def _to_order(self, row: sqlite3.Row) -> Order:
        return Order(
            order_id=row["id"],
            status=_SHIPPING_TO_ORDER_STATUS.get(row["shipping_status"], OrderStatus.PROCESSING),
            placed_at=datetime.fromisoformat(row["created_at"].replace("Z", "+00:00")),
            items=self._order_items(row["id"]),
            total=row["total_amount"],
            currency="USD",
            estimated_delivery=None,
            tracking_url=None,
        )

    async def get_orders(self, session: ShoppingSessionContext, limit: int = 5) -> list[Order]:
        rows = self.conn.execute(
            "SELECT * FROM orders WHERE user_id = ? AND status = 'paid' "
            "ORDER BY created_at DESC LIMIT ?",
            (session.user_id, limit),
        ).fetchall()
        return [self._to_order(r) for r in rows]

    async def get_order(self, session: ShoppingSessionContext, order_id: str) -> Order | None:
        row = self.conn.execute(
            "SELECT * FROM orders WHERE id = ? AND user_id = ? AND status = 'paid'",
            (order_id, session.user_id),
        ).fetchone()
        if row is None:
            return None
        return self._to_order(row)

    async def search_policies(self, session: ShoppingSessionContext, query: str) -> list[Policy]:
        del session
        rows = self.conn.execute("SELECT * FROM lab_policies").fetchall()
        query_terms = _terms(query)
        if not query_terms:
            return [
                Policy(policy_id=r["policy_id"], title=r["title"], category=r["category"],
                       content=r["content"])
                for r in rows
            ]
        scored = []
        for r in rows:
            heading_hits = len(query_terms & _terms(f"{r['title']} {r['category']}"))
            body_hits = len(query_terms & _terms(r["content"]))
            points = 2 * heading_hits + body_hits
            if points:
                scored.append((points, r))
        scored.sort(key=lambda pair: -pair[0])
        return [
            Policy(policy_id=r["policy_id"], title=r["title"], category=r["category"],
                   content=r["content"])
            for _, r in scored
        ]

    async def get_fulfillment_options(
        self, session: ShoppingSessionContext, product_ids: list[str]
    ) -> list[FulfillmentOption]:
        known = [pid for pid in product_ids if self._product_row(pid) is not None]
        if not known:
            return []
        pref = self.conn.execute(
            "SELECT default_location FROM lab_preferences WHERE user_id = ?",
            (session.user_id,),
        ).fetchone()
        options: list[FulfillmentOption] = []
        if pref is not None:
            country = self.conn.execute(
                "SELECT * FROM country_shipping_prices WHERE country_name = ?",
                (pref["default_location"],),
            ).fetchone()
            if country is not None:
                options.append(
                    FulfillmentOption(
                        method="delivery",
                        eta=f"{country['min_delivery_days']}-{country['max_delivery_days']} business days",
                        fee=country["shipping_price"],
                        location=country["country_name"],
                    )
                )
        for r in self.conn.execute(
            "SELECT * FROM lab_pickup_options WHERE is_active = 1"
        ).fetchall():
            options.append(
                FulfillmentOption(method="pickup", eta=r["eta"], fee=r["fee"], location=r["location"])
            )
        return options
