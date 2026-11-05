import { Hono } from "hono";
import { z } from "zod";
import { computePostDocumentUpdates } from "../domain/postDocument";
import { buildIdempotencyResponse, buildDocNo, classifyExistingDoc, extractDbErrorCode } from "../domain/documentEngine";
import { bangkokToday, isFutureDocDate } from "../domain/docDate";
import { loadBalanceSnapshot, postDraftDocument, type StockLine, type DraftDoc } from "./posting";

type Bindings = { DB: D1Database; ADMIN_EMAIL: string; APP_SECRET: string };
type Variables = { session: { userId: number; email: string; role: string } | null };

const docApp = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ── schemas ───────────────────────────────────────────────────────────────────

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const issueLineSchema = z.object({
  item_id: z.number().int().positive(),
  lot_id: z.number().int().min(0).nullish().transform(v => v ?? 0),
  qty_milli: z.number().int().positive(),
  unit_cost_x4: z.number().int().min(0).default(0),
});

export const receiveLineSchema = z.object({
  item_id: z.number().int().positive(),
  qty_milli: z.number().int().positive(),
  unit_cost_x4: z.number().int().min(0).default(0),
  lot_id: z.number().int().min(0).nullish().transform(v => v ?? undefined),
  // ล็อต — ถ้ามีจะสร้าง/หาล็อตก่อนบันทึก
  lot_no: z.string().max(100).optional(),
  lot_mfg_date: dateSchema.optional(),
  lot_expiry_date: dateSchema.optional(),
  lot_po_no: z.string().max(100).optional(),
  lot_manufacturer_name: z.string().max(200).optional(),
});

const headerFields = {
  warehouse_id: z.number().int().positive(),
  doc_date: dateSchema,
  ref_text: z.string().max(200).optional(),
  note: z.string().max(500).optional(),
};

const receiveSchema = z.object({ idempotency_key: z.string().min(1).max(128), ...headerFields, lines: z.array(receiveLineSchema).min(1).max(200) });
const issueSchema = z.object({ idempotency_key: z.string().min(1).max(128), ...headerFields, lines: z.array(issueLineSchema).min(1).max(200) });
const receiveEditSchema = z.object({ ...headerFields, lines: z.array(receiveLineSchema).min(1).max(200) });
const issueEditSchema = z.object({ ...headerFields, lines: z.array(issueLineSchema).min(1).max(200) });

type ReceiveLineIn = z.infer<typeof receiveLineSchema>;
type IssueLineIn = z.infer<typeof issueLineSchema>;
type DocType = "RECEIVE" | "ISSUE";

// ── helpers ───────────────────────────────────────────────────────────────────

async function reserveDocNo(db: D1Database, docType: string, yymm: string): Promise<{ doc_no: string; seq: number }> {
  // RETURNING ทำให้ atomic — ได้เลขของตัวเองแน่นอน ไม่มี race condition
  const row = await db.prepare(
    `INSERT INTO doc_sequences (doc_type, yymm, last_no) VALUES (?,?,1)
     ON CONFLICT(doc_type, yymm) DO UPDATE SET last_no = last_no + 1
     RETURNING last_no`,
  ).bind(docType, yymm).first() as { last_no: number };
  return { doc_no: buildDocNo(docType as "RECEIVE" | "ISSUE" | "CANCEL", yymm, row.last_no), seq: row.last_no };
}

async function nextDocNo(db: D1Database, docType: string, yymm: string): Promise<string> {
  return (await reserveDocNo(db, docType, yymm)).doc_no;
}

// Give an unused number back only while it is still the latest, so a concurrent reservation is never reused.
async function releaseDocNo(db: D1Database, docType: string, yymm: string, seq: number) {
  await db.prepare("UPDATE doc_sequences SET last_no = last_no - 1 WHERE doc_type=? AND yymm=? AND last_no=?")
    .bind(docType, yymm, seq).run();
}

