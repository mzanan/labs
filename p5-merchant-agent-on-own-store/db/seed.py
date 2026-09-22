"""Deterministic seed for noir.sqlite: 30 products, 2-4 variants each, 60 paid orders
over the 90 days before ANCHOR_DATE, one stock_movements row per sale, some
deliberately low-stock products and some unshipped old orders.

ANCHOR_DATE is a fixed calendar date, not datetime.now(), so re-running this script
always produces byte-identical data regardless of when it runs. That is what lets
scenarios.json hold exact expected numbers instead of ranges.

Run: python3 db/seed.py [--db-path PATH]
"""

from __future__ import annotations

import argparse
import json
import random
import sqlite3
from datetime import date, timedelta
from pathlib import Path

ANCHOR_DATE = date(2026, 9, 8)
SEED = 42

CATEGORIES = ["tops", "bottoms", "outerwear", "accessories", "footwear"]
SIZE_POOL = ["XS", "S", "M", "L", "XL", "XXL"]
LOW_STOCK_PRODUCT_IDXS = {2, 9, 17, 24}
PRODUCT_COUNT = 30
ORDER_COUNT = 60
ORDER_WINDOW_DAYS = 90
UNSHIPPED_OLD_THRESHOLD_DAYS = 10


def iso_date(d: date) -> str:
    return f"{d.isoformat()}T00:00:00Z"


def build_products(rng: random.Random) -> list[dict]:
    products = []
    for i in range(PRODUCT_COUNT):
        category = CATEGORIES[i % len(CATEGORIES)]
        base_stock = rng.randint(2, 8) if i in LOW_STOCK_PRODUCT_IDXS else rng.randint(20, 120)
        created_days_ago = rng.randint(30, 365)
        products.append(
            {
                "id": f"prod-{i:02d}",
                "name": f"{category.capitalize()} Item {i:02d}",
                "slug": f"{category}-item-{i:02d}",
                "description": f"A {category} piece from the NOIR catalog, item {i:02d}.",
                "price": round(rng.uniform(15, 180), 2),
                "is_featured": 1 if i % 10 == 0 else 0,
                "is_active": 1,
                "category_id": f"cat-{category}",
                "base_stock": base_stock,
                "created_at": iso_date(ANCHOR_DATE - timedelta(days=created_days_ago)),
            }
        )
    return products


def build_variants(rng: random.Random, products: list[dict]) -> list[dict]:
    variants = []
    for p_idx, product in enumerate(products):
        variant_count = rng.randint(2, 4)
        sizes = rng.sample(SIZE_POOL, variant_count)
        for v_idx, size in enumerate(sizes):
            variants.append(
                {
                    "id": f"var-{p_idx:02d}-{v_idx}",
                    "product_id": product["id"],
                    "size_name": size,
                    "created_at": product["created_at"],
                }
            )
    return variants


def build_orders(rng: random.Random) -> list[dict]:
    orders = []
    for i in range(ORDER_COUNT):
        days_ago = rng.randint(0, ORDER_WINDOW_DAYS - 1)
        order_date = ANCHOR_DATE - timedelta(days=days_ago)
        if days_ago > UNSHIPPED_OLD_THRESHOLD_DAYS:
            shipping_status = rng.choice(["delivered"] * 7 + ["pending"] * 2 + ["in_transit"] * 1)
        elif days_ago > 3:
            shipping_status = rng.choice(["in_transit"] * 5 + ["pending"] * 3 + ["delivered"] * 2)
        else:
            shipping_status = rng.choice(["pending"] * 6 + ["in_transit"] * 4)
        orders.append(
            {
                "id": f"order-{i:03d}",
                "user_id": f"user-{i % 25:03d}",
                "shipping_name": f"Customer {i:03d}",
                "shipping_address1": f"{100 + i} Main St",
                "shipping_address2": None,
                "shipping_city": "Ho Chi Minh City",
                "shipping_state": None,
                "shipping_postal_code": "700000",
                "shipping_country": "VN",
                "shipping_phone": None,
                "shipping_email": f"customer{i:03d}@example.com",
                "payment_intent_id": f"pi_lab_{i:03d}",
                "status": "paid",
                "shipping_status": shipping_status,
                "stripe_session_id": f"cs_lab_{i:03d}",
                "order_details": None,
                "days_ago": days_ago,
                "created_at": iso_date(order_date),
            }
        )
    orders.sort(key=lambda o: o["days_ago"], reverse=True)  # oldest first
    return orders


