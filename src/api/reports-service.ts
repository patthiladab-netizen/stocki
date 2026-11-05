import { Hono } from "hono";
import { filterCostFields, buildExcelColumns } from "../domain/reportEngine";

type Bindings = { DB: D1Database; ADMIN_EMAIL: string; APP_SECRET: string };
type Variables = { session: { userId: number; email: string; role: string } | null };

const reportsApp = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ── auth guard ────────────────────────────────────────────────────────────────
reportsApp.use("/*", async (c, next) => {
  if (!c.get("session")) return c.json({ error: "Unauthorized" }, 401);
  await next();
});

// ── balance ───────────────────────────────────────────────────────────────────
reportsApp.get("/balance", async (c) => {
  const role = c.get("session")!.role;
  const rows = await c.env.DB.prepare(`
    SELECT i.id as item_id, i.sku, i.name_th,
           cat.name as category, w.name as warehouse,
           l.lot_no, l.expiry_date,
           COALESCE(sb.qty_on_hand_milli,0) as qty_on_hand_milli,
           COALESCE(sb.avg_cost_x4,0) as avg_cost_x4,
           u.name_th as unit
    FROM items i
    LEFT JOIN categories cat ON cat.id=i.category_id
    LEFT JOIN units u ON u.id=i.unit_id
    LEFT JOIN stock_balances sb ON sb.item_id=i.id
    LEFT JOIN warehouses w ON w.id=sb.warehouse_id
    LEFT JOIN lots l ON l.id=sb.lot_id
    WHERE i.status='ACTIVE'
    ORDER BY cat.name, i.sku
  `).all();
  const data = filterCostFields(rows.results as any[], role);
  return c.json({ data });
});

// ── balance export Excel ──────────────────────────────────────────────────────
reportsApp.get("/balance/export", async (c) => {
  if (c.get("session")!.role !== "OWNER") return c.json({ error: "forbidden" }, 403);
  const role = c.get("session")!.role;
  const rows = await c.env.DB.prepare(`
    SELECT i.id as item_id, i.sku, i.name_th,
           cat.name as category, w.name as warehouse,
           l.lot_no, l.expiry_date,
           COALESCE(sb.qty_on_hand_milli,0) as qty_on_hand_milli,
           COALESCE(sb.avg_cost_x4,0) as avg_cost_x4,
           u.name_th as unit
    FROM items i
    LEFT JOIN categories cat ON cat.id=i.category_id
    LEFT JOIN units u ON u.id=i.unit_id
    LEFT JOIN stock_balances sb ON sb.item_id=i.id
    LEFT JOIN warehouses w ON w.id=sb.warehouse_id
    LEFT JOIN lots l ON l.id=sb.lot_id
    WHERE i.status='ACTIVE'
  `).all();
  const cols = buildExcelColumns(role);
  const filtered = filterCostFields(rows.results as any[], role);
  // ส่ง JSON ให้ frontend สร้าง Excel ด้วย SheetJS (เพื่อเลี่ยง CPU limit ของ Worker)
  return c.json({ columns: cols, data: filtered });
});

// ── movements export ─────────────────────────────────────────────────────────
function dateRange(from?: string, to?: string): [string, string] | null | "invalid" {
  if (!from || !to) return null;
  const re = /^\d{4}-\d{2}-\d{2}$/;
  return re.test(from) && re.test(to) ? [from, to] : "invalid";
}

reportsApp.get("/movements/export", async (c) => {
  const session = c.get("session")!;
  if (session.role !== "OWNER") return c.json({ error: "forbidden" }, 403);
  const role = session.role;
  const { date_from, date_to } = c.req.query() as { date_from?: string; date_to?: string };
  const range = dateRange(date_from, date_to);
  if (range === "invalid") return c.json({ error: "invalid_input", message: "รูปแบบวันที่ไม่ถูกต้อง (ปปปป-ดด-วว)" }, 400);
  const whereDate = range ? "AND d.doc_date BETWEEN ? AND ?" : "";
  const rows = await c.env.DB.prepare(`
    SELECT i.sku, i.name_th, d.doc_type, d.doc_date,
           SUM(CASE WHEN sm.direction=1 THEN sm.qty_milli ELSE 0 END) as in_milli,
           SUM(CASE WHEN sm.direction=-1 THEN sm.qty_milli ELSE 0 END) as out_milli,
           SUM(sm.qty_milli*sm.unit_cost_x4/1000) as value_x4,
           w.name as warehouse
    FROM stock_movements sm
    LEFT JOIN document_lines dl ON dl.id=sm.line_id
    JOIN documents d ON d.id=sm.document_id
    JOIN items i ON i.id=sm.item_id
    JOIN warehouses w ON w.id=sm.warehouse_id
    WHERE 1=1 ${whereDate}
    GROUP BY i.id, d.doc_type, d.doc_date, w.id
    ORDER BY d.doc_date DESC
  `).bind(...(range ?? [])).all();
  const cols = [
    { key: "sku", label: "รหัส" },
    { key: "name_th", label: "ชื่อสินค้า" },
    { key: "doc_type", label: "ประเภท" },
    { key: "doc_date", label: "วันที่" },
    { key: "warehouse", label: "คลัง" },
    { key: "in_milli", label: "รับเข้า" },
    { key: "out_milli", label: "ตัดออก" },
    { key: "value_x4", label: "มูลค่า" },
  ];
  return c.json({ columns: cols, data: rows.results });
});