async function resolveLines(db: D1Database, docType: DocType, lines: Array<ReceiveLineIn | IssueLineIn>): Promise<StockLine[]> {
  if (docType === "ISSUE") {
    return (lines as IssueLineIn[]).map(l => ({ item_id: l.item_id, lot_id: l.lot_id ?? 0, qty_milli: l.qty_milli, unit_cost_x4: 0 }));
  }
  const nowIso = new Date().toISOString();
  const out: StockLine[] = [];
  for (const line of lines as ReceiveLineIn[]) {
    let lot_id = line.lot_id ?? 0; // sentinel 0 = ไม่มีล็อต
    if (line.lot_no) {
      await db.prepare(
        `INSERT INTO lots (item_id, lot_no, mfg_date, expiry_date, po_no, manufacturer_name, created_at)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(item_id, lot_no) DO NOTHING`,
      ).bind(line.item_id, line.lot_no, line.lot_mfg_date ?? null, line.lot_expiry_date ?? null, line.lot_po_no ?? null, line.lot_manufacturer_name ?? null, nowIso).run();
      const lotRow = await db.prepare("SELECT id FROM lots WHERE item_id=? AND lot_no=?")
        .bind(line.item_id, line.lot_no).first() as { id: number } | null;
      if (lotRow) lot_id = lotRow.id;
    }
    out.push({ item_id: line.item_id, lot_id, qty_milli: line.qty_milli, unit_cost_x4: line.unit_cost_x4 });
  }
  return out;
}

function insertLineStmt(db: D1Database, docRef: { id?: number; key?: string }, l: StockLine, onlyIfDraft: boolean) {
  const docIdExpr = docRef.id !== undefined ? "?" : "(SELECT id FROM documents WHERE idempotency_key=?)";
  const docParam = docRef.id !== undefined ? docRef.id : docRef.key!;
  const where = onlyIfDraft ? ` WHERE EXISTS (SELECT 1 FROM documents WHERE id=${docIdExpr} AND status='DRAFT')` : "";
  const params = onlyIfDraft ? [docParam, l.item_id, l.lot_id || null, l.qty_milli, l.unit_cost_x4, docParam] : [docParam, l.item_id, l.lot_id || null, l.qty_milli, l.unit_cost_x4];
  return db.prepare(
    `INSERT INTO document_lines (document_id, item_id, lot_id, qty_milli, unit_cost_x4) SELECT ${docIdExpr},?,?,?,?${where}`,
  ).bind(...params);
}

function auditStmt(db: D1Database, recordId: number, action: "INSERT" | "UPDATE" | "DELETE", oldVal: unknown, newVal: unknown, userId: number) {
  return db.prepare(
    "INSERT INTO audit_logs (table_name, record_id, action, old_json, new_json, user_id, at) VALUES ('documents',?,?,?,?,?,?)",
  ).bind(String(recordId), action, oldVal == null ? null : JSON.stringify(oldVal), newVal == null ? null : JSON.stringify(newVal), userId, new Date().toISOString());
}

async function findByKey(db: D1Database, key: string) {
  return await db.prepare(
    `SELECT d.id, d.doc_no, d.status, (SELECT COUNT(*) FROM document_lines dl WHERE dl.document_id=d.id) AS line_count
     FROM documents d WHERE d.idempotency_key=?`,
  ).bind(key).first() as { id: number; doc_no: string; status: string; line_count: number } | null;
}

function draftResponse(doc: { id: number; doc_no: string }, idempotent = false) {
  return { ok: true, draft: true, status: "DRAFT", id: doc.id, doc_id: doc.id, doc_no: doc.doc_no, ...(idempotent ? { idempotent: true } : {}) };
}

