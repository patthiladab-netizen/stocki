import { computePostDocumentUpdates, type BalanceSnapshot } from "../domain/postDocument";
import { validateIssueLines, extractDbErrorCode, type LotInfo, type ItemInfo } from "../domain/documentEngine";

export type StockLine = { item_id: number; lot_id: number; qty_milli: number; unit_cost_x4: number };
export type DraftDoc = { id: number; doc_type: "RECEIVE" | "ISSUE"; warehouse_id: number; doc_date: string };

export type PostResult =
  | { ok: true; posted: true; doc_id: number }
  | { ok: true; posted: false; doc_id: number; status: string }
  | { ok: false; status: 422; body: { error: string; message: string; errors?: string[] } };

export async function loadBalanceSnapshot(
  db: D1Database,
  warehouse_id: number,
  lines: Array<{ item_id: number; lot_id: number }>,
): Promise<BalanceSnapshot> {
  const snap: BalanceSnapshot = new Map();
  for (const line of lines) {
    const row = await db.prepare(
      `SELECT qty_on_hand_milli, avg_cost_x4 FROM stock_balances
       WHERE item_id=? AND lot_id=? AND warehouse_id=?`,
    ).bind(line.item_id, line.lot_id, warehouse_id).first() as { qty_on_hand_milli: number; avg_cost_x4: number } | null;
    snap.set(`${line.item_id}:${line.lot_id}:${warehouse_id}`, { qty: row?.qty_on_hand_milli ?? 0, avg_cost: row?.avg_cost_x4 ?? 0 });
  }
  return snap;
}

// posted_at ที่ไม่ซ้ำกัน ใช้เป็น token ยืนยันว่า batch นี้เป็นคนเปลี่ยนเอกสารเป็น POSTED
function uniquePostedAt(): string {
  const iso = new Date().toISOString();
  return iso.replace("Z", String(Math.floor(Math.random() * 1000)).padStart(3, "0") + "Z");
}

/**
 * บันทึกเอกสาร DRAFT ให้เป็น POSTED — ทางเดียวที่เปลี่ยนยอดสต็อกของรับเข้า/ตัดออก
 * - movements + balances + สถานะเอกสาร อยู่ใน db.batch() ครั้งเดียว
 * - ทุก statement มีเงื่อนไขว่าเอกสารถูกเปลี่ยนเป็น POSTED โดย batch นี้ (กันบันทึกซ้ำ)
 * - ยอดติดลบถูกกันที่ฐานข้อมูลด้วย trigger (migration 0006) ซึ่งยกเลิกทั้ง batch
 */
