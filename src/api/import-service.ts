import { Hono } from "hono";
import { z } from "zod";
import { validateImportRows } from "../domain/importValidator";
import { computePostDocumentUpdates } from "../domain/postDocument";
import { bangkokToday } from "../domain/docDate";

type Bindings = { DB: D1Database; ADMIN_EMAIL: string; APP_SECRET: string };
type Variables = { session: { userId: number; email: string; role: string } | null };

const importApp = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// schema สำหรับแต่ละแถวที่ส่งมาจาก frontend (หลัง SheetJS parse แล้ว)
const rowSchema = z.object({
  รหัส: z.string(),
  ชื่อ: z.string(),
  บาร์โค้ด: z.string().optional(),
  หน่วย: z.string(),
  หมวด: z.string().optional(),
  คลัง: z.string(),
  จำนวนยกมา: z.number(),
  ต้นทุนต่อหน่วย: z.number().default(0),
  จุดสั่งซื้อ: z.number().optional(),
  "ใช้ล็อต": z.string().default("N"),
  "Lot No.": z.string().optional(),
  วันผลิต: z.union([z.string(), z.number()]).optional(),
  วันหมดอายุ: z.union([z.string(), z.number()]).optional(),
  "เลขที่ PO": z.string().optional(),
  โรงงานผู้ผลิต: z.string().optional(),
});

const batchSchema = z.object({
  idempotency_key: z.string().min(1).max(128),
  rows: z.array(z.record(z.unknown())).min(1).max(5000),
});

/**
 * POST /api/import/opening
 * รับ batch ของแถวจาก Excel (≤500 แถวต่อ request)
 * ถ้า idempotency_key ซ้ำ → return ผลเดิมทันที (idempotent)
 */
