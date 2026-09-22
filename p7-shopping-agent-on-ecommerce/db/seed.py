"""Deterministic seed for ecommerce_mirror.sqlite: a local mirror of personal/ecommerce's
real schema (src/db/schema.ts), never the Neon production database. Same ANCHOR_DATE and
SEED as the NOIR labs (p5-merchant-agent-on-own-store, the old p7 run) so order counts and
the 90-day window stay comparable, but every id is a real UUID v4 string (uuid.uuid5,
namespace-keyed off a stable label, so re-running this script is byte-identical) since
that is what the real schema actually stores, not a slug like "prod-00".

Tables mirrored: user, product_categories, category_sizes, products, product_images,
product_variants, sets, set_products, orders, order_items, pending_orders,
country_shipping_prices, app_settings (all real), plus this lab's own lab_cart,
lab_cart_items, lab_preferences, lab_policies, lab_pickup_options (none of which exist in
personal/ecommerce; see adapter/mapping.md).

Run: python3 db/seed.py [--db-path PATH]
"""

from __future__ import annotations

import argparse
import json
import random
import sqlite3
import uuid
from datetime import date, timedelta
from pathlib import Path

ANCHOR_DATE = date(2026, 9, 8)
SEED = 42
NAMESPACE = uuid.UUID("6f6f6f6f-6f6f-6f6f-6f6f-6f6f6f6f6f6f")

CATEGORIES = ["Tops", "Bottoms", "Outerwear", "Accessories", "Footwear"]
CATEGORY_SIZES = {
    "Tops": ["XS", "S", "M", "L", "XL", "XXL"],
    "Bottoms": ["XS", "S", "M", "L", "XL", "XXL"],
    "Outerwear": ["XS", "S", "M", "L", "XL", "XXL"],
    "Accessories": ["One Size"],
    "Footwear": ["38", "39", "40", "41", "42", "43", "44"],
}
LOW_STOCK_PRODUCT_IDXS = {2, 9, 17, 24}
PRODUCT_COUNT = 30
ORDER_COUNT = 60
ORDER_WINDOW_DAYS = 90
UNSHIPPED_OLD_THRESHOLD_DAYS = 10
USER_COUNT = 25
LOYALTY_TIERS = ["bronze", "silver", "gold"]

COUNTRIES = [
    {"code": "VN", "name": "Vietnam", "price": 5.99, "min_days": 3, "max_days": 5},
    {"code": "TH", "name": "Thailand", "price": 9.5, "min_days": 4, "max_days": 8},
    {"code": "SG", "name": "Singapore", "price": 8.0, "min_days": 3, "max_days": 6},
    {"code": "US", "name": "United States", "price": 18.0, "min_days": 7, "max_days": 14},
    {"code": "AU", "name": "Australia", "price": 16.5, "min_days": 6, "max_days": 12},
]

LAB_POLICIES = [
    {
        "policy_id": "pol-returns",
        "title": "Returns and refunds",
        "category": "returns",
        "content": (
            "Items may be returned within 30 days of delivery for a full refund to the "
            "original payment method, provided the item is unworn, unwashed, and has its "
            "original tags attached. Footwear must be returned with the original box. "
            "Refunds post within 5-7 business days of the returned item reaching our "
            "warehouse. Sale items marked 'final sale' cannot be returned."
        ),
    },
    {
        "policy_id": "pol-exchanges",
        "title": "Exchanges",
        "category": "returns",
        "content": (
            "Size and color exchanges are free within the same 30-day return window. "
            "Request an exchange instead of a return and we ship the replacement as soon "
            "as the original item scans in at our warehouse."
        ),
    },
    {
        "policy_id": "pol-warranty",
        "title": "Product warranty",
        "category": "warranty",
        "content": (
            "Garments carry a 90-day warranty against manufacturing defects (seam "
            "failure, faulty zippers, or hardware). Normal wear, accidental damage, and "
            "improper care are not covered. Contact support with your order number and "
            "photos of the defect."
        ),
    },
    {
        "policy_id": "pol-price-match",
        "title": "Price adjustments",
        "category": "pricing",
        "content": (
            "If an item you purchased drops in price on our own store within 7 days of "
            "your order, we refund the difference on request. We do not match other "
            "retailers' prices."
        ),
    },
]

