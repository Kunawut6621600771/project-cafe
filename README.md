# ☕ Espresso Flow — ระบบจัดการร้านกาแฟ

ระบบจัดการร้านกาแฟแบบครบวงจร (Full-stack Web Application) ประกอบด้วยระบบขายหน้าร้าน (POS),
คลังวัตถุดิบที่ตัดสต็อกอัตโนมัติตามสูตร, ระบบสมาชิกสะสมแต้ม, และรายงานยอดขาย/กำไร-ขาดทุน

| ส่วน | เทคโนโลยี |
|------|-----------|
| ฐานข้อมูล | PostgreSQL (node-postgres / `pg`) — 15 ตาราง + 2 View |
| Backend | Node.js + Express (REST API) + JWT + bcrypt |
| Frontend | HTML/CSS/JavaScript (ES Modules) — SPA ไม่ต้อง build |

---

## 🚀 เริ่มใช้งาน

**1. เตรียม PostgreSQL** (ต้องมี PostgreSQL 12 ขึ้นไปทำงานอยู่) แล้วสร้างฐานข้อมูลเปล่า:

```bash
createdb espresso_flow
```

หรือรันด้วย Docker:

```bash
docker run -d --name espresso-pg -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=espresso_flow postgres:16
```

**2. ตั้งค่าการเชื่อมต่อ** — คัดลอก `.env.example` เป็น `.env` แล้วแก้ `DATABASE_URL`:

```
DATABASE_URL=postgres://postgres:postgres@localhost:5432/espresso_flow
```

**3. ติดตั้งและรัน**

```bash
npm install
npm start
```

เปิดเบราว์เซอร์ที่ **http://localhost:3000**

> ตารางทั้งหมดถูกสร้างอัตโนมัติจาก `backend/database/schema.sql` ตอนเซิร์ฟเวอร์บูต
> (`CREATE TABLE IF NOT EXISTS` — รันซ้ำได้ ไม่ทับข้อมูลเดิม)

### บัญชีทดลองใช้งาน

| ชื่อผู้ใช้ | รหัสผ่าน | ตำแหน่ง | สิทธิ์ |
|-----------|---------|---------|-------|
| `admin` | `admin123` | เจ้าของร้าน | ทุกอย่าง รวมถึงจัดการพนักงาน |
| `manager` | `manager123` | ผู้จัดการ | ทุกอย่าง ยกเว้นเพิ่ม/ลบพนักงาน |
| `staff01` | `staff123` | พนักงาน | ขายหน้าร้าน, ออเดอร์, สต็อก, สมาชิก |

### คำสั่งอื่น ๆ

| คำสั่ง | ความหมาย |
|--------|----------|
| `npm start` | รันเซิร์ฟเวอร์ |
| `npm run dev` | รันแบบ auto-reload เมื่อแก้โค้ด |
| `npm run reset` | ลบตารางทั้งหมดทิ้งแล้วสร้างตารางเปล่าใหม่ (ไม่มีข้อมูลตัวอย่าง) |

---

## 📁 โครงสร้างโปรเจกต์

