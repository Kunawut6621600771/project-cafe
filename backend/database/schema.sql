-- ==========================================================
-- Espresso Flow : ระบบจัดการร้านกาแฟ
-- Database Schema (PostgreSQL)
-- ==========================================================
-- หมายเหตุ :
--   * ธงบูลีน (is_active / is_available ...) ใช้ SMALLINT 0/1 เหมือนเดิม
--     เพื่อให้ฝั่ง frontend ไม่ต้องแก้
--   * เวลาใช้ TIMESTAMP (ไม่มี timezone) + LOCALTIMESTAMP(0)
--     โดยตั้ง timezone ของ session เป็น Asia/Bangkok ที่ไฟล์ db.js
-- ==========================================================

-- ----------------------------------------------------------
-- 1) ผู้ใช้งาน / พนักงาน
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT      NOT NULL UNIQUE,
  password_hash TEXT      NOT NULL,
  full_name     TEXT      NOT NULL,
  role          TEXT      NOT NULL DEFAULT 'staff' CHECK (role IN ('owner','manager','staff')),
  phone         TEXT,
  pin           TEXT,
  status        TEXT      NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at    TIMESTAMP NOT NULL DEFAULT LOCALTIMESTAMP(0),
  updated_at    TIMESTAMP NOT NULL DEFAULT LOCALTIMESTAMP(0)
);

-- ----------------------------------------------------------
-- 2) หมวดหมู่สินค้า
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
  id         SERIAL PRIMARY KEY,
  name       TEXT     NOT NULL UNIQUE,
  icon       TEXT     DEFAULT '☕',
  sort_order INTEGER  NOT NULL DEFAULT 0,
  is_active  SMALLINT NOT NULL DEFAULT 1
);

-- ----------------------------------------------------------
-- 3) สินค้า / เมนู
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id             SERIAL PRIMARY KEY,
  category_id    INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  sku            TEXT    UNIQUE,
  name           TEXT             NOT NULL,
  description    TEXT,
  price          DOUBLE PRECISION NOT NULL DEFAULT 0,
  cost           DOUBLE PRECISION NOT NULL DEFAULT 0,
  image          TEXT,
  is_available   SMALLINT  NOT NULL DEFAULT 1,
  is_recommended SMALLINT  NOT NULL DEFAULT 0,
  sort_order     INTEGER   NOT NULL DEFAULT 0,
  created_at     TIMESTAMP NOT NULL DEFAULT LOCALTIMESTAMP(0)
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);

-- ----------------------------------------------------------
-- 4) กลุ่มตัวเลือก (ขนาด / ความหวาน / ร้อน-เย็น)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS option_groups (
  id          SERIAL PRIMARY KEY,
  name        TEXT     NOT NULL,
  select_type TEXT     NOT NULL DEFAULT 'single' CHECK (select_type IN ('single','multi')),
  is_required SMALLINT NOT NULL DEFAULT 0,
  sort_order  INTEGER  NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS options (
  id          SERIAL PRIMARY KEY,
  group_id    INTEGER NOT NULL REFERENCES option_groups(id) ON DELETE CASCADE,
  name        TEXT             NOT NULL,
  price_delta DOUBLE PRECISION NOT NULL DEFAULT 0,
  is_default  SMALLINT NOT NULL DEFAULT 0,
  sort_order  INTEGER  NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS product_option_groups (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  group_id   INTEGER NOT NULL REFERENCES option_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, group_id)
);

-- ----------------------------------------------------------
-- 5) วัตถุดิบ / คลังสินค้า
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS ingredients (
  id            SERIAL PRIMARY KEY,
  code          TEXT UNIQUE,
  name          TEXT             NOT NULL,
  unit          TEXT             NOT NULL DEFAULT 'กรัม',
  stock_qty     DOUBLE PRECISION NOT NULL DEFAULT 0,
  min_qty       DOUBLE PRECISION NOT NULL DEFAULT 0,
  cost_per_unit DOUBLE PRECISION NOT NULL DEFAULT 0,
  supplier      TEXT,
  is_active     SMALLINT  NOT NULL DEFAULT 1,
  updated_at    TIMESTAMP NOT NULL DEFAULT LOCALTIMESTAMP(0)
);
-- ระดับเต็มคลัง (แถบระดับสต็อก + จำนวนแนะนำให้สั่ง) และหมวดวัตถุดิบ
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS max_qty  DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS category TEXT;

-- สูตรการผลิต : ใช้ตัดสต็อกอัตโนมัติเมื่อขาย
CREATE TABLE IF NOT EXISTS recipes (
  id            SERIAL PRIMARY KEY,
  product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  qty           DOUBLE PRECISION NOT NULL DEFAULT 0,
  UNIQUE (product_id, ingredient_id)
);

