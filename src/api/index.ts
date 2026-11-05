import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import { drizzle } from "drizzle-orm/d1";
import { hashPassword } from "../domain/auth";
import { users, sessions, items as itemsTable, categories, units } from "../db/schema";
import { eq, like, or } from "drizzle-orm";
import { sql } from "drizzle-orm";
import importApp from "./import-service";
import usersApp from "./users-service";
import docApp from "./documents-service";
import reportsApp from "./reports-service";
import { withThaiMessage } from "../domain/errorMessages";
import { extractDbErrorCode } from "../domain/documentEngine";

type Bindings = {
  DB: D1Database;
  ADMIN_EMAIL: string;
  APP_SECRET: string;
};

type Variables = {
  session: { userId: number; email: string; role: string } | null;
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ── error responses: ทุก error มี message ภาษาไทยคู่กับรหัส error ───────────────
app.use("/api/*", async (c, next) => {
  await next();
  if (c.res.status < 400 || !c.res.headers.get("content-type")?.includes("application/json")) return;
  const body = await c.res.clone().json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.error !== "string" || typeof body.message === "string") return;
  const headers = new Headers(c.res.headers);
  headers.delete("content-length");
  c.res = new Response(JSON.stringify(withThaiMessage(body)), { status: c.res.status, headers });
});

// ── session middleware ─────────────────────────────────────────────────────────
app.use("/api/*", async (c, next) => {
  const sessionId = getCookie(c, "session");
  if (sessionId) {
    const db = drizzle(c.env.DB);
    const row = await c.env.DB.prepare(
      `SELECT s.id, s.expires_at, u.id as user_id, u.email, u.role, u.is_active
       FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=?`,
    ).bind(sessionId).first() as any;
    if (row && new Date(row.expires_at).getTime() > Date.now() && row.is_active) {
      c.set("session", { userId: row.user_id, email: row.email, role: row.role });
    } else {
      c.set("session", null);
    }
  } else {
    c.set("session", null);
  }
  await next();
});

// ── health ────────────────────────────────────────────────────────────────────
app.get("/api/health", (c) => c.json({ ok: true }));

// ── first-run check ───────────────────────────────────────────────────────────
app.get("/api/setup/status", async (c) => {
  const row = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM users").first() as any;
  return c.json({ needsSetup: row.cnt === 0 });
});

app.post("/api/setup/init", async (c) => {
  const row = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM users").first() as any;
  if (row.cnt > 0) return c.json({ error: "already_initialized" }, 409);

  const schema = z.object({ password: z.string().min(8) });
  const body = await c.req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_input", issues: parsed.error.issues }, 400);

  const hash = await hashPassword(parsed.data.password);
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'OWNER')").bind(c.env.ADMIN_EMAIL, hash),
    c.env.DB.prepare("INSERT OR IGNORE INTO units (id, code, name_th, decimal_places) VALUES (1,'PCS','ชิ้น',0),(2,'SET','เครื่อง',0),(3,'ROLL','ม้วน',0),(4,'BOX','กล่อง',0),(5,'KG','กก.',3)"),
    c.env.DB.prepare("INSERT OR IGNORE INTO warehouses (id, code, name, is_active) VALUES (1,'WH01','คลังหลัก',1),(2,'WH02','คลังสาขา',1)"),
  ]);

  return c.json({ ok: true });
});

// ── auth ──────────────────────────────────────────────────────────────────────
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

app.post("/api/auth/login", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_input" }, 400);

  const { email, password } = parsed.data;
  const user = await c.env.DB.prepare(
    "SELECT id, email, password_hash, role, is_active, failed_logins, locked_until FROM users WHERE email=?",
  ).bind(email).first() as any;

  if (!user) return c.json({ error: "invalid_credentials" }, 401);

  const { checkLockout, verifyPassword, generateSessionId } = await import("../domain/auth");
  if (checkLockout(user.failed_logins, user.locked_until)) {
    return c.json({ error: "account_locked" }, 403);
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    const newFails = user.failed_logins + 1;
    if (newFails >= 10) {
      const lockedUntil = new Date(Date.now() + 15 * 60_000).toISOString();
      await c.env.DB.prepare("UPDATE users SET failed_logins=?, locked_until=? WHERE id=?")
        .bind(newFails, lockedUntil, user.id).run();
      return c.json({ error: "account_locked" }, 403);
    }
    await c.env.DB.prepare("UPDATE users SET failed_logins=? WHERE id=?").bind(newFails, user.id).run();
    return c.json({ error: "invalid_credentials" }, 401);
  }

  // Only reveal "disabled" after the correct password, so the message cannot be used to probe emails.
  if (!user.is_active) return c.json({ error: "account_disabled" }, 403);

  await c.env.DB.prepare("UPDATE users SET failed_logins=0, locked_until=NULL WHERE id=?").bind(user.id).run();

  const sessionId = generateSessionId();
  const expiresAt = new Date(Date.now() + 8 * 3_600_000).toISOString();
  await c.env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?,?,?)")
    .bind(sessionId, user.id, expiresAt).run();

  setCookie(c, "session", sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    expires: new Date(expiresAt),
  });

  return c.json({ ok: true, role: user.role });
});