def build_items_and_movements(
    rng: random.Random, orders: list[dict], products: list[dict], variants: list[dict]
) -> tuple[list[dict], list[dict], dict[str, int]]:
    variants_by_product: dict[str, list[dict]] = {}
    for v in variants:
        variants_by_product.setdefault(v["product_id"], []).append(v)
    products_by_id = {p["id"]: p for p in products}
    running_stock = {p["id"]: p["base_stock"] for p in products}

    order_items = []
    stock_movements = []
    item_seq = 0
    movement_seq = 0

    for order in orders:
        item_count = rng.randint(1, 3)
        attempts = 0
        added = 0
        while added < item_count and attempts < item_count * 4:
            attempts += 1
            product = rng.choice(products)
            available = running_stock[product["id"]]
            if available <= 0:
                continue
            variant = rng.choice(variants_by_product[product["id"]])
            quantity = min(rng.randint(1, 3), available)
            running_stock[product["id"]] -= quantity

            item_seq += 1
            order_items.append(
                {
                    "id": f"item-{item_seq:04d}",
                    "order_id": order["id"],
                    "product_variant_id": variant["id"],
                    "quantity": quantity,
                    "price_at_purchase": product["price"],
                    "product_name": product["name"],
                    "product_size": variant["size_name"],
                    "created_at": order["created_at"],
                }
            )

            movement_seq += 1
            stock_movements.append(
                {
                    "id": f"mv-{movement_seq:04d}",
                    "product_id": product["id"],
                    "movement_type": "sale",
                    "quantity_change": -quantity,
                    "new_stock_level": running_stock[product["id"]],
                    "reference_type": "order",
                    "reference_id": order["id"],
                    "notes": None,
                    "created_at": order["created_at"],
                    "created_by": None,
                }
            )
            added += 1
        order["_item_count"] = added

    return order_items, stock_movements, running_stock


def compute_totals(orders: list[dict], order_items: list[dict]) -> None:
    totals: dict[str, float] = {}
    for item in order_items:
        totals[item["order_id"]] = totals.get(item["order_id"], 0.0) + round(
            item["price_at_purchase"] * item["quantity"], 2
        )
    for order in orders:
        order["total_amount"] = round(totals.get(order["id"], 0.0), 2)


def create_schema(conn: sqlite3.Connection, schema_path: Path) -> None:
    conn.executescript(schema_path.read_text())


def insert_all(
    conn: sqlite3.Connection,
    products: list[dict],
    variants: list[dict],
    orders: list[dict],
    order_items: list[dict],
    stock_movements: list[dict],
    final_stock: dict[str, int],
) -> None:
    conn.executemany(
        """INSERT INTO products
           (id, name, slug, description, price, is_featured, is_active, category_id,
            stock_quantity, created_at, updated_at)
           VALUES (:id, :name, :slug, :description, :price, :is_featured, :is_active,
                   :category_id, :stock_quantity, :created_at, :updated_at)""",
        [
            {
                **p,
                "stock_quantity": final_stock[p["id"]],
                "updated_at": p["created_at"],
            }
            for p in products
        ],
    )
    conn.executemany(
        """INSERT INTO product_variants (id, product_id, size_name, created_at, updated_at)
           VALUES (:id, :product_id, :size_name, :created_at, :created_at)""",
        variants,
    )
    conn.executemany(
        """INSERT INTO orders
           (id, user_id, shipping_name, shipping_address1, shipping_address2, shipping_city,
            shipping_state, shipping_postal_code, shipping_country, shipping_phone,
            shipping_email, total_amount, payment_intent_id, status, shipping_status,
            stripe_session_id, order_details, created_at, updated_at)
           VALUES (:id, :user_id, :shipping_name, :shipping_address1, :shipping_address2,
                   :shipping_city, :shipping_state, :shipping_postal_code, :shipping_country,
                   :shipping_phone, :shipping_email, :total_amount, :payment_intent_id,
                   :status, :shipping_status, :stripe_session_id, :order_details,
                   :created_at, :created_at)""",
        orders,
    )
    conn.executemany(
        """INSERT INTO order_items
           (id, order_id, product_variant_id, quantity, price_at_purchase, product_name,
            product_size, created_at)
           VALUES (:id, :order_id, :product_variant_id, :quantity, :price_at_purchase,
                   :product_name, :product_size, :created_at)""",
        order_items,
    )
    conn.executemany(
        """INSERT INTO stock_movements
           (id, product_id, movement_type, quantity_change, new_stock_level, reference_type,
            reference_id, notes, created_at, created_by)
           VALUES (:id, :product_id, :movement_type, :quantity_change, :new_stock_level,
                   :reference_type, :reference_id, :notes, :created_at, :created_by)""",
        stock_movements,
    )


