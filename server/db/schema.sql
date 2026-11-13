-- 蟳埔花事 · 后端数据结构
-- 金额一律以「分」为整数存储，避免浮点误差

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  name          TEXT    NOT NULL DEFAULT '',
  role          TEXT    NOT NULL DEFAULT 'admin',
  last_login_at TEXT,
  created_at    TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT    NOT NULL UNIQUE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT    NOT NULL,
  ip         TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- 顾客账号（前台注册登录）
CREATE TABLE IF NOT EXISTS customers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  phone         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  nickname      TEXT    NOT NULL DEFAULT '',
  email         TEXT,
  status        TEXT    NOT NULL DEFAULT 'active',
  last_login_at TEXT,
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash  TEXT    NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL,
  created_at  TEXT    NOT NULL,
  ip          TEXT
);
CREATE INDEX IF NOT EXISTS idx_customer_sessions ON customer_sessions(customer_id);

CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  name_en     TEXT    NOT NULL DEFAULT '',
  category    TEXT    NOT NULL,
  categories  TEXT    NOT NULL DEFAULT '[]',
  tagline     TEXT    NOT NULL DEFAULT '',
  description TEXT    NOT NULL DEFAULT '',
  specs       TEXT    NOT NULL DEFAULT '[]',
  badges      TEXT    NOT NULL DEFAULT '[]',
  image       TEXT    NOT NULL DEFAULT '',
  unit        TEXT    NOT NULL DEFAULT '件',
  price_from  INTEGER NOT NULL DEFAULT 0,
  compare_at  INTEGER,
  is_limited  INTEGER NOT NULL DEFAULT 0,
  featured    INTEGER NOT NULL DEFAULT 0,
  status      TEXT    NOT NULL DEFAULT 'active',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category, status);

CREATE TABLE IF NOT EXISTS variants (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku        TEXT    NOT NULL UNIQUE,
  name       TEXT    NOT NULL,
  price      INTEGER NOT NULL,
  stock      INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status     TEXT    NOT NULL DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS idx_variants_product ON variants(product_id, sort_order);

CREATE TABLE IF NOT EXISTS carts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  token       TEXT    NOT NULL UNIQUE,
  customer_id INTEGER,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS cart_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  cart_id    INTEGER NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  variant_id INTEGER NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  qty        INTEGER NOT NULL,
  added_at   TEXT    NOT NULL,
  UNIQUE (cart_id, variant_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no      TEXT    NOT NULL UNIQUE,
  customer_id   INTEGER,
  access_token  TEXT    NOT NULL,
  customer_name TEXT    NOT NULL,
  phone         TEXT    NOT NULL,
  email         TEXT,
  province      TEXT,
  city          TEXT,
  district      TEXT,
  address       TEXT,
  note          TEXT,
  channel       TEXT    NOT NULL DEFAULT 'web',
  fulfillment   TEXT    NOT NULL DEFAULT 'express',
  idem_key      TEXT,
  items_total   INTEGER NOT NULL,
  shipping_fee  INTEGER NOT NULL DEFAULT 0,
  total         INTEGER NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'pending',
  payment       TEXT    NOT NULL DEFAULT 'offline',
  paid_at       TEXT,
  admin_note    TEXT,
  day           TEXT    NOT NULL,
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_day ON orders(day);
CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(phone);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idem ON orders(idem_key) WHERE idem_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS order_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id   INTEGER,
  variant_id   INTEGER,
  name         TEXT    NOT NULL,
  name_en      TEXT    NOT NULL DEFAULT '',
  variant_name TEXT    NOT NULL DEFAULT '',
  sku          TEXT,
  image        TEXT,
  price        INTEGER NOT NULL,
  qty          INTEGER NOT NULL,
  subtotal     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS inquiries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  phone      TEXT    NOT NULL,
  email      TEXT,
  company    TEXT,
  qty        INTEGER,
  budget     TEXT,
  message    TEXT,
  status     TEXT    NOT NULL DEFAULT 'new',
  admin_note TEXT,
  day        TEXT    NOT NULL,
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inquiries_status ON inquiries(status, created_at);

CREATE TABLE IF NOT EXISTS content (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS counters (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL,
  ref        TEXT,
  day        TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_day ON events(day, type);
