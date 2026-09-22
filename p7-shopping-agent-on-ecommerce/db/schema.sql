-- Local SQLite mirror of personal/ecommerce's real schema (src/db/schema.ts, 559 lines,
-- 22 tables at read time). Only the tables relevant to StorefrontBackend are mirrored
-- (see spec-shopping-agent-on-ecommerce-2026-09-13.md): products, product_variants,
-- product_images, product_categories, category_sizes, sets, set_products, orders,
-- order_items, pending_orders, country_shipping_prices, user, app_settings. Tables with
-- no bearing on a shopping agent (session, account, verification, admin_users,
-- size_guide_templates, set_images, hero_content, page_components, homepage_layout) are
-- left out on purpose, not missed.
--
-- Postgres -> SQLite type approximations (per the spec, recorded here since this is the
-- source of truth for the mirror): uuid -> TEXT (seeded as real UUID v4 strings, not
-- slugs, since that is what the real schema stores); boolean -> INTEGER 0/1;
-- numeric/decimal -> REAL (Postgres numeric is arbitrary-precision; SQLite REAL is
-- float64, a real approximation for currency but the same one p5/p7's NOIR mirrors
-- already made); timestamptz -> TEXT ISO 8601; jsonb -> TEXT (json-encoded).
--
-- Two things noted, not fixed, because personal/ecommerce is read-only for this lab:
-- schema.ts declares orderStatusEnum (8 values) and paymentStatusEnum but orders.status
-- is a plain text column defaulting to "processing", using neither enum; this mirror
-- keeps that as-is rather than tightening it. Likewise shippingStatus's own CHECK only
-- allows pending/in_transit/delivered, the same 3 states NOIR had.

PRAGMA foreign_keys = ON;

CREATE TABLE user (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE product_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  size_guide_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE category_sizes (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES product_categories(id),
  size_name TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  price REAL NOT NULL CHECK (price >= 0),
  is_featured INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  category_id TEXT REFERENCES product_categories(id),
  stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE product_images (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  image_url TEXT NOT NULL,
  alt_text TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE product_variants (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  size_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  type TEXT CHECK (type IN ('DAY', 'NIGHT')),
  layout_type TEXT,
  show_title_on_home INTEGER NOT NULL DEFAULT 1,
  total_price REAL NOT NULL DEFAULT 0,
  final_price REAL NOT NULL DEFAULT 0,
  discount_percentage REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE set_products (
  set_id TEXT NOT NULL REFERENCES sets(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  position INTEGER NOT NULL DEFAULT 0,
  quantity INTEGER,
  PRIMARY KEY (set_id, product_id)
);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  shipping_name TEXT NOT NULL,
  shipping_address1 TEXT NOT NULL,
  shipping_address2 TEXT,
  shipping_city TEXT NOT NULL,
  shipping_state TEXT,
  shipping_postal_code TEXT NOT NULL,
  shipping_country TEXT NOT NULL,
  shipping_phone TEXT,
  shipping_email TEXT,
  total_amount REAL NOT NULL,
  payment_intent_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'processing',
  shipping_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (shipping_status IN ('pending', 'in_transit', 'delivered')),
  stripe_session_id TEXT,
  order_details TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  product_variant_id TEXT NOT NULL REFERENCES product_variants(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  price_at_purchase REAL NOT NULL CHECK (price_at_purchase >= 0),
  product_name TEXT NOT NULL,
  product_size TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE pending_orders (
  payment_intent_id TEXT PRIMARY KEY,
  shipping TEXT NOT NULL,
  items TEXT NOT NULL,
  shipping_price REAL NOT NULL DEFAULT 0,
  total_amount REAL NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE country_shipping_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  country_code TEXT NOT NULL UNIQUE,
  country_name TEXT,
  shipping_price REAL NOT NULL DEFAULT 0,
  min_delivery_days INTEGER NOT NULL DEFAULT 3,
  max_delivery_days INTEGER NOT NULL DEFAULT 7,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Lab-only tables below. None of these exist in personal/ecommerce's real schema; see
-- adapter/mapping.md for what each one stands in for and why. The safety checksum in
-- run_lab.py only ever covers the real tables above, never these.

CREATE TABLE lab_cart (
  session_id TEXT PRIMARY KEY,
  currency TEXT NOT NULL DEFAULT 'USD',
  updated_at TEXT NOT NULL
);

CREATE TABLE lab_cart_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES lab_cart(session_id),
  product_id TEXT NOT NULL REFERENCES products(id),
  title TEXT NOT NULL,
  price REAL NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  added_at TEXT NOT NULL,
  UNIQUE (session_id, product_id)
);

CREATE TABLE lab_preferences (
  user_id TEXT PRIMARY KEY REFERENCES user(id),
  display_name TEXT NOT NULL,
  loyalty_tier TEXT NOT NULL,
  default_location TEXT NOT NULL,
  preferences TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE lab_policies (
  policy_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT,
  content TEXT NOT NULL
);

-- Pickup has no equivalent anywhere in personal/ecommerce (no store-location table, no
-- pickup concept); this table exists only so the agent has a pickup option to offer.
-- Standard delivery fees are NOT lab-invented: get_fulfillment_options in the adapter
-- reads country_shipping_prices for those, keyed off the customer's lab_preferences
-- default_location.
CREATE TABLE lab_pickup_options (
  id TEXT PRIMARY KEY,
  eta TEXT NOT NULL,
  fee REAL NOT NULL DEFAULT 0.0,
  location TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_products_category_id ON products(category_id);
CREATE INDEX idx_products_is_active ON products(is_active);
CREATE INDEX idx_products_slug ON products(slug);
CREATE INDEX idx_variants_product_id ON product_variants(product_id);
CREATE INDEX idx_product_images_product_id ON product_images(product_id);
CREATE INDEX idx_sets_is_active ON sets(is_active);
CREATE INDEX idx_sets_slug ON sets(slug);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created_at ON orders(created_at);
CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_order_items_order_id ON order_items(order_id);
CREATE INDEX idx_order_items_variant_id ON order_items(product_variant_id);
CREATE INDEX idx_lab_cart_items_session_id ON lab_cart_items(session_id);