```
project cafe/
├── backend/
│   ├── server.js                # จุดเริ่มต้นเซิร์ฟเวอร์ + เสิร์ฟไฟล์ frontend
│   ├── database/
│   │   ├── schema.sql           # โครงสร้างฐานข้อมูลทั้งหมด (PostgreSQL)
│   │   ├── db.js                # Connection pool + helper query + transaction
│   │   └── reset.js             # ล้างตารางทั้งหมดแล้วสร้างตารางเปล่าใหม่
│   ├── middleware/auth.js       # ตรวจ JWT + จำกัดสิทธิ์ตามตำแหน่ง
│   ├── utils/helpers.js         # เลขที่ออเดอร์ / รหัสสมาชิก / คำนวณระดับสมาชิก
│   └── routes/
│       ├── auth.js              # เข้าสู่ระบบ, เปลี่ยนรหัสผ่าน
│       ├── products.js          # หมวดหมู่, เมนู, ตัวเลือกสินค้า, สูตร
│       ├── orders.js            # ขาย, คิวหน้าร้าน, ประวัติ, ยกเลิก
│       ├── stock.js             # วัตถุดิบ, รับเข้า/ตัดออก/ปรับยอด
│       ├── members.js           # สมาชิก + แต้มสะสม
│       ├── reports.js           # แดชบอร์ด, ยอดขาย, กำไร-ขาดทุน
│       └── settings.js          # ตั้งค่าร้าน, พนักงาน, โปรโมชั่น, ค่าใช้จ่าย, กะ
├── frontend/
│   ├── index.html               # หน้าเข้าสู่ระบบ + โครงแอป
│   ├── css/style.css            # Design system ทั้งหมด
│   └── js/
│       ├── app.js               # Router + เมนูข้าง + การเข้าสู่ระบบ
│       ├── api.js               # ตัวเชื่อม REST API + จัดการ token
│       ├── utils.js             # ฟอร์แมต, toast, modal, กราฟ SVG
│       └── pages/               # dashboard, pos, orders, stock, members, reports, settings
└── .env                         # ค่าเชื่อมต่อ PostgreSQL + คีย์ลับ (ไม่ commit)
```

---

## 🗄️ ฐานข้อมูล

| ตาราง | หน้าที่ |
|-------|--------|
| `users` | พนักงาน + ตำแหน่ง (owner / manager / staff) |
| `categories`, `products` | หมวดหมู่และเมนูสินค้า |
| `option_groups`, `options`, `product_option_groups` | ตัวเลือก เช่น ขนาดแก้ว / ความหวาน / เพิ่มพิเศษ |
| `ingredients` | วัตถุดิบ + จุดสั่งซื้อ + ต้นทุนต่อหน่วย |
| `recipes` | สูตร : 1 เมนูใช้วัตถุดิบอะไรบ้าง (ใช้ตัดสต็อก) |
| `stock_movements` | ประวัติการเคลื่อนไหวสต็อกทุกครั้ง พร้อมยอดคงเหลือหลังรายการ |
| `members`, `point_transactions` | สมาชิกและประวัติแต้ม |
| `orders`, `order_items` | บิลขายและรายการสินค้าในบิล (เก็บ snapshot ชื่อ/ราคา/ต้นทุน) |
| `promotions` | โค้ดส่วนลด (เปอร์เซ็นต์ / จำนวนเงิน) |
| `shifts` | เปิด-ปิดกะ พร้อมสรุปเงินสด |
| `expenses` | ค่าใช้จ่ายร้าน สำหรับงบกำไร-ขาดทุน |
| `settings` | ตั้งค่าระบบแบบ key-value |
| `v_daily_sales`, `v_product_sales` | View สรุปยอดขายรายวัน / รายสินค้า |

### กลไกสำคัญ

- **ตัดสต็อกอัตโนมัติ** — เมื่อบันทึกการขาย ระบบอ่าน `recipes` ของทุกรายการในบิล
  รวมปริมาณวัตถุดิบที่ใช้ แล้วหักจาก `ingredients.stock_qty` พร้อมบันทึก `stock_movements`
  ทั้งหมดอยู่ใน transaction เดียว — ถ้าขั้นตอนใดพลาด จะไม่มีการบันทึกใด ๆ เลย
- **ยกเลิกออเดอร์** — คืนวัตถุดิบเข้าสต็อก คืน/หักแต้มสมาชิก และปรับยอดกะให้อัตโนมัติ
- **คำนวณราคาฝั่งเซิร์ฟเวอร์** — ราคาสินค้าและตัวเลือกถูกคำนวณใหม่จากฐานข้อมูลเสมอ
  ไม่เชื่อราคาที่ส่งมาจากเบราว์เซอร์
- **ระดับสมาชิก** — เลื่อนขั้นอัตโนมัติจากยอดซื้อสะสม (ปรับเกณฑ์ได้ในหน้าตั้งค่า)