app.post("/api/auth/logout", async (c) => {
  const sessionId = getCookie(c, "session");
  if (sessionId) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE id=?").bind(sessionId).run();
  }
  deleteCookie(c, "session", { path: "/" });
  return c.json({ ok: true });
});

app.get("/api/auth/me", (c) => {
  const session = c.get("session");
  if (!session) return c.json({ error: "unauthorized" }, 401);
  return c.json({ email: session.email, role: session.role });
});

// ── items ─────────────────────────────────────────────────────────────────────
const itemSchema = z.object({
  sku: z.string().min(1).max(100),
  name_th: z.string().min(1).max(200),
  barcode: z.string().trim().max(50).optional().transform(v => (v ? v : undefined)),
  category_id: z.number().int().positive().optional(),
  unit_id: z.number().int().positive(),
  track_lot: z.boolean().optional().default(false),
  reorder_point_milli: z.number().int().min(0).optional().default(0),
  standard_cost_x4: z.number().int().min(0).optional().default(0),
});

function applyRoleFilter(item: any, role: string) {
  if (role !== "OWNER") {
    const { standard_cost_x4, ...rest } = item;
    return rest;
  }
  return item;
}

// ── units ─────────────────────────────────────────────────────────────────────
app.get("/api/units", async (c) => {
  const session = c.get("session");
  if (!session) return c.json({ error: "unauthorized" }, 401);
  const rows = await c.env.DB.prepare("SELECT id, code, name_th, decimal_places FROM units ORDER BY id").all();
  return c.json({ units: rows.results });
});

app.post("/api/units", async (c) => {
  const session = c.get("session");
  if (!session) return c.json({ error: "unauthorized" }, 401);
  if (session.role !== "OWNER") return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json().catch(() => ({}));
  const schema = z.object({ code: z.string().min(1).max(20), name_th: z.string().min(1).max(50), decimal_places: z.number().int().min(0).max(6).default(0) });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  try {
    const r = await c.env.DB.prepare("INSERT INTO units (code, name_th, decimal_places) VALUES (?,?,?)").bind(parsed.data.code, parsed.data.name_th, parsed.data.decimal_places).run();
    return c.json({ ok: true, id: r.meta.last_row_id });
  } catch (e: any) {
    if (String(e).includes("UNIQUE")) return c.json({ error: "รหัสหน่วยซ้ำ" }, 400);
    throw e;
  }
});

app.put("/api/units/:id", async (c) => {
  const session = c.get("session");
  if (!session) return c.json({ error: "unauthorized" }, 401);
  if (session.role !== "OWNER") return c.json({ error: "forbidden" }, 403);
  const id = Number(c.req.param("id"));
  const body = await c.req.json().catch(() => ({}));
  const schema = z.object({ code: z.string().min(1).max(20).optional(), name_th: z.string().min(1).max(50).optional(), decimal_places: z.number().int().min(0).max(6).optional() });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  const { code, name_th, decimal_places } = parsed.data;
  if (code !== undefined) await c.env.DB.prepare("UPDATE units SET code=? WHERE id=?").bind(code, id).run();
  if (name_th !== undefined) await c.env.DB.prepare("UPDATE units SET name_th=? WHERE id=?").bind(name_th, id).run();
  if (decimal_places !== undefined) await c.env.DB.prepare("UPDATE units SET decimal_places=? WHERE id=?").bind(decimal_places, id).run();
  return c.json({ ok: true });
});

// ── warehouses ────────────────────────────────────────────────────────────────
app.get("/api/warehouses", async (c) => {
  const session = c.get("session");
  if (!session) return c.json({ error: "unauthorized" }, 401);
  const rows = await c.env.DB.prepare("SELECT id, code, name FROM warehouses WHERE is_active=1 ORDER BY code").all();
  return c.json({ warehouses: rows.results });
});