export async function postDraftDocument(
  db: D1Database,
  doc: DraftDoc,
  linesIn: StockLine[],
  userId: number,
): Promise<PostResult> {
  const direction = doc.doc_type === "RECEIVE" ? 1 : -1;
  const snap = await loadBalanceSnapshot(db, doc.warehouse_id, linesIn);
  let lines = linesIn;

  if (direction === -1) {
    const lotIds = lines.map(l => l.lot_id).filter(id => id > 0);
    let lotInfos: LotInfo[] = [];
    if (lotIds.length > 0) {
      const rows = await db.prepare(
        `SELECT id, expiry_date, lot_no FROM lots WHERE id IN (${lotIds.map(() => "?").join(",")})`,
      ).bind(...lotIds).all();
      lotInfos = rows.results as LotInfo[];
    }
    const itemIds = [...new Set(lines.map(l => l.item_id))];
    const itemRows = await db.prepare(
      `SELECT id, sku, name_th FROM items WHERE id IN (${itemIds.map(() => "?").join(",")})`,
    ).bind(...itemIds).all();
    const validation = validateIssueLines(
      lines, snap, doc.warehouse_id, new Date(doc.doc_date), lotInfos, itemRows.results as ItemInfo[],
    );
    if (!validation.ok) {
      const expired = validation.errors.some(e => e.includes("หมดอายุ"));
      const code = expired ? "lot_expired" : "insufficient_stock";
      return {
        ok: false, status: 422,
        body: { error: code, message: validation.errors.join("; "), errors: validation.errors },
      };
    }
    lines = lines.map(l => ({ ...l, unit_cost_x4: snap.get(`${l.item_id}:${l.lot_id}:${doc.warehouse_id}`)?.avg_cost ?? 0 }));
  }

  const { lineUpdates } = computePostDocumentUpdates(
    { doc_id: doc.id, warehouse_id: doc.warehouse_id, movement_date: doc.doc_date, direction, lines, user_id: userId },
    snap,
  );

  const postedAt = uniquePostedAt();
  const guard = "EXISTS (SELECT 1 FROM documents WHERE id=? AND status='POSTED' AND posted_at=?)";
  const g = [doc.id, postedAt];
  const wh = doc.warehouse_id;

  const stmts: D1PreparedStatement[] = [
    db.prepare(`UPDATE documents SET status='POSTED', posted_by=?, posted_at=? WHERE id=? AND status='DRAFT'`)
      .bind(userId, postedAt, doc.id),
    db.prepare(`DELETE FROM document_lines WHERE document_id=? AND ${guard}`).bind(doc.id, ...g),
  ];

  for (const lu of lineUpdates) {
    stmts.push(
      db.prepare(
        `INSERT INTO document_lines (document_id, item_id, lot_id, qty_milli, unit_cost_x4)
         SELECT ?,?,?,?,? WHERE ${guard}`,
      ).bind(doc.id, lu.item_id, lu.lot_id || null, lu.qty_milli, lu.unit_cost_x4, ...g),
      db.prepare(
        `INSERT INTO stock_movements (document_id, item_id, lot_id, warehouse_id, movement_date, direction, qty_milli, unit_cost_x4, balance_qty_after_milli, avg_cost_after_x4)
         SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${guard}`,
      ).bind(doc.id, lu.item_id, lu.lot_id, wh, doc.doc_date, direction, lu.qty_milli, lu.unit_cost_x4, lu.new_qty, lu.new_avg_cost, ...g),
    );

    if (direction === 1) {
      // อัปเดตแบบสัมพัทธ์ในฐานข้อมูล: ต้นทุนถัวเฉลี่ยคำนวณจากยอดจริง ณ ตอนเขียน (ปัดเศษแบบ integer)
      stmts.push(
        db.prepare(
          `INSERT INTO stock_balances (item_id, lot_id, warehouse_id, qty_on_hand_milli, avg_cost_x4, updated_at)
           SELECT ?,?,?,?,?,? WHERE ${guard}
           ON CONFLICT(item_id, lot_id, warehouse_id) DO UPDATE SET
             avg_cost_x4 = (qty_on_hand_milli * avg_cost_x4 + excluded.qty_on_hand_milli * excluded.avg_cost_x4
                            + (qty_on_hand_milli + excluded.qty_on_hand_milli) / 2)
                           / (qty_on_hand_milli + excluded.qty_on_hand_milli),
             qty_on_hand_milli = qty_on_hand_milli + excluded.qty_on_hand_milli,
             updated_at = excluded.updated_at`,
        ).bind(lu.item_id, lu.lot_id, wh, lu.qty_milli, lu.unit_cost_x4, postedAt, ...g),
      );
    } else {
      stmts.push(
        db.prepare(
          `INSERT INTO stock_balances (item_id, lot_id, warehouse_id, qty_on_hand_milli, avg_cost_x4, updated_at)
           SELECT ?,?,?,0,0,? WHERE ${guard}
           ON CONFLICT(item_id, lot_id, warehouse_id) DO NOTHING`,
        ).bind(lu.item_id, lu.lot_id, wh, postedAt, ...g),
        // ไม่ใส่ WHERE qty >= ? เพราะแถวที่ไม่ถูกแก้ใน batch ตรวจไม่ได้ — ให้ trigger ยกเลิกทั้ง batch แทน
        db.prepare(
          `UPDATE stock_balances SET qty_on_hand_milli = qty_on_hand_milli - ?, updated_at=?
           WHERE item_id=? AND lot_id=? AND warehouse_id=? AND ${guard}`,
        ).bind(lu.qty_milli, postedAt, lu.item_id, lu.lot_id, wh, ...g),
      );
    }
  }

  try {
    await db.batch(stmts);
  } catch (err) {
    if (extractDbErrorCode(err) === "insufficient_stock") {
      return { ok: false, status: 422, body: { error: "insufficient_stock", message: "ยอดคงเหลือไม่พอจ่าย (มีรายการอื่นตัดไปก่อน)" } };
    }
    throw err;
  }

  const after = await db.prepare("SELECT status, posted_at FROM documents WHERE id=?").bind(doc.id).first() as { status: string; posted_at: string } | null;
  if (after?.status === "POSTED" && after.posted_at === postedAt) return { ok: true, posted: true, doc_id: doc.id };
  return { ok: true, posted: false, doc_id: doc.id, status: after?.status ?? "UNKNOWN" };
}