---

## 🔌 REST API

ทุก endpoint ยกเว้น `/api/auth/login` และ `/api/health` ต้องส่ง header
`Authorization: Bearer <token>`

### เข้าสู่ระบบ
| Method | Endpoint | คำอธิบาย |
|--------|----------|----------|
| POST | `/api/auth/login` | เข้าสู่ระบบ คืน token + ข้อมูลผู้ใช้ |
| GET | `/api/auth/me` | ข้อมูลผู้ใช้ปัจจุบัน |
| POST | `/api/auth/change-password` | เปลี่ยนรหัสผ่าน |

### สินค้า
| Method | Endpoint | คำอธิบาย |
|--------|----------|----------|
| GET | `/api/categories` · `/api/products` · `/api/options` | รายการหมวดหมู่ / เมนู / ตัวเลือก |
| GET | `/api/products/:id` | รายละเอียดเมนู พร้อมสูตร |
| POST/PUT/DELETE | `/api/products` · `/api/categories` | จัดการเมนูและหมวดหมู่ (ผู้จัดการขึ้นไป) |
| PATCH | `/api/products/:id/availability` | สลับเปิด/ปิดการขาย |

### ออเดอร์
| Method | Endpoint | คำอธิบาย |
|--------|----------|----------|
| GET | `/api/orders?date_from=&date_to=&status=&q=&page=` | ประวัติออเดอร์ (แบ่งหน้า) |
| GET | `/api/orders/queue` | คิวที่ยังทำไม่เสร็จ |
| GET | `/api/orders/:id` | รายละเอียด + ข้อมูลใบเสร็จ |
| POST | `/api/orders` | บันทึกการขาย (ตัดสต็อก + สะสมแต้ม) |
| PATCH | `/api/orders/:id/status` | เปลี่ยนสถานะ (รอทำ → กำลังทำ → พร้อมเสิร์ฟ → สำเร็จ) |
| POST | `/api/orders/:id/cancel` | ยกเลิก + คืนสต็อก (ผู้จัดการขึ้นไป) |

ตัวอย่าง payload การขาย:
```json
{
  "order_type": "takeaway",
  "member_id": 1,
  "payment_method": "cash",
  "received": 200,
  "promotion_code": "MEMBER5",
  "points_used": 0,
  "items": [
    { "product_id": 7, "qty": 2, "options": [2, 6], "note": "แยกน้ำแข็ง" }
  ]
}
```

### คลังวัตถุดิบ
`GET /api/stock/ingredients` · `GET /api/stock/summary` · `GET /api/stock/alerts` ·
`GET /api/stock/movements` · `POST /api/stock/movements` (`type` = `in` / `out` / `adjust` / `waste`) ·
`POST|PUT|DELETE /api/stock/ingredients`

### สมาชิก
`GET /api/members` · `GET /api/members/summary` · `GET /api/members/search?q=` ·
`GET /api/members/:id` · `POST|PUT /api/members` · `POST /api/members/:id/points`

### รายงาน
`GET /api/reports/dashboard` · `/sales` · `/products` · `/staff` · `/profit-loss`
(ทุกตัวรับ `date_from` และ `date_to`)

### ตั้งค่า
`GET|PUT /api/settings` · `GET|POST|PUT|DELETE /api/users` · `/promotions` · `/expenses` ·
`GET /api/shifts` · `POST /api/shifts/open` · `POST /api/shifts/close`

---

## 🖥️ หน้าจอในระบบ