/** สร้างเอกสารรับเข้า/ตัดออก: วันที่อนาคต → เก็บเป็นดราฟ, วันนี้หรือย้อนหลัง → บันทึกทันที */
async function createDocument(c: any, docType: DocType, data: z.infer<typeof receiveSchema> | z.infer<typeof issueSchema>) {
  const db: D1Database = c.env.DB;
  const session = c.get("session");
  const { idempotency_key, warehouse_id, doc_date, ref_text, note } = data;

  const existing = await findByKey(db, idempotency_key);
  const kind = classifyExistingDoc(existing);
  if (kind === "posted") return c.json(buildIdempotencyResponse(existing!));
  if (kind === "draft") return c.json(draftResponse(existing!, true));
  if (kind === "stale") {
    await db.prepare("DELETE FROM documents WHERE id=? AND status='DRAFT' AND NOT EXISTS (SELECT 1 FROM document_lines WHERE document_id=?)")
      .bind(existing!.id, existing!.id).run();
  }

  const lines = await resolveLines(db, docType, data.lines);
  const yymm = doc_date.slice(2, 4) + doc_date.slice(5, 7);
  const { doc_no, seq } = await reserveDocNo(db, docType, yymm);
  const insertDoc = db.prepare(
    `INSERT INTO documents (doc_type, doc_no, doc_date, warehouse_id, status, ref_text, note, idempotency_key, created_by)
     VALUES (?,?,?,?,'DRAFT',?,?,?,?)`,
  ).bind(docType, doc_no, doc_date, warehouse_id, ref_text ?? null, note ?? null, idempotency_key, session.userId);

  if (isFutureDocDate(doc_date)) {
    // ดราฟ: เอกสาร + รายการในครั้งเดียว ไม่แตะยอดสต็อก
    try {
      await db.batch([insertDoc, ...lines.map(l => insertLineStmt(db, { key: idempotency_key }, l, false))]);
    } catch (err) {
      const again = await findByKey(db, idempotency_key);
      if (again) return c.json(again.status === "DRAFT" ? draftResponse(again, true) : buildIdempotencyResponse(again));
      throw err;
    }
    const doc = await findByKey(db, idempotency_key);
    await auditStmt(db, doc!.id, "INSERT", null, { doc_type: docType, doc_no, doc_date, warehouse_id, status: "DRAFT", lines }, session.userId).run();
    return c.json(draftResponse(doc!));
  }

  let doc_id: number;
  try {
    doc_id = (await insertDoc.run()).meta.last_row_id;
  } catch (err) {
    await releaseDocNo(db, docType, yymm, seq);
    const again = await findByKey(db, idempotency_key);
    if (again) return c.json(buildIdempotencyResponse(again));
    throw err;
  }

  const draft: DraftDoc = { id: doc_id, doc_type: docType, warehouse_id, doc_date };
  let result;
  try {
    result = await postDraftDocument(db, draft, lines, session.userId);
  } finally {
    // ถ้าบันทึกไม่สำเร็จ ลบหัวเอกสารที่ยังไม่มีรายการ ให้ส่งซ้ำด้วย key เดิมได้ และคืนเลขเอกสารไม่ให้เลขกระโดด
    const removed = await db.prepare("DELETE FROM documents WHERE id=? AND status='DRAFT' AND NOT EXISTS (SELECT 1 FROM document_lines WHERE document_id=?)")
      .bind(doc_id, doc_id).run();
    if (removed.meta.changes > 0) await releaseDocNo(db, docType, yymm, seq);
  }
  if (!result.ok) return c.json(result.body, result.status);
  return c.json({ ok: true, doc_id, doc_no });
}

// ── POST /api/documents/receive ───────────────────────────────────────────────

docApp.post("/api/documents/receive", async (c) => {
  const session = c.get("session");
  if (!session) return c.json({ error: "unauthorized" }, 401);
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: "invalid_json" }, 400);
  const parsed = receiveSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  return createDocument(c, "RECEIVE", parsed.data);
});

// ── POST /api/documents/issue ─────────────────────────────────────────────────

docApp.post("/api/documents/issue", async (c) => {
  const session = c.get("session");
  if (!session) return c.json({ error: "unauthorized" }, 401);
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: "invalid_json" }, 400);
  const parsed = issueSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  return createDocument(c, "ISSUE", parsed.data);
});

// ── ดราฟ: แก้ไข / ลบ / บันทึกจริง ──────────────────────────────────────────────

type DocRow = { id: number; doc_type: string; doc_no: string; doc_date: string; warehouse_id: number; status: string; ref_text: string | null; note: string | null };

async function loadDoc(db: D1Database, id: number) {
  return await db.prepare("SELECT id, doc_type, doc_no, doc_date, warehouse_id, status, ref_text, note FROM documents WHERE id=?")
    .bind(id).first() as DocRow | null;
}

const NOT_DRAFT = { error: "not_draft", message: "แก้ไขได้เฉพาะเอกสารดราฟ" };