app.post("/api/warehouses", async (c) => {
  const session = c.get("session");
  if (!session) return c.json({ error: "unauthorized" }, 401);
  if (session.role !== "OWNER") return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json().catch(() => ({}));
  const schema = z.object({ code: z.string().min(1).max(20), name: z.string().min(1).max(100) });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  try {
    const r = await c.env.DB.prepare("INSERT INTO warehouses (code, name, is_active) VALUES (?,?,1)").bind(parsed.data.code, parsed.data.name).run();
    return c.json({ ok: true, id: r.meta.last_row_id });
  } catch (e: any) {
    if (String(e).includes("UNIQUE")) return c.json({ error: "รหัสคลังซ้ำ" }, 400);
    throw e;
  }
});

app.put("/api/warehouses/:id", async (c) => {
  const session = c.get("session");
  if (!session) return c.json({ error: "unauthorized" }, 401);
  if (session.role !== "OWNER") return c.json({ error: "forbidden" }, 403);
  const id = Number(c.req.param("id"));
  const body = await c.req.json().catch(() => ({}));
  const schema = z.object({ name: z.string().min(1).max(100).optional(), is_active: z.boolean().optional() });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  if (parsed.data.name !== undefined) await c.env.DB.prepare("UPDATE warehouses SET name=? WHERE id=?").bind(parsed.data.name, id).run();
  if (parsed.data.is_active !== undefined) await c.env.DB.prepare("UPDATE warehouses SET is_active=? WHERE id=?").bind(parsed.data.is_active ? 1 : 0, id).run();
  return c.json({ ok: true });
});

// ── lots upsert (สำหรับ Receive) ─────────────────────────────────────────────
app.post("/api/lots", async (c) => {
  const session = c.get("session");
  if (!session) return c.json({ error: "unauthorized" }, 401);
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: "invalid_json" }, 400);
  const { item_id, lot_no, mfg_date, expiry_date, po_no, manufacturer_name } = body;
  if (!item_id || !lot_no || !mfg_date || !expiry_date) return c.json({ error: "missing_fields" }, 400);
  const nowIso = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO lots (item_id, lot_no, mfg_date, expiry_date, po_no, manufacturer_name, created_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(item_id, lot_no) DO NOTHING`,
  ).bind(item_id, lot_no, mfg_date, expiry_date, po_no ?? null, manufacturer_name ?? null, nowIso).run();
  const row = await c.env.DB.prepare("SELECT id FROM lots WHERE item_id=? AND lot_no=?").bind(item_id, lot_no).first() as { id: number };
  return c.json({ ok: true, lot_id: row.id });
});

app.get("/api/items/by-code/:code", async (c) => {
  const session = c.get("session");
  if (!session) return c.json({ error: "unauthorized" }, 401);
  const code = c.req.param("code").trim();
  const row = await c.env.DB.prepare(
    "SELECT * FROM items WHERE (barcode=? OR sku=?) AND status='ACTIVE' LIMIT 1"
  ).bind(code, code).first() as any;
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json(applyRoleFilter(row, session.role));
});

app.get("/api/items", async (c) => {
  const session = c.get("session");
  if (!session) return c.json({ error: "unauthorized" }, 401);

  const q = (c.req.query("q") ?? c.req.query("search") ?? "").trim();
  // OWNER เห็นสินค้าทุกสถานะ STAFF เห็นเฉพาะ ACTIVE
  const statusFilter = session.role === "OWNER" ? "" : "AND status='ACTIVE'";
  let rows: any[];
  if (q && /^\d{8,}$/.test(q)) {
    rows = await c.env.DB.prepare(
      `SELECT * FROM items WHERE (barcode=? OR sku=?) ${statusFilter}`
    ).bind(q, q).all().then(r => r.results);
  } else if (q) {
    rows = await c.env.DB.prepare(
      `SELECT * FROM items WHERE (name_th LIKE ? OR sku LIKE ? OR barcode LIKE ?) ${statusFilter}`
    ).bind(`%${q}%`, `%${q}%`, `%${q}%`).all().then(r => r.results);
  } else {
    rows = await c.env.DB.prepare(`SELECT * FROM items WHERE 1=1 ${statusFilter}`).all().then(r => r.results);
  }

  return c.json({ items: rows.map((item) => applyRoleFilter(item, session.role)) });
});

app.post("/api/items", async (c) => {
  const session = c.get("session");
  if (!session) return c.json({ error: "unauthorized" }, 401);
  if (session.role !== "OWNER") return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json().catch(() => ({}));
  const parsed = itemSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_input", issues: parsed.error.issues }, 400);

  const d = parsed.data;

  const unitRow = await c.env.DB.prepare("SELECT id FROM units WHERE id=?").bind(d.unit_id).first();
  if (!unitRow) return c.json({ error: "หน่วยนับไม่ถูกต้อง" }, 400);

  // Bug 5: ตรวจบาร์โค้ดซ้ำก่อนบันทึก
  if (d.barcode) {
    const dup = await c.env.DB.prepare("SELECT id FROM items WHERE barcode=?").bind(d.barcode).first();
    if (dup) return c.json({ error: "barcode_duplicate", message: "บาร์โค้ดนี้มีสินค้าอื่นใช้อยู่แล้ว" }, 409);
  }

  let result: Awaited<ReturnType<D1PreparedStatement["run"]>>;
  try {
    result = await c.env.DB.prepare(
      `INSERT INTO items (sku, name_th, barcode, category_id, unit_id, track_lot, reorder_point_milli, standard_cost_x4)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).bind(d.sku, d.name_th, d.barcode ?? null, d.category_id ?? null, d.unit_id, d.track_lot ? 1 : 0, d.reorder_point_milli, d.standard_cost_x4).run();
  } catch (e: any) {
    const msg = String(e);
    if (msg.includes("UNIQUE") && msg.includes("sku")) return c.json({ error: "รหัสสินค้าซ้ำ" }, 400);
    if (msg.includes("UNIQUE") && msg.includes("barcode")) return c.json({ error: "barcode_duplicate", message: "บาร์โค้ดนี้มีสินค้าอื่นใช้อยู่แล้ว" }, 409);
    if (msg.includes("UNIQUE")) return c.json({ error: "ข้อมูลซ้ำ" }, 400);
    throw e;
  }

  const id = result.meta.last_row_id;
  await c.env.DB.prepare(
    "INSERT INTO audit_logs (table_name, record_id, action, old_json, new_json, user_id, at) VALUES ('items',?,'INSERT',NULL,?,?,?)",
  ).bind(String(id), JSON.stringify(d), session.userId, new Date().toISOString()).run();

  return c.json({ ok: true, id });
});