// ── movements summary ─────────────────────────────────────────────────────────
reportsApp.get("/movements", async (c) => {
  const role = c.get("session")!.role;
  const { date_start, date_end } = c.req.query() as { date_start?: string; date_end?: string };
  const range = dateRange(date_start, date_end);
  if (range === "invalid") return c.json({ error: "invalid_input", message: "รูปแบบวันที่ไม่ถูกต้อง (ปปปป-ดด-วว)" }, 400);
  const whereDate = range ? "AND d.doc_date BETWEEN ? AND ?" : "";
  const rows = await c.env.DB.prepare(`
    SELECT i.sku, i.name_th, d.doc_type, d.doc_date,
           SUM(CASE WHEN sm.direction=1 THEN sm.qty_milli ELSE 0 END) as in_milli,
           SUM(CASE WHEN sm.direction=-1 THEN sm.qty_milli ELSE 0 END) as out_milli,
           ${role === "OWNER" ? "SUM(sm.qty_milli*sm.unit_cost_x4/1000) as value_x4," : ""}
           w.name as warehouse
    FROM stock_movements sm
    LEFT JOIN document_lines dl ON dl.id=sm.line_id
    JOIN documents d ON d.id=sm.document_id
    JOIN items i ON i.id=sm.item_id
    JOIN warehouses w ON w.id=sm.warehouse_id
    WHERE 1=1 ${whereDate}
    GROUP BY i.id, d.doc_type, d.doc_date, w.id
    ORDER BY d.doc_date DESC
  `).bind(...(range ?? [])).all();
  return c.json({ data: rows.results });
});

// ── stock card รายตัว ─────────────────────────────────────────────────────────
reportsApp.get("/card/:item_id", async (c) => {
  const role = c.get("session")!.role;
  const itemId = Number(c.req.param("item_id"));
  const rows = await c.env.DB.prepare(`
    SELECT d.doc_no, d.doc_date, d.doc_type, sm.direction,
           sm.qty_milli, sm.balance_qty_after_milli,
           ${role === "OWNER" ? "sm.unit_cost_x4, sm.avg_cost_after_x4," : ""}
           l.lot_no, w.name as warehouse
    FROM stock_movements sm
    JOIN documents d ON d.id=sm.document_id
    JOIN warehouses w ON w.id=sm.warehouse_id
    LEFT JOIN lots l ON l.id=sm.lot_id
    WHERE sm.item_id=?
    ORDER BY d.doc_date, sm.id
  `).bind(itemId).all();
  return c.json({ data: rows.results });
});

// ── lots ──────────────────────────────────────────────────────────────────────
reportsApp.get("/lots", async (c) => {
  const role = c.get("session")!.role;
  const rows = await c.env.DB.prepare(`
    SELECT i.sku, i.name_th,
           l.lot_no, l.mfg_date, l.expiry_date, l.po_no, l.manufacturer_name,
           w.name as warehouse,
           COALESCE(sb.qty_on_hand_milli,0) as qty_on_hand_milli,
           ${role === "OWNER" ? "COALESCE(sb.avg_cost_x4,0) as avg_cost_x4," : ""}
           u.name_th as unit
    FROM lots l
    JOIN items i ON i.id=l.item_id
    LEFT JOIN units u ON u.id=i.unit_id
    LEFT JOIN stock_balances sb ON sb.item_id=l.item_id AND sb.lot_id=l.id
    LEFT JOIN warehouses w ON w.id=sb.warehouse_id
    ORDER BY l.expiry_date ASC
  `).all();
  return c.json({ data: rows.results });
});

// ── expiring ──────────────────────────────────────────────────────────────────
reportsApp.get("/expiring", async (c) => {
  const days = Number(c.req.query("days") || 30);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + days);
  const rows = await c.env.DB.prepare(`
    SELECT i.sku, i.name_th, l.lot_no, l.expiry_date,
           COALESCE(sb.qty_on_hand_milli,0) as qty_on_hand_milli,
           w.name as warehouse, u.name_th as unit
    FROM lots l
    JOIN items i ON i.id=l.item_id
    LEFT JOIN units u ON u.id=i.unit_id
    LEFT JOIN stock_balances sb ON sb.item_id=l.item_id AND sb.lot_id=l.id
    LEFT JOIN warehouses w ON w.id=sb.warehouse_id
    WHERE l.expiry_date <= ? AND l.expiry_date >= date('now')
      AND COALESCE(sb.qty_on_hand_milli,0) > 0
    ORDER BY l.expiry_date ASC
  `).bind(cutoff.toISOString().slice(0, 10)).all();
  return c.json({ data: rows.results });
});

// ── reorder ───────────────────────────────────────────────────────────────────
reportsApp.get("/reorder", async (c) => {
  const rows = await c.env.DB.prepare(`
    SELECT i.sku, i.name_th,
           i.reorder_point_milli,
           SUM(COALESCE(sb.qty_on_hand_milli,0)) as total_qty_milli,
           u.name_th as unit
    FROM items i
    LEFT JOIN stock_balances sb ON sb.item_id=i.id
    LEFT JOIN units u ON u.id=i.unit_id
    WHERE i.status='ACTIVE' AND i.reorder_point_milli > 0
    GROUP BY i.id
    HAVING total_qty_milli < i.reorder_point_milli
    ORDER BY (i.reorder_point_milli - total_qty_milli) DESC
  `).all();
  return c.json({ data: rows.results });
});

export default reportsApp;