LAB_PICKUP_OPTIONS = [
    {
        "id": "pickup-hcmc",
        "eta": "ready in 2 hours",
        "fee": 0.0,
        "location": "Flagship store, Ho Chi Minh City",
    },
]


def uid(label: str) -> str:
    return str(uuid.uuid5(NAMESPACE, label))


def iso_date(d: date) -> str:
    return f"{d.isoformat()}T00:00:00Z"


def build_categories() -> list[dict]:
    now = iso_date(ANCHOR_DATE - timedelta(days=400))
    return [
        {"id": uid(f"category:{name}"), "name": name, "created_at": now, "updated_at": now}
        for name in CATEGORIES
    ]


def build_category_sizes(categories: list[dict]) -> list[dict]:
    now = iso_date(ANCHOR_DATE - timedelta(days=400))
    rows = []
    for category in categories:
        for order, size in enumerate(CATEGORY_SIZES[category["name"]]):
            rows.append(
                {
                    "id": uid(f"category-size:{category['name']}:{size}"),
                    "category_id": category["id"],
                    "size_name": size,
                    "display_order": order,
                    "created_at": now,
                }
            )
    return rows


def build_products(rng: random.Random, categories: list[dict]) -> list[dict]:
    products = []
    for i in range(PRODUCT_COUNT):
        category = categories[i % len(categories)]
        cat_name = category["name"]
        base_stock = rng.randint(2, 8) if i in LOW_STOCK_PRODUCT_IDXS else rng.randint(20, 120)
        created_days_ago = rng.randint(30, 365)
        products.append(
            {
                "id": uid(f"product:{i:02d}"),
                "name": f"{cat_name} Item {i:02d}",
                "slug": f"{cat_name.lower()}-item-{i:02d}",
                "description": f"A {cat_name.lower()} piece from the demo catalog, item {i:02d}.",
                "price": round(rng.uniform(15, 180), 2),
                "is_featured": 1 if i % 10 == 0 else 0,
                "is_active": 1,
                "category_id": category["id"],
                "category_name": cat_name,
                "base_stock": base_stock,
                "created_at": iso_date(ANCHOR_DATE - timedelta(days=created_days_ago)),
            }
        )
    return products


def build_images(products: list[dict]) -> list[dict]:
    images = []
    for product in products:
        n_images = 1 if int(product["id"][-1], 16) % 2 == 0 else 2
        for n in range(n_images):
            images.append(
                {
                    "id": uid(f"image:{product['id']}:{n}"),
                    "product_id": product["id"],
                    "image_url": f"https://demo.public.blob.vercel-storage.com/{product['slug']}-{n}.jpg",
                    "alt_text": product["name"],
                    "position": n,
                    "created_at": product["created_at"],
                }
            )
    return images


def build_variants(rng: random.Random, products: list[dict]) -> list[dict]:
    variants = []
    for product in products:
        size_pool = CATEGORY_SIZES[product["category_name"]]
        variant_count = min(len(size_pool), rng.randint(2, 4))
        sizes = rng.sample(size_pool, variant_count)
        for v_idx, size in enumerate(sizes):
            variants.append(
                {
                    "id": uid(f"variant:{product['id']}:{size}"),
                    "product_id": product["id"],
                    "size_name": size,
                    "created_at": product["created_at"],
                }
            )
    return variants


def build_sets(products: list[dict]) -> tuple[list[dict], list[dict]]:
    now = iso_date(ANCHOR_DATE - timedelta(days=200))
    defs = [
        {"name": "Day Capsule", "type": "DAY", "layout": "STAGGERED_THREE", "idxs": [0, 1, 4]},
        {"name": "Night Out", "type": "NIGHT", "layout": "SPLIT_SMALL_RIGHT", "idxs": [2, 3]},
    ]
    sets_rows = []
    set_products_rows = []
    for d in defs:
        set_id = uid(f"set:{d['name']}")
        picks = [products[i] for i in d["idxs"]]
        total = round(sum(p["price"] for p in picks), 2)
        sets_rows.append(
            {
                "id": set_id,
                "name": d["name"],
                "slug": d["name"].lower().replace(" ", "-"),
                "description": f"A {d['type'].lower()} capsule of {len(picks)} pieces.",
                "is_active": 1,
                "type": d["type"],
                "layout_type": d["layout"],
                "show_title_on_home": 1,
                "total_price": total,
                "final_price": total,
                "discount_percentage": 0,
                "created_at": now,
                "updated_at": now,
            }
        )
        for pos, product in enumerate(picks):
            set_products_rows.append(
                {"set_id": set_id, "product_id": product["id"], "position": pos, "quantity": 1}
            )
    return sets_rows, set_products_rows