docApp.put("/api/documents/:id", async (c) => {
  const session = c.get("session");
  if (!session) return c.json({ error: "unauthorized" }, 401);
  const db = c.env.DB;
  const id = Number(c.req.param("id"));
  const doc = await loadDoc(db, id);
  if (!doc) return c.json({ error: "not_found" }, 404);
  if (doc.status !== "DRAFT" || (doc.doc_type !== "RECEIVE" && doc.doc_type !== "ISSUE")) return c.json(NOT_DRAFT, 409);

  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: "invalid_json" }, 400);
  const parsed = (doc.doc_type === "RECEIVE" ? receiveEditSchema : issueEditSchema).safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  const d = parsed.data;
  const lines = await resolveLines(db, doc.doc_type as DocType, d.lines);

  const res = await db.batch([
    db.prepare("UPDATE documents SET doc_date=?, warehouse_id=?, ref_text=?, note=? WHERE id=? AND status='DRAFT'")
      .bind(d.doc_date, d.warehouse_id, d.ref_text ?? null, d.note ?? null, id),
    db.prepare("DELETE FROM document_lines WHERE document_id=? AND EXISTS (SELECT 1 FROM documents WHERE id=? AND status='DRAFT')").bind(id, id),
    ...lines.map(l => insertLineStmt(db, { id }, l, true)),
    auditStmt(db, id, "UPDATE", doc, { ...doc, doc_date: d.doc_date, warehouse_id: d.warehouse_id, ref_text: d.ref_text, note: d.note, lines }, session.userId),
  ]);
  if (res[0].meta.changes === 0) return c.json(NOT_DRAFT, 409);
  return c.json({ ok: true, draft: true, id, doc_id: id, doc_no: doc.doc_no });
});

docApp.delete("/api/documents/:id", async (c) => {
  const session = c.get("session");
  if (!session) return c.json({ error: "unauthorized" }, 401);
  const db = c.env.DB;
  const id = Number(c.req.param("id"));
  const doc = await loadDoc(db, id);
  if (!doc) return c.json({ error: "not_found" }, 404);
  if (doc.status !== "DRAFT") return c.json({ error: "not_draft", message: "ลบได้เฉพาะเอกสารดราฟ" }, 409);

  const res = await db.batch([
    db.prepare("DELETE FROM document_lines WHERE document_id=? AND EXISTS (SELECT 1 FROM documents WHERE id=? AND status='DRAFT')").bind(id, id),
    db.prepare("DELETE FROM documents WHERE id=? AND status='DRAFT'").bind(id),
    auditStmt(db, id, "DELETE", doc, null, session.userId),
  ]);
  if (res[1].meta.changes === 0) return c.json({ error: "not_draft", message: "ลบได้เฉพาะเอกสารดราฟ" }, 409);
  return c.json({ ok: true, deleted: true, id });
});

docApp.post("/api/documents/:id/post", async (c) => {
  const session = c.get("session");
  if (!session) return c.json({ error: "unauthorized" }, 401);
  const db = c.env.DB;
  const id = Number(c.req.param("id"));
  const doc = await loadDoc(db, id);
  if (!doc) return c.json({ error: "not_found" }, 404);
  if (doc.status !== "DRAFT") return c.json(buildIdempotencyResponse(doc));
  if (doc.doc_type !== "RECEIVE" && doc.doc_type !== "ISSUE") return c.json(NOT_DRAFT, 409);
  if (isFutureDocDate(doc.doc_date)) {
    return c.json({ error: "invalid_date", message: "ยังไม่ถึงวันที่ในเอกสาร" }, 422);
  }

  const rows = await db.prepare("SELECT item_id, lot_id, qty_milli, unit_cost_x4 FROM document_lines WHERE document_id=? ORDER BY id")
    .bind(id).all();
  const lines = (rows.results as Array<StockLine & { lot_id: number | null }>).map(l => ({ ...l, lot_id: l.lot_id ?? 0 }));
  if (lines.length === 0) return c.json({ error: "invalid_input", message: "เอกสารดราฟไม่มีรายการ" }, 400);

  const result = await postDraftDocument(db, { id, doc_type: doc.doc_type as DocType, warehouse_id: doc.warehouse_id, doc_date: doc.doc_date }, lines, session.userId);
  if (!result.ok) return c.json(result.body, result.status);
  if (!result.posted) return c.json(buildIdempotencyResponse({ id, status: result.status }));
  await auditStmt(db, id, "UPDATE", { status: "DRAFT" }, { status: "POSTED" }, session.userId).run();
  return c.json({ ok: true, doc_id: id, doc_no: doc.doc_no });
});

// ── GET /api/documents ────────────────────────────────────────────────────────

