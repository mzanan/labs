"""SQLite backend over db/ecommerce_mirror.sqlite, a copy of p7-shopping-agent-on-ecommerce's
mirror of personal/ecommerce's real schema (src/db/schema.ts), plus this lab's own lab_cart,
lab_cart_items and lab_policies tables for what the real schema has no answer for. Never writes
to a mirrored real table.

Rewritten from p7's adapter/ecommerce_storefront.py: the SQL logic (title-to-id exact match
short-circuit, light stemming in term-overlap search ranking, the cart/order/policy queries) is
reused verbatim, since that is what p7's own README says the runtime needed to pass its
scenarios. The pydantic StorefrontBackend/Product/Cart/... types from p7's shopping_agent core
package are dropped: this lab does not import that package (too large a dependency for a
provider-agnostic tool loop across two API shapes), so every method here returns plain dicts
instead.
"""

from __future__ import annotations

import re
import sqlite3
from datetime import UTC, datetime
from typing import Any

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


class EcommerceStorefrontBackend:
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
            "SELECT image_url FROM product_images WHERE product_id = ? ORDER BY position ASC LIMIT 1",
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

    def _to_product(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "product_id": row["id"],
            "title": row["name"],
            "price": row["price"],
            "currency": "USD",
            "category": row["category_name"],
            "in_stock": bool(row["is_active"]) and row["stock_quantity"] > 0,
            "stock_quantity": row["stock_quantity"],
            "short_description": row["description"],
            "sizes": self._sizes_for(row["id"]),
            "image_url": self._first_image(row["id"]),
        }

    def _to_details(self, row: sqlite3.Row) -> dict[str, Any]:
        product = self._to_product(row)
        product["long_description"] = row["description"]
        return product

    def _product_terms(self, row: sqlite3.Row) -> set[str]:
        return _terms(f"{row['name']} {row['slug']} {row['description']} {row['category_name'] or ''}")

    def search_products(
        self, query: str, filters: dict[str, Any] | None = None, limit: int = 8
    ) -> list[dict[str, Any]]:
        clauses = ["p.is_active = 1"]
        params: list[Any] = []
        filters = filters or {}
        if filters.get("category"):
            clauses.append("c.name LIKE ?")
            params.append(f"%{filters['category']}%")
        if filters.get("min_price") is not None:
            clauses.append("p.price >= ?")
            params.append(filters["min_price"])
        if filters.get("max_price") is not None:
            clauses.append("p.price <= ?")
            params.append(filters["max_price"])
        size = (filters.get("attributes") or {}).get("size")
        if size:
            clauses.append("p.id IN (SELECT product_id FROM product_variants WHERE size_name = ?)")
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

        sort = filters.get("sort", "relevance")
        if sort == "price_asc":
            ranked = sorted(ranked, key=lambda r: r["price"])
        elif sort == "price_desc":
            ranked = sorted(ranked, key=lambda r: -r["price"])

        results = [self._to_product(r) for r in ranked[:limit]]
        self.search_log.append({"query": q, "returned_ids": [p["product_id"] for p in results]})
        return results

    def get_product_details(self, product_id: str) -> dict[str, Any] | None:
        row = self._product_row(product_id)
        return self._to_details(row) if row is not None else None

    def _cart_rows(self, session_id: str) -> list[sqlite3.Row]:
        return self.conn.execute(
            "SELECT * FROM lab_cart_items WHERE session_id = ? ORDER BY id", (session_id,)
        ).fetchall()

    def _to_cart(self, session_id: str) -> dict[str, Any]:
        rows = self._cart_rows(session_id)
        items = [
            {"product_id": r["product_id"], "title": r["title"], "price": r["price"], "quantity": r["quantity"]}
            for r in rows
        ]
        return {"items": items, "currency": "USD", "subtotal": round(sum(i["price"] * i["quantity"] for i in items), 2)}

    def _ensure_cart_header(self, session_id: str) -> None:
        self.conn.execute(
            "INSERT INTO lab_cart (session_id, currency, updated_at) VALUES (?, 'USD', ?) "
            "ON CONFLICT(session_id) DO UPDATE SET updated_at = excluded.updated_at",
            (session_id, _now_iso()),
        )

    def get_cart(self, session_id: str) -> dict[str, Any]:
        return self._to_cart(session_id)

    def add_to_cart(self, session_id: str, product_id: str, quantity: int = 1) -> dict[str, Any]:
        row = self._product_row(product_id)
        if row is None:
            return {"error": f"unknown product_id {product_id}"}
        if not bool(row["is_active"]) or row["stock_quantity"] <= 0:
            return {"error": f"{product_id} is out of stock"}
        self._ensure_cart_header(session_id)
        existing = self.conn.execute(
            "SELECT quantity FROM lab_cart_items WHERE session_id = ? AND product_id = ?",
            (session_id, product_id),
        ).fetchone()
        new_quantity = (existing["quantity"] if existing else 0) + quantity
        self.conn.execute(
            "INSERT INTO lab_cart_items (session_id, product_id, title, price, quantity, added_at) "
            "VALUES (?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(session_id, product_id) DO UPDATE SET quantity = excluded.quantity",
            (session_id, product_id, row["name"], row["price"], new_quantity, _now_iso()),
        )
        self.conn.commit()
        return self._to_cart(session_id)

    def update_cart_item(self, session_id: str, product_id: str, quantity: int) -> dict[str, Any]:
        self.conn.execute(
            "UPDATE lab_cart_items SET quantity = ? WHERE session_id = ? AND product_id = ?",
            (quantity, session_id, product_id),
        )
        self.conn.commit()
        return self._to_cart(session_id)

    def remove_from_cart(self, session_id: str, product_id: str) -> dict[str, Any]:
        self.conn.execute(
            "DELETE FROM lab_cart_items WHERE session_id = ? AND product_id = ?",
            (session_id, product_id),
        )
        self.conn.commit()
        return self._to_cart(session_id)

    def _order_items(self, order_id: str) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            """SELECT oi.*, pv.product_id AS product_id
               FROM order_items oi JOIN product_variants pv ON pv.id = oi.product_variant_id
               WHERE oi.order_id = ?""",
            (order_id,),
        ).fetchall()
        return [
            {
                "product_id": r["product_id"],
                "title": r["product_name"],
                "quantity": r["quantity"],
                "price": r["price_at_purchase"],
            }
            for r in rows
        ]

    _SHIPPING_TO_STATUS = {"pending": "processing", "in_transit": "shipped", "delivered": "delivered"}

    def _to_order(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "order_id": row["id"],
            "status": self._SHIPPING_TO_STATUS.get(row["shipping_status"], "processing"),
            "created_at": row["created_at"],
            "items": self._order_items(row["id"]),
            "total_amount": row["total_amount"],
            "currency": "USD",
        }

    def get_order(self, user_id: str, order_id: str) -> dict[str, Any] | None:
        row = self.conn.execute(
            "SELECT * FROM orders WHERE id = ? AND user_id = ? AND status = 'paid'",
            (order_id, user_id),
        ).fetchone()
        return self._to_order(row) if row is not None else None

    def search_policies(self, query: str) -> list[dict[str, Any]]:
        rows = self.conn.execute("SELECT * FROM lab_policies").fetchall()
        query_terms = _terms(query)
        if not query_terms:
            return [{"policy_id": r["policy_id"], "title": r["title"], "content": r["content"]} for r in rows]
        scored = []
        for r in rows:
            heading_hits = len(query_terms & _terms(f"{r['title']} {r['category']}"))
            body_hits = len(query_terms & _terms(r["content"]))
            points = 2 * heading_hits + body_hits
            if points:
                scored.append((points, r))
        scored.sort(key=lambda pair: -pair[0])
        return [{"policy_id": r["policy_id"], "title": r["title"], "content": r["content"]} for _, r in scored]
