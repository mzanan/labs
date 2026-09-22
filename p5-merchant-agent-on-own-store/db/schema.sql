-- NOIR schema translated to SQLite for the merchant agent lab.
-- Source: personal/ecommerce/supabase/migrations/001_initial_schema.sql (products,
-- product_variants, orders, order_items) and 005_stock_management.sql (stock_movements).
-- UUID -> TEXT, NUMERIC -> REAL, TIMESTAMPTZ -> TEXT (ISO 8601), JSONB -> TEXT.
-- Column names kept identical to the Postgres source so a later Postgres adapter is a
-- driver swap, not a rewrite.

PRAGMA foreign_keys = ON;

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  price REAL NOT NULL CHECK (price >= 0),
  is_featured INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  category_id TEXT,
  stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE product_variants (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  size_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
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

CREATE TABLE stock_movements (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  movement_type TEXT NOT NULL CHECK (movement_type IN ('sale', 'restock', 'adjustment', 'return')),
  quantity_change INTEGER NOT NULL,
  new_stock_level INTEGER NOT NULL,
  reference_type TEXT,
  reference_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT
);

-- Lab-only table: where MerchantBackend.stage_* write proposals land. Never one of the
-- 5 NOIR tables above; apply_change is gated and, in this lab, always refused (no
-- approval surface exists), so this table only ever grows staged rows, never applies.
CREATE TABLE lab_staged_changes (
  change_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'staged',
  summary TEXT NOT NULL,
  items TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_by_kind TEXT NOT NULL DEFAULT 'agent',
  applied_at TEXT,
  applied_by TEXT,
  discarded_at TEXT,
  discarded_by TEXT,
  discarded_by_kind TEXT,
  guardrail_notes TEXT,
  currency TEXT,
  margin_impact REAL,
  margin_before_pct REAL,
  margin_after_pct REAL
);

CREATE INDEX idx_products_category_id ON products(category_id);
CREATE INDEX idx_products_is_active ON products(is_active);
CREATE INDEX idx_variants_product_id ON product_variants(product_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_shipping_status ON orders(shipping_status);
CREATE INDEX idx_orders_created_at ON orders(created_at);
CREATE INDEX idx_order_items_order_id ON order_items(order_id);
CREATE INDEX idx_order_items_variant_id ON order_items(product_variant_id);
CREATE INDEX idx_stock_movements_product_id ON stock_movements(product_id);
CREATE INDEX idx_stock_movements_created_at ON stock_movements(created_at);