docApp.get("/api/documents", async (c) => {
  const session = c.get("session");
  if (!session) return c.json({ error: "unauthorized" }, 401);

  const { doc_type, status, warehouse_id, date_from, date_to, limit = "50", offset = "0" } = c.req.query();

  let sql = `SELECT d.id, d.doc_type, d.doc_no, d.doc_date, d.status,
               d.ref_text, d.note, d.warehouse_id, w.name as warehouse_name,
               d.created_by, u.email as created_by_email, d.posted_at,
               (SELECT COUNT(*) FROM document_lines dl WHERE dl.document_id=d.id) AS line_count
             FROM documents d
             LEFT JOIN warehouses w ON w.id=d.warehouse_id
             LEFT JOIN users u ON u.id=d.created_by
             WHERE 1=1`;
  const params: (string | number)[] = [];

  if (doc_type) { sql += " AND d.doc_type=?"; params.push(doc_type); }
  if (status) { sql += " AND d.status=?"; params.push(status); }
  if (warehouse_id) { sql += " AND d.warehouse_id=?"; params.push(Number(warehouse_id)); }
  if (date_from) { sql += " AND d.doc_date>=?"; params.push(date_from); }
  if (date_to) { sql += " AND d.doc_date<=?"; params.push(date_to); }

  sql += " ORDER BY d.doc_date DESC, d.id DESC LIMIT ? OFFSET ?";
  params.push(Number(limit), Number(offset));

  const rows = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ ok: true, documents: rows.results });
});

// ── GET /api/documents/:id ────────────────────────────────────────────────────

docApp.get("/api/documents/:id", async (c) => {
  const session = c.get("session");
  if (!session) return c.json({ error: "unauthorized" }, 401);

  const id = Number(c.req.param("id"));
  const doc = await c.env.DB.prepare(
    `SELECT d.*, w.name as warehouse_name FROM documents d
     LEFT JOIN warehouses w ON w.id=d.warehouse_id WHERE d.id=?`,
  ).bind(id).first();
  if (!doc) return c.json({ error: "not_found" }, 404);

  const linesRows = await c.env.DB.prepare(
    `SELECT dl.*, i.sku, i.name_th, l.lot_no, l.expiry_date
     FROM document_lines dl
     LEFT JOIN items i ON i.id=dl.item_id
     LEFT JOIN lots l ON l.id=dl.lot_id
     WHERE dl.document_id=?`,
  ).bind(id).all();

  const isOwner = session.role === "OWNER";
  const lines = linesRows.results.map((row: any) => ({
    ...row,
    unit_cost_x4: isOwner ? row.unit_cost_x4 : undefined,
  }));

  return c.json({ ok: true, document: doc, lines });
});

// ── POST /api/documents/:id/cancel ───────────────────────────────────────────