def print_report(conn: sqlite3.Connection) -> None:
    cur = conn.cursor()
    anchor = ANCHOR_DATE.isoformat()

    cur.execute(
        """SELECT COALESCE(SUM(oi.quantity * oi.price_at_purchase), 0)
           FROM order_items oi JOIN orders o ON o.id = oi.order_id
           WHERE o.status = 'paid' AND date(o.created_at) > date(?, '-30 days')
             AND date(o.created_at) <= date(?)""",
        (anchor, anchor),
    )
    sales_last_30 = round(cur.fetchone()[0], 2)

    cur.execute(
        """SELECT COALESCE(SUM(oi.quantity * oi.price_at_purchase), 0)
           FROM order_items oi JOIN orders o ON o.id = oi.order_id
           WHERE o.status = 'paid' AND date(o.created_at) > date(?, '-60 days')
             AND date(o.created_at) <= date(?, '-30 days')""",
        (anchor, anchor),
    )
    sales_prev_30 = round(cur.fetchone()[0], 2)

    cur.execute(
        """SELECT id, name, stock_quantity FROM products
           ORDER BY stock_quantity ASC, id ASC LIMIT 3"""
    )
    lowest_stock = cur.fetchall()

    cur.execute(
        """SELECT COUNT(*) FROM orders
           WHERE status = 'paid' AND shipping_status = 'pending'
             AND date(created_at) <= date(?, ?)""",
        (anchor, f"-{UNSHIPPED_OLD_THRESHOLD_DAYS} days"),
    )
    unshipped_old = cur.fetchone()[0]

    cur.execute(
        """SELECT p.category_id, COALESCE(SUM(oi.quantity * oi.price_at_purchase), 0) AS rev
           FROM order_items oi
           JOIN product_variants pv ON pv.id = oi.product_variant_id
           JOIN products p ON p.id = pv.product_id
           JOIN orders o ON o.id = oi.order_id
           WHERE o.status = 'paid'
           GROUP BY p.category_id ORDER BY rev DESC LIMIT 1"""
    )
    top_category = cur.fetchone()

    cur.execute(
        """SELECT p.id, p.name, COALESCE(SUM(oi.quantity), 0) AS units_sold
           FROM products p
           LEFT JOIN product_variants pv ON pv.product_id = p.id
           LEFT JOIN order_items oi ON oi.product_variant_id = pv.id
           GROUP BY p.id ORDER BY units_sold ASC, p.id ASC LIMIT 1"""
    )
    worst_seller = cur.fetchone()

    report = {
        "anchor_date": anchor,
        "sales_last_30d": sales_last_30,
        "sales_prev_30d": sales_prev_30,
        "lowest_stock_products": [
            {"id": r[0], "name": r[1], "stock": r[2]} for r in lowest_stock
        ],
        "unshipped_orders_older_than_10d": unshipped_old,
        "top_category": {"category_id": top_category[0], "revenue": round(top_category[1], 2)},
        "worst_seller_by_units": {
            "id": worst_seller[0],
            "name": worst_seller[1],
            "units_sold": worst_seller[2],
        },
    }
    print(json.dumps(report, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db-path", default=str(Path(__file__).parent / "noir.sqlite"))
    args = parser.parse_args()

    db_path = Path(args.db_path)
    if db_path.exists():
        db_path.unlink()

    rng = random.Random(SEED)
    products = build_products(rng)
    variants = build_variants(rng, products)
    orders = build_orders(rng)
    order_items, stock_movements, final_stock = build_items_and_movements(
        rng, orders, products, variants
    )
    compute_totals(orders, order_items)

    conn = sqlite3.connect(db_path)
    try:
        create_schema(conn, Path(__file__).parent / "schema.sql")
        insert_all(conn, products, variants, orders, order_items, stock_movements, final_stock)
        conn.commit()
        print_report(conn)
    finally:
        conn.close()

    print(f"\nSeeded {db_path} ({PRODUCT_COUNT} products, {len(variants)} variants, "
          f"{ORDER_COUNT} orders, {len(order_items)} order_items, "
          f"{len(stock_movements)} stock_movements).")


if __name__ == "__main__":
    main()