def build_orders(rng: random.Random, users: list[dict]) -> list[dict]:
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
        user = users[i % USER_COUNT]
        orders.append(
            {
                "id": uid(f"order:{i:03d}"),
                "user_id": user["id"],
                "shipping_name": user["name"],
                "shipping_address1": f"{100 + i} Main St",
                "shipping_address2": None,
                "shipping_city": "Ho Chi Minh City",
                "shipping_state": None,
                "shipping_postal_code": "700000",
                "shipping_country": "VN",
                "shipping_phone": None,
                "shipping_email": user["email"],
                "payment_intent_id": f"pi_lab_{i:03d}",
                "status": "paid",
                "shipping_status": shipping_status,
                "stripe_session_id": f"cs_lab_{i:03d}",
                "order_details": None,
                "days_ago": days_ago,
                "created_at": iso_date(order_date),
            }
        )
    orders.sort(key=lambda o: o["days_ago"], reverse=True)
    for idx, order in enumerate(orders):
        order["index"] = idx
    return orders


def build_items(
    rng: random.Random, orders: list[dict], products: list[dict], variants: list[dict]
) -> tuple[list[dict], dict[str, int]]:
    variants_by_product: dict[str, list[dict]] = {}
    for v in variants:
        variants_by_product.setdefault(v["product_id"], []).append(v)
    running_stock = {p["id"]: p["base_stock"] for p in products}

    order_items = []
    item_seq = 0
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
                    "id": uid(f"item:{item_seq:04d}"),
                    "order_id": order["id"],
                    "product_variant_id": variant["id"],
                    "quantity": quantity,
                    "price_at_purchase": product["price"],
                    "product_name": product["name"],
                    "product_size": variant["size_name"],
                    "created_at": order["created_at"],
                }
            )
            added += 1
        order["_item_count"] = added
    return order_items, running_stock


def compute_totals(orders: list[dict], order_items: list[dict]) -> None:
    totals: dict[str, float] = {}
    for item in order_items:
        totals[item["order_id"]] = totals.get(item["order_id"], 0.0) + round(
            item["price_at_purchase"] * item["quantity"], 2
        )
    for order in orders:
        order["total_amount"] = round(totals.get(order["id"], 0.0), 2)


def build_pending_orders(rng: random.Random, users: list[dict]) -> list[dict]:
    rows = []
    for i in range(3):
        user = users[i]
        rows.append(
            {
                "payment_intent_id": f"pi_pending_lab_{i:03d}",
                "shipping": json.dumps({"name": user["name"], "country": "VN"}),
                "items": json.dumps([]),
                "shipping_price": 5.99,
                "total_amount": round(rng.uniform(20, 200), 2),
                "created_at": iso_date(ANCHOR_DATE - timedelta(days=rng.randint(0, 2))),
            }
        )
    return rows


def build_users(rng: random.Random) -> list[dict]:
    now = iso_date(ANCHOR_DATE - timedelta(days=200))
    rows = []
    for i in range(USER_COUNT):
        rows.append(
            {
                "id": f"user-{i:03d}",
                "name": f"Customer {i:03d}",
                "email": f"customer{i:03d}@example.com",
                "email_verified": 1,
                "image": None,
                "created_at": now,
                "updated_at": now,
            }
        )
    return rows