docApp.post("/api/documents/:id/cancel", async (c) => {
  const session = c.get("session");
  if (!session) return c.json({ error: "unauthorized" }, 401);
  if (session.role !== "OWNER") return c.json({ error: "forbidden" }, 403);

  const id = Number(c.req.param("id"));
  const doc = await c.env.DB.prepare(
    "SELECT * FROM documents WHERE id=?",
  ).bind(id).first() as { id: number; status: string; doc_type: string; warehouse_id: number; doc_date: string } | null;

  if (!doc) return c.json({ error: "not_found" }, 404);
  if (doc.status !== "POSTED") return c.json({ error: "cannot_cancel", status: doc.status }, 400);
  if (doc.doc_type === "CANCEL") return c.json({ error: "cannot_cancel_cancel" }, 400);

  const nowIso = new Date().toISOString();
  const yymm = doc.doc_date.slice(2, 4) + doc.doc_date.slice(5, 7);

  // สร้าง CANCEL document
  const cancel_no = await nextDocNo(c.env.DB, "CANCEL", yymm);

  const cancelResult = await c.env.DB.prepare(
    `INSERT INTO documents (doc_type, doc_no, doc_date, warehouse_id, status, ref_text, idempotency_key, created_by)
     VALUES ('CANCEL',?,?,?,'DRAFT',?,?,?)`,
  ).bind(cancel_no, doc.doc_date, doc.warehouse_id, `ยกเลิก ${doc.doc_type}`, `cancel-${id}`, session.userId).run();

  const cancel_id = cancelResult.meta.last_row_id;

  // โหลด lines เดิม
  const origLines = await c.env.DB.prepare(
    "SELECT item_id, lot_id, qty_milli, unit_cost_x4 FROM document_lines WHERE document_id=?",
  ).bind(id).all();

  const linesRaw = origLines.results as Array<{ item_id: number; lot_id: number | null; qty_milli: number; unit_cost_x4: number }>;
  const lines = linesRaw.map(l => ({ ...l, lot_id: l.lot_id ?? 0 }));

  // direction กลับรายการ
  const reverseDir = (doc.doc_type === "RECEIVE" ? -1 : 1) as 1 | -1;
  const snap = await loadBalanceSnapshot(c.env.DB, doc.warehouse_id, lines);

  const { lineUpdates } = computePostDocumentUpdates(
    { doc_id: cancel_id, warehouse_id: doc.warehouse_id, movement_date: doc.doc_date, direction: reverseDir, lines, user_id: session.userId },
    snap,
  );

  const stmts = lineUpdates.flatMap((lu) => [
    c.env.DB.prepare(
      `INSERT INTO document_lines (document_id, item_id, lot_id, qty_milli, unit_cost_x4) VALUES (?,?,?,?,?)`,
    ).bind(cancel_id, lu.item_id, lu.lot_id || null, lu.qty_milli, lu.unit_cost_x4),

    c.env.DB.prepare(
      `INSERT INTO stock_movements (document_id, item_id, lot_id, warehouse_id, movement_date, direction, qty_milli, unit_cost_x4, balance_qty_after_milli, avg_cost_after_x4)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).bind(cancel_id, lu.item_id, lu.lot_id, doc.warehouse_id, doc.doc_date, reverseDir, lu.qty_milli, lu.unit_cost_x4, lu.new_qty, lu.new_avg_cost),

    c.env.DB.prepare(
      `INSERT INTO stock_balances (item_id, lot_id, warehouse_id, qty_on_hand_milli, avg_cost_x4, updated_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(item_id, lot_id, warehouse_id) DO UPDATE SET
         qty_on_hand_milli=excluded.qty_on_hand_milli, avg_cost_x4=excluded.avg_cost_x4, updated_at=excluded.updated_at`,
    ).bind(lu.item_id, lu.lot_id, doc.warehouse_id, lu.new_qty, lu.new_avg_cost, nowIso),
  ]);

  stmts.push(
    c.env.DB.prepare(`UPDATE documents SET status='CANCELLED' WHERE id=?`).bind(id),
    c.env.DB.prepare(`UPDATE documents SET status='POSTED', posted_by=?, posted_at=? WHERE id=?`)
      .bind(session.userId, nowIso, cancel_id),
  );

  try {
    await c.env.DB.batch(stmts);
  } catch (err) {
    await c.env.DB.prepare("DELETE FROM documents WHERE id=? AND status='DRAFT' AND NOT EXISTS (SELECT 1 FROM document_lines WHERE document_id=?)").bind(cancel_id, cancel_id).run();
    if (extractDbErrorCode(err) === "insufficient_stock") {
      return c.json({ error: "insufficient_stock", message: "ยกเลิกไม่ได้ เพราะสินค้าถูกตัดออกไปแล้ว ยอดคงเหลือไม่พอให้กลับรายการ" }, 422);
    }
    throw err;
  }

  return c.json({ ok: true, cancel_id, cancel_no });
});

// ── GET /api/lots/suggest ─────────────────────────────────────────────────────

docApp.get("/api/lots/suggest", async (c) => {
  const session = c.get("session");
  if (!session) return c.json({ error: "unauthorized" }, 401);

  const { item_id, warehouse_id } = c.req.query();
  if (!item_id || !warehouse_id) return c.json({ error: "missing_params" }, 400);

  const today = bangkokToday();

  const rows = await c.env.DB.prepare(
    `SELECT l.id, l.lot_no, l.expiry_date, l.mfg_date, l.po_no, l.manufacturer_name,
            sb.qty_on_hand_milli, sb.avg_cost_x4,
            CASE WHEN l.expiry_date < ? THEN 1 ELSE 0 END AS is_expired
     FROM lots l
     INNER JOIN stock_balances sb ON sb.lot_id=l.id AND sb.item_id=? AND sb.warehouse_id=?
     WHERE l.item_id=? AND sb.qty_on_hand_milli > 0
     ORDER BY l.expiry_date ASC`,
  ).bind(today, Number(item_id), Number(warehouse_id), Number(item_id)).all();

  const noLot = await c.env.DB.prepare(
    "SELECT qty_on_hand_milli FROM stock_balances WHERE item_id=? AND warehouse_id=? AND lot_id=0",
  ).bind(Number(item_id), Number(warehouse_id)).first() as { qty_on_hand_milli: number } | null;

  const lots = session.role === "OWNER"
    ? rows.results
    : (rows.results as Record<string, unknown>[]).map(({ avg_cost_x4: _hidden, ...rest }) => rest);

  return c.json({ ok: true, lots, no_lot_qty_milli: noLot?.qty_on_hand_milli ?? 0 });
});

export default docApp;