app.put("/api/items/:id", async (c) => {
  const session = c.get("session");
  if (!session) return c.json({ error: "unauthorized" }, 401);
  if (session.role !== "OWNER") return c.json({ error: "forbidden" }, 403);

  const id = Number(c.req.param("id"));
  const old = await c.env.DB.prepare("SELECT * FROM items WHERE id=?").bind(id).first();
  if (!old) return c.json({ error: "not_found" }, 404);

  const body = await c.req.json().catch(() => ({}));
  const parsed = itemSchema.partial().safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_input", issues: parsed.error.issues }, 400);

  // Bug 5: ตรวจบาร์โค้ดซ้ำกับสินค้าอื่น
  if (parsed.data.barcode) {
    const dup = await c.env.DB.prepare("SELECT id FROM items WHERE barcode=? AND id<>?").bind(parsed.data.barcode, id).first();
    if (dup) return c.json({ error: "barcode_duplicate", message: "บาร์โค้ดนี้มีสินค้าอื่นใช้อยู่แล้ว" }, 409);
  }

  const merged = { ...old, ...parsed.data } as any;
  await c.env.DB.prepare(
    `UPDATE items SET sku=?, name_th=?, barcode=?, category_id=?, unit_id=?, track_lot=?, reorder_point_milli=?, standard_cost_x4=? WHERE id=?`,
  ).bind(merged.sku, merged.name_th, merged.barcode ?? null, merged.category_id ?? null, merged.unit_id, merged.track_lot ? 1 : 0, merged.reorder_point_milli, merged.standard_cost_x4, id).run();

  await c.env.DB.prepare(
    "INSERT INTO audit_logs (table_name, record_id, action, old_json, new_json, user_id, at) VALUES ('items',?,'UPDATE',?,?,?,?)",
  ).bind(String(id), JSON.stringify(old), JSON.stringify(merged), session.userId, new Date().toISOString()).run();

  return c.json({ ok: true });
});

// ── PATCH /api/items/:id/status — ปิด/เปิดใช้งานสินค้า ──────────────────────
app.patch("/api/items/:id/status", async (c) => {
  const session = c.get("session");
  if (!session) return c.json({ error: "unauthorized" }, 401);
  if (session.role !== "OWNER") return c.json({ error: "forbidden" }, 403);

  const id = Number(c.req.param("id"));
  const body = await c.req.json().catch(() => ({}));
  const parsed = z.object({ status: z.enum(["ACTIVE", "INACTIVE"]) }).safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_input" }, 400);

  const old = await c.env.DB.prepare("SELECT * FROM items WHERE id=?").bind(id).first();
  if (!old) return c.json({ error: "not_found" }, 404);

  await c.env.DB.prepare("UPDATE items SET status=? WHERE id=?").bind(parsed.data.status, id).run();
  await c.env.DB.prepare(
    "INSERT INTO audit_logs (table_name, record_id, action, old_json, new_json, user_id, at) VALUES ('items',?,'UPDATE',?,?,?,?)",
  ).bind(String(id), JSON.stringify(old), JSON.stringify({ ...old, status: parsed.data.status }), session.userId, new Date().toISOString()).run();

  return c.json({ ok: true });
});

