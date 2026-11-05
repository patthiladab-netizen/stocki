/**
 * documentEngine.ts — pure functions สำหรับ D4: receive/issue
 * ไม่ depend HTTP หรือ D1 โดยตรง
 */

export type IssueLine = {
  item_id: number;
  lot_id: number;  // 0 = ไม่มีล็อต (sentinel)
  qty_milli: number;
};

export type LotInfo = {
  id: number;
  expiry_date: string; // YYYY-MM-DD
  lot_no?: string;
};

export type ItemInfo = { id: number; sku: string; name_th: string };

/** จำนวน (×1000) → ข้อความแสดงผล เช่น 75000 → "75", 1500 → "1.5" */
export function formatQtyMilli(qty_milli: number): string {
  return (qty_milli / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 });
}

function thaiDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

import type { BalanceSnapshot } from "./postDocument";
export type BalanceMap = BalanceSnapshot;

/** ตรวจว่าล็อตหมดอายุแล้วหรือยัง (expiry_date < today) */
export function isExpired(expiry_date: string, today: Date): boolean {
  const exp = new Date(expiry_date + "T00:00:00Z");
  const tod = new Date(today.toISOString().slice(0, 10) + "T00:00:00Z");
  return exp < tod;
}

/** เรียงล็อตตาม FEFO (หมดก่อน = อยู่หน้า) */
export function computeFEFOOrder<T extends { id: number; expiry_date: string }>(lots: T[]): T[] {
  return [...lots].sort((a, b) => a.expiry_date.localeCompare(b.expiry_date));
}

/** ตรวจ lines ก่อน issue:
 *  - ยอดเพียงพอ
 *  - ล็อตไม่หมดอายุ
 *  คืน { ok, errors }
 */
export function validateIssueLines(
  lines: IssueLine[],
  snapshot: BalanceMap,
  warehouse_id: number,
  today: Date,
  lotInfos: LotInfo[] = [],
  itemInfos: ItemInfo[] = [],
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const lotMap = new Map(lotInfos.map(l => [l.id, l]));
  const itemMap = new Map(itemInfos.map(i => [i.id, i]));

  for (const line of lines) {
    const key = `${line.item_id}:${line.lot_id}:${warehouse_id}`;
    const bal = snapshot.get(key) ?? { qty: 0, avg_cost: 0 };
    const item = itemMap.get(line.item_id);
    const lot = line.lot_id > 0 ? lotMap.get(line.lot_id) : undefined;
    let label = item ? `${item.sku} ${item.name_th}` : `สินค้า #${line.item_id}`;
    if (line.lot_id > 0) label += ` ล็อต ${lot?.lot_no ?? `#${line.lot_id}`}`;

    if (bal.qty < line.qty_milli) {
      errors.push(`${label}: ยอดไม่เพียงพอ คงเหลือ ${formatQtyMilli(bal.qty)} แต่ต้องการตัด ${formatQtyMilli(line.qty_milli)}`);
    }

    if (lot && isExpired(lot.expiry_date, today)) {
      errors.push(`${label}: ล็อตหมดอายุแล้ว (${thaiDate(lot.expiry_date)})`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * สถานะเอกสารที่มี idempotency key เดียวกันอยู่แล้ว
 * - DRAFT ที่มีรายการ = ดราฟที่ผู้ใช้ตั้งใจสร้าง (ห้ามลบ)
 * - DRAFT ไม่มีรายการ = ค้างจากการบันทึกที่ล้มกลางทาง (ลบแล้วทำใหม่ได้)
 */
export function classifyExistingDoc(
  doc: { status: string; line_count: number } | null,
): "new" | "posted" | "draft" | "stale" {
  if (!doc) return "new";
  if (doc.status !== "DRAFT") return "posted";
  return doc.line_count > 0 ? "draft" : "stale";
}

/** แปลง error จาก D1 เป็นรหัส error ของแอป */
export function extractDbErrorCode(err: unknown): "insufficient_stock" | "barcode_duplicate" | null {
  const msg = String((err as Error)?.message ?? err);
  if (msg.includes("insufficient_stock")) return "insufficient_stock";
  if (msg.includes("UNIQUE") && msg.includes("barcode")) return "barcode_duplicate";
  return null;
}

/** สร้าง response สำหรับ idempotency hit */
export function buildIdempotencyResponse(existing: { id: number; status: string }) {
  return { ok: true, idempotent: true, doc_id: existing.id, status: existing.status };
}

/** สร้างเลขเอกสาร เช่น RCV-2610-0001 */
export function buildDocNo(docType: "RECEIVE" | "ISSUE" | "OPENING" | "CANCEL", yymm: string, seq: number): string {
  const prefix = { RECEIVE: "RCV", ISSUE: "ISS", OPENING: "OPN", CANCEL: "CAN" }[docType];
  return `${prefix}-${yymm}-${String(seq).padStart(4, "0")}`;
}