importApp.post("/api/import/opening", async (c) => {
  const session = c.get("session");
  if (!session) return c.json({ error: "unauthorized" }, 401);
  if (session.role !== "OWNER") return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: "invalid_json" }, 400);

  const parsed = batchSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_input", issues: parsed.error.issues }, 400);

  const { idempotency_key, rows } = parsed.data;

  // ตรวจ idempotency — เฉพาะ POSTED เท่านั้น
  // documents เก็บ key แบบ "${idempotency_key}:${warehouseCode}" จึงใช้ LIKE
  const existing = await c.env.DB.prepare(
    "SELECT id FROM documents WHERE idempotency_key LIKE ? AND doc_type='OPENING' AND status='POSTED' LIMIT 1",
  ).bind(idempotency_key + "%").first() as { id: number } | null;
  if (existing) {
    return c.json({ ok: true, already_imported: true });
  }
  // ล้าง DRAFT ที่ค้างจากการ fail ครั้งก่อน
  await c.env.DB.prepare(
    "DELETE FROM documents WHERE idempotency_key LIKE ? AND doc_type='OPENING' AND status='DRAFT'",
  ).bind(idempotency_key + "%").run();

  // โหลด units และ warehouses สำหรับ validation (รองรับทั้ง code และ name_th)
  const unitRows = await c.env.DB.prepare("SELECT code, name_th FROM units").all();
  const warehouseRows = await c.env.DB.prepare("SELECT code, name, id FROM warehouses WHERE is_active=1").all();
  const unitNameToCode = new Map(unitRows.results.map((r: any) => [r.name_th as string, r.code as string]));
  const warehouseNameToCode = new Map(warehouseRows.results.map((r: any) => [r.name as string, r.code as string]));
  const knownUnitCodes = new Set([
    ...unitRows.results.map((r: any) => r.code as string),
    ...unitRows.results.map((r: any) => r.name_th as string),
  ]);
  const knownWarehouseCodes = new Set([
    ...warehouseRows.results.map((r: any) => r.code as string),
    ...warehouseRows.results.map((r: any) => r.name as string),
  ]);
  const warehouseIdByCode = new Map([
    ...warehouseRows.results.map((r: any) => [r.code as string, r.id as number] as [string, number]),
    ...warehouseRows.results.map((r: any) => [r.name as string, r.id as number] as [string, number]),
  ]);

  // auto-create หน่วยและคลังที่ยังไม่มีในระบบ
  // rows ใช้ชื่อคอลัมน์ภาษาไทยจาก Excel ("หน่วย", "คลัง")
  const allUnitKeys = new Set([...rows.map((r: any) => String(r["หน่วย"] ?? "").trim()).filter(Boolean)]);
  for (const key of allUnitKeys) {
    if (!knownUnitCodes.has(key)) {
      const code = key.toUpperCase().slice(0, 10);
      await c.env.DB.prepare(
        `INSERT OR IGNORE INTO units (code, name_th, decimal_places) VALUES (?,?,0)`,
      ).bind(code, key).run();
      unitNameToCode.set(key, code);
      knownUnitCodes.add(key);
      knownUnitCodes.add(code);
    }
  }
  const allWhKeys = new Set([...rows.map((r: any) => String(r["คลัง"] ?? "").trim()).filter(Boolean)]);
  for (const key of allWhKeys) {
    if (!knownWarehouseCodes.has(key)) {
      const code = key.toUpperCase().replace(/\s+/g, "").slice(0, 10);
      const res = await c.env.DB.prepare(
        `INSERT OR IGNORE INTO warehouses (code, name, is_active) VALUES (?,?,1)`,
      ).bind(code, key).run();
      const wid = res.meta.last_row_id as number;
      warehouseNameToCode.set(key, code);
      warehouseIdByCode.set(key, wid);
      warehouseIdByCode.set(code, wid);
      knownWarehouseCodes.add(key);
      knownWarehouseCodes.add(code);
    }
  }

  // โหลดบาร์โค้ดที่มีอยู่แล้วในระบบ (เฉพาะที่อยู่ในไฟล์) เพื่อตรวจซ้ำกับสินค้าอื่น
  const fileBarcodes = [...new Set(rows.map((r: any) => String(r["บาร์โค้ด"] ?? "").trim()).filter(Boolean))];
  const existingBarcodes = new Map<string, string>();
  for (let i = 0; i < fileBarcodes.length; i += 90) {
    const chunk = fileBarcodes.slice(i, i + 90);
    const res = await c.env.DB.prepare(
      `SELECT barcode, sku FROM items WHERE barcode IN (${chunk.map(() => "?").join(",")})`,
    ).bind(...chunk).all();
    for (const r of res.results as Array<{ barcode: string; sku: string }>) existingBarcodes.set(r.barcode, r.sku);
  }

  // validate
  const { valid, errors } = validateImportRows(rows, knownUnitCodes, knownWarehouseCodes, existingBarcodes);
  if (errors.length > 0) {
    return c.json({ ok: false, error: "validation_failed", message: `พบ ${errors.length} แถวผิดพลาด ยังไม่บันทึกข้อมูล`, errors }, 422);
  }
  if (valid.length === 0) {
    return c.json({ ok: false, error: "validation_failed", message: "ไม่มีแถวที่ถูกต้อง", errors: [{ rowNum: 0, errors: ["ไม่มีแถวที่ถูกต้อง"] }] }, 422);
  }

  // แปลง name → code สำหรับ unit และ warehouse
  for (const row of valid) {
    row.unit_code = unitNameToCode.get(row.unit_code) ?? row.unit_code;
    row.warehouse_code = warehouseNameToCode.get(row.warehouse_code) ?? row.warehouse_code;
  }

  const nowIso = new Date().toISOString();
  const docDate = bangkokToday();
  const yymm = docDate.slice(2, 4) + docDate.slice(5, 7);

  // doc_no สร้างต่อ warehouse ในลูปด้านล่าง (1 คลัง = 1 เอกสาร = 1 เลข)

  // จัดกลุ่มตามคลัง
  const byWarehouse = new Map<string, typeof valid>();
  for (const row of valid) {
    const arr = byWarehouse.get(row.warehouse_code) ?? [];
    arr.push(row);
    byWarehouse.set(row.warehouse_code, arr);
  }

  const docIds: number[] = [];
  const skippedRows: Array<{ rowNum: number; sku: string; reason: string }> = [];

  for (const [wCode, wRows] of byWarehouse) {
    const warehouse_id = warehouseIdByCode.get(wCode)!;
    const wKey = `${idempotency_key}:${wCode}`;

    // upsert items และ lots ก่อน แล้วค่อย postDocument
    const lineInputs: Array<{ item_id: number; lot_id: number; qty_milli: number; unit_cost_x4: number }> = [];

    for (const row of wRows) {
      // upsert unit
      await c.env.DB.prepare(
        `INSERT INTO units (code, name_th) VALUES (?,?) ON CONFLICT(code) DO NOTHING`,
      ).bind(row.unit_code, row.unit_code).run();
      const unitRow = await c.env.DB.prepare("SELECT id FROM units WHERE code=?").bind(row.unit_code).first() as { id: number };

      // upsert category
      let category_id: number | null = null;
      if (row.category_code) {
        await c.env.DB.prepare(
          `INSERT INTO categories (code, name) VALUES (?,?) ON CONFLICT(code) DO NOTHING`,
        ).bind(row.category_code, row.category_code).run();
        const catRow = await c.env.DB.prepare("SELECT id FROM categories WHERE code=?").bind(row.category_code).first() as { id: number };
        category_id = catRow.id;
      }

      // upsert item
      await c.env.DB.prepare(
        `INSERT INTO items (sku, name_th, barcode, category_id, unit_id, track_lot, reorder_point_milli, standard_cost_x4)
         VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(sku) DO UPDATE SET
           name_th=excluded.name_th,
           barcode=excluded.barcode,
           category_id=excluded.category_id,
           unit_id=excluded.unit_id,
           track_lot=excluded.track_lot,
           reorder_point_milli=excluded.reorder_point_milli`,
      ).bind(
        row.sku, row.name_th, row.barcode ?? null, category_id, unitRow.id,
        row.track_lot ? 1 : 0,
        Math.round((row.reorder_point ?? 0) * 1000),
        Math.round(row.unit_cost * 10000),
      ).run();

      const itemRow = await c.env.DB.prepare("SELECT id FROM items WHERE sku=?").bind(row.sku).first() as { id: number };
      const item_id = itemRow.id;

      // upsert lot (ถ้ามี)
      let lot_id: number | null = null;
      if (row.track_lot && row.lot_no) {
        await c.env.DB.prepare(
          `INSERT INTO lots (item_id, lot_no, mfg_date, expiry_date, po_no, manufacturer_name, created_at)
           VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(item_id, lot_no) DO NOTHING`,
        ).bind(item_id, row.lot_no, row.mfg_date!, row.expiry_date!, row.po_no!, row.manufacturer_name!, nowIso).run();
        const lotRow = await c.env.DB.prepare(
          "SELECT id FROM lots WHERE item_id=? AND lot_no=?",
        ).bind(item_id, row.lot_no).first() as { id: number };
        lot_id = lotRow.id;
      }

      const lotIdSentinel = lot_id ?? 0;

      // ตรวจว่ามียอดสต็อกอยู่แล้ว (ทุก doc_type) — ถ้ามีแล้วข้ามแถวนี้ ไม่เขียนทับ
      const existingBalance = await c.env.DB.prepare(
        `SELECT 1 FROM stock_movements sm
         WHERE sm.item_id=? AND sm.lot_id=? AND sm.warehouse_id=?
         LIMIT 1`,
      ).bind(item_id, lotIdSentinel, warehouse_id).first();

      if (existingBalance) {
        skippedRows.push({ rowNum: row.rowNum, sku: row.sku, reason: "มียอดสต็อกอยู่แล้ว ข้ามการนำเข้ายอดยกมา" });
        continue;
      }

      lineInputs.push({
        item_id,
        lot_id: lot_id ?? 0,
        qty_milli: Math.round(row.qty * 1000),
        unit_cost_x4: Math.round(row.unit_cost * 10000),
      });
    }

    if (lineInputs.length === 0) continue;

    // สร้างเลขเอกสาร OPN-YYMM-XXXX ต่อ warehouse (RETURNING ทำให้ atomic)
    const seqRow = await c.env.DB.prepare(
      `INSERT INTO doc_sequences (doc_type, yymm, last_no) VALUES ('OPENING',?,1)
       ON CONFLICT(doc_type, yymm) DO UPDATE SET last_no = last_no + 1
       RETURNING last_no`,
    ).bind(yymm).first() as { last_no: number };
    const doc_no = `OPN-${yymm}-${String(seqRow.last_no).padStart(4, "0")}`;

    // สร้าง document
    const docResult = await c.env.DB.prepare(
      `INSERT INTO documents (doc_type, doc_no, doc_date, warehouse_id, status, idempotency_key, created_by)
       VALUES ('OPENING',?,?,?,'DRAFT',?,?)`,
    ).bind(doc_no, docDate, warehouse_id, wKey, session.userId).run();

    const doc_id = docResult.meta.last_row_id;
    docIds.push(doc_id);

    // สร้าง snapshot ยอดปัจจุบัน (เปล่าทั้งหมดเพราะเพิ่งตรวจแล้วว่าไม่มี)
    const balancesSnapshot = new Map<string, { qty: number; avg_cost: number }>();

    const { lineUpdates } = computePostDocumentUpdates(
      {
        doc_id,
        warehouse_id,
        movement_date: docDate,
        direction: 1,
        lines: lineInputs,
        user_id: session.userId,
      },
      balancesSnapshot,
    );

    const stmts = lineUpdates.flatMap((lu) => {
      const lineStmt = c.env.DB.prepare(
        `INSERT INTO document_lines (document_id, item_id, lot_id, qty_milli, unit_cost_x4)
         VALUES (?,?,?,?,?)`,
      ).bind(doc_id, lu.item_id, lu.lot_id || null, lu.qty_milli, lu.unit_cost_x4);

      const movStmt = c.env.DB.prepare(
        `INSERT INTO stock_movements (document_id, item_id, lot_id, warehouse_id, movement_date, direction, qty_milli, unit_cost_x4, balance_qty_after_milli, avg_cost_after_x4)
         VALUES (?,?,?,?,?,1,?,?,?,?)`,
      ).bind(doc_id, lu.item_id, lu.lot_id, lu.warehouse_id, docDate, lu.qty_milli, lu.unit_cost_x4, lu.new_qty, lu.new_avg_cost);

      const balStmt = c.env.DB.prepare(
        `INSERT INTO stock_balances (item_id, lot_id, warehouse_id, qty_on_hand_milli, avg_cost_x4, updated_at)
         VALUES (?,?,?,?,?,?)
         ON CONFLICT(item_id, lot_id, warehouse_id) DO UPDATE SET
           qty_on_hand_milli=excluded.qty_on_hand_milli,
           avg_cost_x4=excluded.avg_cost_x4,
           updated_at=excluded.updated_at`,
      ).bind(lu.item_id, lu.lot_id, lu.warehouse_id, lu.new_qty, lu.new_avg_cost, nowIso);

      return [lineStmt, movStmt, balStmt];
    });

    const docPostStmt = c.env.DB.prepare(
      `UPDATE documents SET status='POSTED' WHERE id=?`,
    ).bind(doc_id);

    await c.env.DB.batch([...stmts, docPostStmt]);
  }

  const actualImported = Math.max(0, valid.length - skippedRows.length);
  return c.json({ ok: true, doc_ids: docIds, skipped: skippedRows, imported: actualImported });
});

export default importApp;