| หน้า | ความสามารถ |
|------|------------|
| **แดชบอร์ด** | ยอดขาย/กำไรวันนี้เทียบเมื่อวาน, กราฟ 7 วัน, กราฟรายชั่วโมง, เมนูขายดี, ช่องทางชำระเงิน, วัตถุดิบใกล้หมด, ออเดอร์ล่าสุด |
| **ขายหน้าร้าน** | เลือกเมนูตามหมวด/ค้นหา, เลือกตัวเลือกและจำนวน, ผูกสมาชิก, ใช้โค้ดส่วนลด, แลกแต้ม, คิดเงินทอน, พิมพ์ใบเสร็จ |
| **ออเดอร์** | คิวหน้าร้านแบบ 3 คอลัมน์ (รอทำ/กำลังทำ/พร้อมเสิร์ฟ), ประวัติพร้อมตัวกรอง, ดูใบเสร็จย้อนหลัง, ยกเลิกบิล, ส่งออก CSV |
| **คลังวัตถุดิบ** | รายการพร้อมแถบระดับสต็อก, รับเข้า/ตัดออก/ปรับยอด/ของเสีย, ประวัติการเคลื่อนไหว, รายการที่ควรสั่งซื้อ |
| **สมาชิก** | ค้นหา/สมัคร/แก้ไข, โปรไฟล์แสดงเมนูโปรด ประวัติซื้อ ประวัติแต้ม, ปรับแต้มด้วยตนเอง |
| **รายงาน** | ยอดขายตามช่วงเวลา, สินค้าขายดีและอัตรากำไรรายเมนู, งบกำไร-ขาดทุน, ยอดขายรายพนักงาน, ส่งออก CSV |
| **ตั้งค่าระบบ** | ข้อมูลร้าน/ใบเสร็จ, กติกาแต้มและระดับสมาชิก, จัดการเมนูพร้อมตัวแก้ไขสูตร, หมวดหมู่, โปรโมชั่น, ค่าใช้จ่าย, เปิด-ปิดกะ, พนักงาน |

---

## 🔐 สิทธิ์การใช้งาน

| ความสามารถ | เจ้าของร้าน | ผู้จัดการ | พนักงาน |
|------------|:---------:|:--------:|:------:|
| ขายหน้าร้าน / จัดการคิว | ✅ | ✅ | ✅ |
| รับเข้า-ปรับสต็อก | ✅ | ✅ | ✅ |
| สมัคร/แก้ไขสมาชิก | ✅ | ✅ | ✅ |
| ยกเลิกออเดอร์ · ปรับแต้ม | ✅ | ✅ | ❌ |
| จัดการเมนู/หมวดหมู่/โปรโมชั่น/ค่าใช้จ่าย | ✅ | ✅ | ❌ |
| ดูรายงาน | ✅ | ✅ | ❌ |
| เพิ่ม/แก้ไข/ระงับพนักงาน | ✅ | ❌ | ❌ |

---

## ⚙️ การตั้งค่าเพิ่มเติม

คัดลอก `.env.example` เป็น `.env` เพื่อแก้การเชื่อมต่อฐานข้อมูล พอร์ต หรือคีย์ลับ

```
PORT=3000
JWT_SECRET=เปลี่ยนเป็นข้อความลับของคุณ
JWT_EXPIRES=12h

DATABASE_URL=postgres://postgres:postgres@localhost:5432/espresso_flow
```

| ตัวแปร | ค่าเริ่มต้น | ความหมาย |
|--------|------------|----------|
| `DATABASE_URL` | — | connection string ของ PostgreSQL (ถ้าตั้งค่านี้ จะใช้ก่อน `PG*`) |
| `PGHOST` `PGPORT` `PGUSER` `PGPASSWORD` `PGDATABASE` | `localhost` `5432` `postgres` `postgres` `espresso_flow` | ตั้งค่าแยกทีละตัว |
| `PGSSL` | `false` | ตั้ง `true` เมื่อต่อกับ Neon / Supabase / Render |
| `PGPOOL_MAX` | `10` | จำนวน connection สูงสุดใน pool |
| `DB_TIMEZONE` | `Asia/Bangkok` | timezone ที่ `LOCALTIMESTAMP` / `CURRENT_DATE` ใช้อ้างอิง |

> ⚠️ ก่อนนำไปใช้งานจริง ให้เปลี่ยน `JWT_SECRET` และรหัสผ่านของบัญชีตัวอย่างทั้งหมด