-- ประวัติการเคลื่อนไหวสต็อก
CREATE TABLE IF NOT EXISTS stock_movements (
  id            SERIAL PRIMARY KEY,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  type          TEXT             NOT NULL CHECK (type IN ('in','out','adjust','waste')),
  qty           DOUBLE PRECISION NOT NULL,
  balance_after DOUBLE PRECISION NOT NULL DEFAULT 0,
  cost          DOUBLE PRECISION NOT NULL DEFAULT 0,
  ref_type      TEXT,
  ref_id        INTEGER,
  note          TEXT,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT LOCALTIMESTAMP(0)
);
CREATE INDEX IF NOT EXISTS idx_stock_mv_ing  ON stock_movements(ingredient_id);
CREATE INDEX IF NOT EXISTS idx_stock_mv_date ON stock_movements(created_at);

-- ----------------------------------------------------------
-- 6) สมาชิก
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS members (
  id          SERIAL PRIMARY KEY,
  code        TEXT     NOT NULL UNIQUE,
  name        TEXT     NOT NULL,
  phone       TEXT     UNIQUE,
  email       TEXT,
  birthdate   DATE,
  points      INTEGER  NOT NULL DEFAULT 0,
  tier        TEXT     NOT NULL DEFAULT 'silver' CHECK (tier IN ('silver','gold','platinum')),
  total_spent DOUBLE PRECISION NOT NULL DEFAULT 0,
  visits      INTEGER  NOT NULL DEFAULT 0,
  last_visit  DATE,
  note        TEXT,
  is_active   SMALLINT  NOT NULL DEFAULT 1,
  created_at  TIMESTAMP NOT NULL DEFAULT LOCALTIMESTAMP(0)
);

CREATE TABLE IF NOT EXISTS point_transactions (
  id            SERIAL PRIMARY KEY,
  member_id     INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  points        INTEGER NOT NULL,
  balance_after INTEGER NOT NULL DEFAULT 0,
  reason        TEXT,
  order_id      INTEGER,
  created_at    TIMESTAMP NOT NULL DEFAULT LOCALTIMESTAMP(0)
);

-- ----------------------------------------------------------
-- 7) โปรโมชั่น / ส่วนลด
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS promotions (
  id         SERIAL PRIMARY KEY,
  code       TEXT UNIQUE,
  name       TEXT             NOT NULL,
  type       TEXT             NOT NULL DEFAULT 'percent' CHECK (type IN ('percent','amount')),
  value      DOUBLE PRECISION NOT NULL DEFAULT 0,
  min_total  DOUBLE PRECISION NOT NULL DEFAULT 0,
  start_date DATE,
  end_date   DATE,
  is_active  SMALLINT NOT NULL DEFAULT 1
);

-- ----------------------------------------------------------
-- 8) กะการขาย (เปิด/ปิดร้าน)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS shifts (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  opened_at    TIMESTAMP NOT NULL DEFAULT LOCALTIMESTAMP(0),
  closed_at    TIMESTAMP,
  opening_cash DOUBLE PRECISION NOT NULL DEFAULT 0,
  closing_cash DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_sales  DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_orders INTEGER NOT NULL DEFAULT 0,
  status       TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  note         TEXT
);

-- ----------------------------------------------------------
-- 9) ออเดอร์
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id             SERIAL PRIMARY KEY,
  order_no       TEXT NOT NULL UNIQUE,
  order_type     TEXT NOT NULL DEFAULT 'takeaway' CHECK (order_type IN ('dine_in','takeaway')),
  table_no       TEXT,
  member_id      INTEGER REFERENCES members(id) ON DELETE SET NULL,
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  shift_id       INTEGER REFERENCES shifts(id) ON DELETE SET NULL,
  subtotal       DOUBLE PRECISION NOT NULL DEFAULT 0,
  discount       DOUBLE PRECISION NOT NULL DEFAULT 0,
  promotion_id   INTEGER REFERENCES promotions(id) ON DELETE SET NULL,
  total          DOUBLE PRECISION NOT NULL DEFAULT 0,
  cost_total     DOUBLE PRECISION NOT NULL DEFAULT 0,
  payment_method TEXT CHECK (payment_method IN ('cash','promptpay')),
  received       DOUBLE PRECISION NOT NULL DEFAULT 0,
  change_amount  DOUBLE PRECISION NOT NULL DEFAULT 0,
  points_earned  INTEGER NOT NULL DEFAULT 0,
  status         TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','preparing','ready','completed','cancelled')),
  note           TEXT,
  paid_at        TIMESTAMP,
  created_at     TIMESTAMP NOT NULL DEFAULT LOCALTIMESTAMP(0),
  updated_at     TIMESTAMP NOT NULL DEFAULT LOCALTIMESTAMP(0)
);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_member  ON orders(member_id);
-- LINE Bot : ผูกลูกค้ากับออเดอร์เพื่อแจ้งเตือนเมื่อพร้อม
ALTER TABLE orders ADD COLUMN IF NOT EXISTS line_token       TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS line_user_id     TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS line_notified_at TIMESTAMP;
-- สถานะล่าสุดที่แจ้งลูกค้าทาง LINE แล้ว (กันส่งซ้ำ)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS line_last_status TEXT;
-- ร้านรับแค่เงินสด/พร้อมเพย์ และทานที่ร้าน/กลับบ้าน — อัปเดต CHECK ของฐานข้อมูลเดิมให้ตรงกัน
-- NOT VALID: บังคับเฉพาะแถวใหม่ ออเดอร์เก่าที่เป็น card/transfer/wallet/delivery ยังอยู่ได้
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_method_check;
ALTER TABLE orders ADD  CONSTRAINT orders_payment_method_check
  CHECK (payment_method IN ('cash','promptpay')) NOT VALID;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_order_type_check;
