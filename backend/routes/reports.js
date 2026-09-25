/**
 * /api/reports : แดชบอร์ด และรายงานยอดขาย
 */
const router = require('express').Router();
const { db } = require('../database/db');
const { auth, requireRole } = require('../middleware/auth');
const { wrap, dbDateShift } = require('../utils/helpers');

const DONE = "status='completed'";

// ---------------------------------------------------------------
// GET /api/reports/dashboard : ข้อมูลทั้งหมดของหน้าแรก
// ---------------------------------------------------------------
router.get('/dashboard', auth, wrap(async (req, res) => {
  const today = await db.get(`SELECT
      COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue, COALESCE(SUM(cost_total),0) AS cost,
      COALESCE(AVG(total),0) AS avg_ticket,
      COALESCE(SUM(CASE WHEN member_id IS NOT NULL THEN 1 ELSE 0 END),0) AS member_orders
    FROM orders WHERE ${DONE} AND created_at::date = CURRENT_DATE`);

  const yesterday = await db.get(`SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue
    FROM orders WHERE ${DONE} AND created_at::date = CURRENT_DATE - INTERVAL '1 day'`);

  const month = await db.get(`SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue,
      COALESCE(SUM(total-cost_total),0) AS profit
    FROM orders WHERE ${DONE}
      AND to_char(created_at,'YYYY-MM') = to_char(LOCALTIMESTAMP,'YYYY-MM')`);

  const pct = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : cur > 0 ? 100 : 0);

  // ยอดขาย 7 วันล่าสุด
  const daily = await db.all(`
    SELECT created_at::date AS day, COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue,
           COALESCE(SUM(total-cost_total),0) AS profit
    FROM orders WHERE ${DONE} AND created_at::date >= CURRENT_DATE - INTERVAL '6 day'
    GROUP BY 1 ORDER BY 1`);

  // ยอดขายรายชั่วโมงของวันนี้
  const hourly = await db.all(`
    SELECT to_char(created_at,'HH24') AS hour, COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue
    FROM orders WHERE ${DONE} AND created_at::date = CURRENT_DATE
    GROUP BY 1 ORDER BY 1`);

  // สินค้าขายดี 30 วัน
  const topProducts = await db.all(`
    SELECT oi.product_name AS name, SUM(oi.qty) AS qty, SUM(oi.line_total) AS revenue
    FROM order_items oi JOIN orders o ON o.id=oi.order_id
    WHERE o.${DONE} AND o.created_at::date >= CURRENT_DATE - INTERVAL '29 day'
    GROUP BY oi.product_name ORDER BY qty DESC LIMIT 8`);

  // สัดส่วนตามหมวดหมู่
  const byCategory = await db.all(`
    SELECT COALESCE(c.name,'อื่นๆ') AS category, SUM(oi.qty) AS qty, SUM(oi.line_total) AS revenue
    FROM order_items oi
    JOIN orders o ON o.id=oi.order_id AND o.${DONE}
    LEFT JOIN products p ON p.id=oi.product_id
    LEFT JOIN categories c ON c.id=p.category_id
    WHERE o.created_at::date >= CURRENT_DATE - INTERVAL '29 day'
    GROUP BY c.name ORDER BY revenue DESC`);

  // ช่องทางชำระเงินวันนี้
  const payments = await db.all(`
    SELECT payment_method AS method, COUNT(*) AS orders, COALESCE(SUM(total),0) AS amount
    FROM orders WHERE ${DONE} AND created_at::date = CURRENT_DATE
    GROUP BY payment_method ORDER BY amount DESC`);

  const recentOrders = await db.all(`
    SELECT o.id,o.order_no,o.total,o.status,o.order_type,o.payment_method,o.created_at,
           m.name AS member_name,
           (SELECT string_agg(oi.product_name || ' x' || oi.qty, ', ')
              FROM order_items oi WHERE oi.order_id=o.id) AS items_summary
    FROM orders o LEFT JOIN members m ON m.id=o.member_id
    ORDER BY o.created_at DESC LIMIT 8`);

  const lowStock = await db.all(`SELECT id,name,unit,stock_qty,min_qty FROM ingredients
    WHERE is_active=1 AND stock_qty <= min_qty ORDER BY stock_qty/NULLIF(min_qty,0) LIMIT 6`);

  const { c: queueCount } = await db.get(
    "SELECT COUNT(*) c FROM orders WHERE status IN ('pending','preparing','ready')");

  const members = await db.get('SELECT COUNT(*) c, COALESCE(SUM(points),0) p FROM members WHERE is_active=1');

  res.json({
    today: {
      ...today,
      profit: today.revenue - today.cost,
      revenue_change: pct(today.revenue, yesterday.revenue),
      orders_change: pct(today.orders, yesterday.orders),
    },
    month,
    daily,
    hourly,
    top_products: topProducts,
    by_category: byCategory,
    payments,
    recent_orders: recentOrders,
    low_stock: lowStock,
    queue_count: queueCount,
    members: { total: members.c, total_points: members.p },
  });
}));