def build_lab_preferences(rng: random.Random, users: list[dict]) -> list[dict]:
    country_names = [c["name"] for c in COUNTRIES]
    rows = []
    for i, user in enumerate(users):
        rows.append(
            {
                "user_id": user["id"],
                "display_name": user["name"],
                "loyalty_tier": rng.choice(LOYALTY_TIERS),
                "default_location": country_names[i % len(country_names)],
                "preferences": json.dumps({"preferred_category": rng.choice(CATEGORIES)}),
            }
        )
    return rows


def build_app_settings() -> list[dict]:
    return [
        {
            "key": "about_content",
            "value": json.dumps(
                {"text_content": "Tell your story here.", "image_urls": []}
            ),
        },
    ]


def create_schema(conn: sqlite3.Connection, schema_path: Path) -> None:
    conn.executescript(schema_path.read_text())


def insert_all(conn: sqlite3.Connection, data: dict) -> None:
    conn.executemany(
        "INSERT INTO user (id, name, email, email_verified, image, created_at, updated_at) "
        "VALUES (:id, :name, :email, :email_verified, :image, :created_at, :updated_at)",
        data["users"],
    )
    conn.executemany(
        "INSERT INTO product_categories (id, name, size_guide_id, created_at, updated_at) "
        "VALUES (:id, :name, NULL, :created_at, :updated_at)",
        data["categories"],
    )
    conn.executemany(
        "INSERT INTO category_sizes (id, category_id, size_name, display_order, created_at) "
        "VALUES (:id, :category_id, :size_name, :display_order, :created_at)",
        data["category_sizes"],
    )
    conn.executemany(
        """INSERT INTO products
           (id, name, slug, description, price, is_featured, is_active, category_id,
            stock_quantity, created_at, updated_at)
           VALUES (:id, :name, :slug, :description, :price, :is_featured, :is_active,
                   :category_id, :stock_quantity, :created_at, :updated_at)""",
        [
            {**p, "stock_quantity": data["final_stock"][p["id"]], "updated_at": p["created_at"]}
            for p in data["products"]
        ],
    )
    conn.executemany(
        "INSERT INTO product_images (id, product_id, image_url, alt_text, position, created_at) "
        "VALUES (:id, :product_id, :image_url, :alt_text, :position, :created_at)",
        data["images"],
    )
    conn.executemany(
        "INSERT INTO product_variants (id, product_id, size_name, created_at, updated_at) "
        "VALUES (:id, :product_id, :size_name, :created_at, :created_at)",
        data["variants"],
    )
    conn.executemany(
        """INSERT INTO sets
           (id, name, slug, description, is_active, type, layout_type, show_title_on_home,
            total_price, final_price, discount_percentage, created_at, updated_at)
           VALUES (:id, :name, :slug, :description, :is_active, :type, :layout_type,
                   :show_title_on_home, :total_price, :final_price, :discount_percentage,
                   :created_at, :updated_at)""",
        data["sets"],
    )
    conn.executemany(
        "INSERT INTO set_products (set_id, product_id, position, quantity) "
        "VALUES (:set_id, :product_id, :position, :quantity)",
        data["set_products"],
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
        data["orders"],
    )
    conn.executemany(
        """INSERT INTO order_items
           (id, order_id, product_variant_id, quantity, price_at_purchase, product_name,
            product_size, created_at)
           VALUES (:id, :order_id, :product_variant_id, :quantity, :price_at_purchase,
                   :product_name, :product_size, :created_at)""",
        data["order_items"],
    )
    conn.executemany(
        """INSERT INTO pending_orders
           (payment_intent_id, shipping, items, shipping_price, total_amount, created_at)
           VALUES (:payment_intent_id, :shipping, :items, :shipping_price, :total_amount,
                   :created_at)""",
        data["pending_orders"],
    )
    conn.executemany(
        """INSERT INTO country_shipping_prices
           (country_code, country_name, shipping_price, min_delivery_days, max_delivery_days,
            created_at, updated_at)
           VALUES (:code, :name, :price, :min_days, :max_days, :created_at, :updated_at)""",
        [{**c, "created_at": iso_date(ANCHOR_DATE - timedelta(days=300)),
          "updated_at": iso_date(ANCHOR_DATE - timedelta(days=300))} for c in COUNTRIES],
    )
    conn.executemany(
        "INSERT INTO app_settings (key, value) VALUES (:key, :value)", data["app_settings"]
    )
    conn.executemany(
        """INSERT INTO lab_preferences
           (user_id, display_name, loyalty_tier, default_location, preferences)
           VALUES (:user_id, :display_name, :loyalty_tier, :default_location, :preferences)""",
        data["lab_preferences"],
    )
    conn.executemany(
        "INSERT INTO lab_policies (policy_id, title, category, content) "
        "VALUES (:policy_id, :title, :category, :content)",
        LAB_POLICIES,
    )
    conn.executemany(
        "INSERT INTO lab_pickup_options (id, eta, fee, location) "
        "VALUES (:id, :eta, :fee, :location)",
        LAB_PICKUP_OPTIONS,
    )