ALTER TABLE orders ADD  CONSTRAINT orders_order_type_check
  CHECK (order_type IN ('dine_in','takeaway')) NOT VALID;

CREATE TABLE IF NOT EXISTS order_items (
  id            SERIAL PRIMARY KEY,
  order_id      INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id    INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name  TEXT    NOT NULL,
  qty           INTEGER NOT NULL DEFAULT 1,
  unit_price    DOUBLE PRECISION NOT NULL DEFAULT 0,
  options_price DOUBLE PRECISION NOT NULL DEFAULT 0,
  options_text  TEXT,
  options_json  TEXT,
  unit_cost     DOUBLE PRECISION NOT NULL DEFAULT 0,
  line_total    DOUBLE PRECISION NOT NULL DEFAULT 0,
  note          TEXT
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

-- ----------------------------------------------------------
-- 9.1) สลิปโอนเงิน (พร้อมเพย์ / โอน) : trans_ref ห้ามซ้ำ → กันสลิปใช้ซ้ำ
--      order_id ว่าง = ตรวจแล้วแต่ยังไม่ได้ผูกกับบิล
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_slips (
  id               SERIAL PRIMARY KEY,
  trans_ref        TEXT NOT NULL UNIQUE,
  provider         TEXT NOT NULL,                 -- easyslip / slipok / manual
  status           TEXT NOT NULL DEFAULT 'verified' CHECK (status IN ('verified','manual')),
  amount           DOUBLE PRECISION,
  expected_amount  DOUBLE PRECISION NOT NULL DEFAULT 0,
  sending_bank     TEXT,
  sender_name      TEXT,
  receiver_name    TEXT,
  receiver_account TEXT,
  slip_time        TEXT,
  qr_payload       TEXT,
  raw_json         TEXT,
  order_id         INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  user_id          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT LOCALTIMESTAMP(0)
);
CREATE INDEX IF NOT EXISTS idx_payment_slips_order ON payment_slips(order_id);

-- ----------------------------------------------------------
-- 10) ค่าใช้จ่าย
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS expenses (
  id         SERIAL PRIMARY KEY,
  category   TEXT NOT NULL,
  title      TEXT NOT NULL,
  amount     DOUBLE PRECISION NOT NULL DEFAULT 0,
  note       TEXT,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  spent_at   DATE      NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMP NOT NULL DEFAULT LOCALTIMESTAMP(0)
);

-- ----------------------------------------------------------
-- 11) ตั้งค่าระบบ
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TIMESTAMP NOT NULL DEFAULT LOCALTIMESTAMP(0)
);

-- ----------------------------------------------------------
-- VIEWS
-- ----------------------------------------------------------
CREATE OR REPLACE VIEW v_daily_sales AS
SELECT created_at::date              AS sale_date,
       COUNT(*)                      AS orders,
       SUM(total)                    AS revenue,
       SUM(cost_total)               AS cost,
       SUM(total) - SUM(cost_total)  AS profit,
       AVG(total)                    AS avg_ticket
FROM   orders
WHERE  status = 'completed'
GROUP  BY created_at::date;

CREATE OR REPLACE VIEW v_product_sales AS
SELECT p.id               AS product_id,
       p.name             AS name,
       c.name             AS category,
       SUM(oi.qty)        AS qty_sold,
       SUM(oi.line_total) AS revenue
FROM   order_items oi
JOIN   orders o          ON o.id = oi.order_id AND o.status = 'completed'
LEFT   JOIN products p   ON p.id = oi.product_id
LEFT   JOIN categories c ON c.id = p.category_id
GROUP  BY p.id, p.name, c.name;