// ── POST /api/admin/reset-data — ล้างข้อมูลทดสอบ (OWNER เท่านั้น) ──────────
app.post("/api/admin/reset-data", async (c) => {
  const session = c.get("session");
  if (!session) return c.json({ error: "unauthorized" }, 401);
  if (session.role !== "OWNER") return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json().catch(() => ({}));
  if (!z.object({ confirm: z.literal("RESET") }).safeParse(body).success) {
    return c.json({ error: "confirm_required", message: "ต้องส่ง confirm: 'RESET' เพื่อยืนยัน" }, 400);
  }

  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM stock_movements"),
    c.env.DB.prepare("DELETE FROM stock_balances"),
    c.env.DB.prepare("DELETE FROM document_lines"),
    c.env.DB.prepare("DELETE FROM documents"),
    c.env.DB.prepare("DELETE FROM lots"),
    c.env.DB.prepare("DELETE FROM items"),
    c.env.DB.prepare("DELETE FROM categories"),
    c.env.DB.prepare("DELETE FROM units"),
    c.env.DB.prepare("DELETE FROM warehouses"),
    c.env.DB.prepare("DELETE FROM doc_sequences"),
    c.env.DB.prepare(
      "INSERT INTO audit_logs (table_name, record_id, action, old_json, new_json, user_id, at) VALUES ('system','reset-data','DELETE',NULL,'{\"action\":\"RESET_DATA\"}',?,?)",
    ).bind(session.userId, new Date().toISOString()),
  ]);

  return c.json({ ok: true, message: "ล้างข้อมูลทั้งหมดเรียบร้อย (ยกเว้น users และ sessions)" });
});

// ── reset password (ยืนยันด้วย APP_SECRET) ───────────────────────────────────
app.post("/api/auth/reset-password", async (c) => {
  const schema = z.object({
    app_secret: z.string().min(1),
    new_password: z.string().min(8),
  });
  const body = await c.req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_input", issues: parsed.error.issues }, 400);

  if (parsed.data.app_secret !== c.env.APP_SECRET) {
    return c.json({ error: "invalid_secret" }, 401);
  }

  const { hashPassword } = await import("../domain/auth");
  const hash = await hashPassword(parsed.data.new_password);
  await c.env.DB.prepare("UPDATE users SET password_hash=?, failed_logins=0, locked_until=NULL WHERE email=?")
    .bind(hash, c.env.ADMIN_EMAIL).run();
  await c.env.DB.prepare("DELETE FROM sessions").run();

  return c.json({ ok: true });
});

// ── import ────────────────────────────────────────────────────────────────────
app.route("/", importApp);
app.route("/", usersApp);

// ── documents ─────────────────────────────────────────────────────────────────
app.route("/", docApp);
app.route("/api/reports", reportsApp);

// ── 404 / error handlers ──────────────────────────────────────────────────────
app.notFound((c) => {
  if (c.req.path.startsWith("/api/")) return c.json(withThaiMessage({ error: "not_found" }), 404);
  return c.notFound();
});

app.onError((err, c) => {
  console.error(err);
  if (c.req.path.startsWith("/api/")) {
    if (extractDbErrorCode(err) === "barcode_duplicate") return c.json(withThaiMessage({ error: "barcode_duplicate" }), 409);
    if (extractDbErrorCode(err) === "insufficient_stock") return c.json(withThaiMessage({ error: "insufficient_stock" }), 422);
    return c.json(withThaiMessage({ error: (err as Error).message || "internal_error" }), 500);
  }
  return c.text("Internal error", 500);
});

// ── frontend fallback ─────────────────────────────────────────────────────────
app.get("*", async (c) => {
  try {
    const { serveStatic } = await import("hono/cloudflare-workers");
    return serveStatic({ root: "./" })(c, async () => {});
  } catch {
    return c.html("<!doctype html><html><body><div id='root'></div><script type='module' src='/src/web/main.tsx'></script></body></html>");
  }
});

export default app;