// ---------------------------------------------------------------
// GET /api/reports/sales?date_from=&date_to=&group=day|month
// ---------------------------------------------------------------
router.get('/sales', auth, wrap(async (req, res) => {
  const from = req.query.date_from || await dbDateShift(-29);
  const to = req.query.date_to || await dbDateShift(0);
  const group = req.query.group === 'month' ? 'YYYY-MM' : 'YYYY-MM-DD';

  const rows = await db.all(`
    SELECT to_char(created_at, ?) AS period, COUNT(*) AS orders,
           COALESCE(SUM(subtotal),0) AS subtotal, COALESCE(SUM(discount),0) AS discount,
           COALESCE(SUM(total),0) AS revenue, COALESCE(SUM(cost_total),0) AS cost,
           COALESCE(SUM(total-cost_total),0) AS profit, COALESCE(AVG(total),0) AS avg_ticket
    FROM orders WHERE ${DONE} AND created_at::date BETWEEN ?::date AND ?::date
    GROUP BY 1 ORDER BY 1`, group, from, to);

  const summary = await db.get(`
    SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue, COALESCE(SUM(discount),0) AS discount,
           COALESCE(SUM(cost_total),0) AS cost, COALESCE(SUM(total-cost_total),0) AS profit,
           COALESCE(AVG(total),0) AS avg_ticket,
           COALESCE(SUM((SELECT SUM(qty) FROM order_items oi WHERE oi.order_id=orders.id)),0) AS items_sold
    FROM orders WHERE ${DONE} AND created_at::date BETWEEN ?::date AND ?::date`, from, to);

  const { v: expenses } = await db.get(`SELECT COALESCE(SUM(amount),0) v FROM expenses
    WHERE spent_at BETWEEN ?::date AND ?::date`, from, to);

  res.json({ from, to, summary: { ...summary, expenses, net_profit: summary.profit - expenses }, rows });
}));

// ---------------------------------------------------------------
// GET /api/reports/products?date_from=&date_to=
// ---------------------------------------------------------------
router.get('/products', auth, wrap(async (req, res) => {
  const from = req.query.date_from || await dbDateShift(-29);
  const to = req.query.date_to || await dbDateShift(0);
  res.json(await db.all(`
    SELECT oi.product_name AS name, COALESCE(c.name,'อื่นๆ') AS category,
           SUM(oi.qty) AS qty, SUM(oi.line_total) AS revenue,
           SUM(oi.unit_cost*oi.qty) AS cost,
           SUM(oi.line_total) - SUM(oi.unit_cost*oi.qty) AS profit
    FROM order_items oi
    JOIN orders o ON o.id=oi.order_id AND o.${DONE}
    LEFT JOIN products p ON p.id=oi.product_id
    LEFT JOIN categories c ON c.id=p.category_id
    WHERE o.created_at::date BETWEEN ?::date AND ?::date
    GROUP BY oi.product_name, c.name ORDER BY qty DESC`, from, to));
}));

// ---------------------------------------------------------------
// GET /api/reports/staff : ยอดขายรายพนักงาน
// ---------------------------------------------------------------
router.get('/staff', auth, requireRole('owner', 'manager'), wrap(async (req, res) => {
  const from = req.query.date_from || await dbDateShift(-29);
  const to = req.query.date_to || await dbDateShift(0);
  res.json(await db.all(`
    SELECT u.id, u.full_name, u.role, COUNT(o.id) AS orders,
           COALESCE(SUM(o.total),0) AS revenue, COALESCE(AVG(o.total),0) AS avg_ticket
    FROM users u LEFT JOIN orders o
      ON o.user_id=u.id AND o.${DONE} AND o.created_at::date BETWEEN ?::date AND ?::date
    GROUP BY u.id, u.full_name, u.role ORDER BY revenue DESC`, from, to));
}));

// ---------------------------------------------------------------
// GET /api/reports/profit-loss : กำไรขาดทุน
// ---------------------------------------------------------------
router.get('/profit-loss', auth, requireRole('owner', 'manager'), wrap(async (req, res) => {
  const from = req.query.date_from || await dbDateShift(-29);
  const to = req.query.date_to || await dbDateShift(0);
  const sales = await db.get(`SELECT COALESCE(SUM(total),0) AS revenue, COALESCE(SUM(cost_total),0) AS cogs
    FROM orders WHERE ${DONE} AND created_at::date BETWEEN ?::date AND ?::date`, from, to);
  const expenses = await db.all(`SELECT category, COALESCE(SUM(amount),0) AS amount FROM expenses
    WHERE spent_at BETWEEN ?::date AND ?::date GROUP BY category ORDER BY amount DESC`, from, to);
  const totalExpense = expenses.reduce((s, e) => s + e.amount, 0);
  res.json({
    from, to,
    revenue: sales.revenue,
    cogs: sales.cogs,
    gross_profit: sales.revenue - sales.cogs,
    expenses,
    total_expense: totalExpense,
    net_profit: sales.revenue - sales.cogs - totalExpense,
  });
}));

module.exports = router;