def print_report(conn: sqlite3.Connection) -> None:
    cur = conn.cursor()
    anchor = ANCHOR_DATE.isoformat()

    cur.execute(
        """SELECT COALESCE(SUM(oi.quantity * oi.price_at_purchase), 0)
           FROM order_items oi JOIN orders o ON o.id = oi.order_id
           WHERE date(o.created_at) > date(?, '-30 days') AND date(o.created_at) <= date(?)""",
        (anchor, anchor),
    )
    sales_last_30 = round(cur.fetchone()[0], 2)

    cur.execute("SELECT id, name, stock_quantity FROM products ORDER BY stock_quantity ASC, id ASC LIMIT 3")
    lowest_stock = cur.fetchall()

    cur.execute(
        """SELECT COUNT(*) FROM orders
           WHERE shipping_status = 'pending' AND date(created_at) <= date(?, ?)""",
        (anchor, f"-{UNSHIPPED_OLD_THRESHOLD_DAYS} days"),
    )
    unshipped_old = cur.fetchone()[0]

    report = {
        "anchor_date": anchor,
        "sales_last_30d": sales_last_30,
        "lowest_stock_products": [{"id": r[0], "name": r[1], "stock": r[2]} for r in lowest_stock],
        "unshipped_orders_older_than_10d": unshipped_old,
    }
    print(json.dumps(report, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db-path", default=str(Path(__file__).parent / "ecommerce_mirror.sqlite"))
    args = parser.parse_args()

    db_path = Path(args.db_path)
    if db_path.exists():
        db_path.unlink()

    rng = random.Random(SEED)
    categories = build_categories()
    category_sizes = build_category_sizes(categories)
    products = build_products(rng, categories)
    images = build_images(products)
    variants = build_variants(rng, products)
    sets_rows, set_products_rows = build_sets(products)
    users = build_users(rng)
    orders = build_orders(rng, users)
    order_items, final_stock = build_items(rng, orders, products, variants)
    compute_totals(orders, order_items)
    pending_orders = build_pending_orders(rng, users)
    lab_preferences = build_lab_preferences(rng, users)
    app_settings = build_app_settings()

    conn = sqlite3.connect(db_path)
    try:
        create_schema(conn, Path(__file__).parent / "schema.sql")
        insert_all(
            conn,
            {
                "users": users,
                "categories": categories,
                "category_sizes": category_sizes,
                "products": products,
                "images": images,
                "variants": variants,
                "sets": sets_rows,
                "set_products": set_products_rows,
                "orders": orders,
                "order_items": order_items,
                "final_stock": final_stock,
                "pending_orders": pending_orders,
                "lab_preferences": lab_preferences,
                "app_settings": app_settings,
            },
        )
        conn.commit()
        print_report(conn)
    finally:
        conn.close()

    print(
        f"\nSeeded {db_path} ({PRODUCT_COUNT} products, {len(variants)} variants, "
        f"{len(images)} product_images, {len(categories)} categories, "
        f"{len(category_sizes)} category_sizes, {len(sets_rows)} sets, "
        f"{ORDER_COUNT} orders, {len(order_items)} order_items, "
        f"{len(pending_orders)} pending_orders, {len(COUNTRIES)} country_shipping_prices, "
        f"{len(users)} users, {len(lab_preferences)} lab_preferences, "
        f"{len(LAB_POLICIES)} lab_policies, {len(LAB_PICKUP_OPTIONS)} lab_pickup_options)."
    )


if __name__ == "__main__":
    main()
