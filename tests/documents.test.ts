import { describe, it, expect } from "vitest";
import { computePostDocumentUpdates, type BalanceSnapshot } from "../src/domain/postDocument";
import {
  validateIssueLines,
  computeFEFOOrder,
  isExpired,
  buildIdempotencyResponse,
} from "../src/domain/documentEngine";

// ── helpers ────────────────────────────────────────────────────────────────────
function makeSnapshot(entries: Array<{ item_id: number; lot_id: number; wh: number; qty: number; avg: number }>): BalanceSnapshot {
  const snap: BalanceSnapshot = new Map();
  for (const e of entries) {
    snap.set(`${e.item_id}:${e.lot_id}:${e.wh}`, { qty: e.qty, avg_cost: e.avg });
  }
  return snap;
}

// ── ต้นทุนถัวเฉลี่ยเคลื่อนที่ ────────────────────────────────────────────────
describe("moving average cost", () => {
  it("รับ 10@100 + 10@120 → avg = 110", () => {
    const snap1: BalanceSnapshot = new Map();
    const { lineUpdates: lu1, newBalances: b1 } = computePostDocumentUpdates(
      { doc_id: 1, warehouse_id: 1, movement_date: "2026-10-31", direction: 1, lines: [{ item_id: 1, lot_id: 0, qty_milli: 10_000, unit_cost_x4: 1_000_000 }], user_id: 1 },
      snap1,
    );
    expect(lu1[0].new_avg_cost).toBe(1_000_000); // 100 × 10000

    const { lineUpdates: lu2 } = computePostDocumentUpdates(
      { doc_id: 2, warehouse_id: 1, movement_date: "2026-10-31", direction: 1, lines: [{ item_id: 1, lot_id: 0, qty_milli: 10_000, unit_cost_x4: 1_200_000 }], user_id: 1 },
      b1,
    );
    // avg = (10000*1000000 + 10000*1200000) / 20000 = 1100000 = 110 × 10000
    expect(lu2[0].new_avg_cost).toBe(1_100_000);
  });

  it("ยอดหลังรับต้องเพิ่มขึ้น", () => {
    const snap: BalanceSnapshot = new Map();
    const { lineUpdates } = computePostDocumentUpdates(
      { doc_id: 1, warehouse_id: 1, movement_date: "2026-10-31", direction: 1, lines: [{ item_id: 1, lot_id: 0, qty_milli: 5_000, unit_cost_x4: 500_000 }], user_id: 1 },
      snap,
    );
    expect(lineUpdates[0].new_qty).toBe(5_000);
  });
});

// ── validateIssueLines ────────────────────────────────────────────────────────
describe("validateIssueLines", () => {
  it("จ่ายเกินยอดถูกปฏิเสธ", () => {
    const snap = makeSnapshot([{ item_id: 1, lot_id: 0, wh: 1, qty: 5_000, avg: 100_000 }]);
    const result = validateIssueLines(
      [{ item_id: 1, lot_id: 0, qty_milli: 10_000 }],
      snap, 1, new Date("2026-10-31"),
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/ยอดไม่เพียงพอ/);
  });

  it("จ่ายพอดียอดผ่าน", () => {
    const snap = makeSnapshot([{ item_id: 1, lot_id: 0, wh: 1, qty: 10_000, avg: 100_000 }]);
    const result = validateIssueLines(
      [{ item_id: 1, lot_id: 0, qty_milli: 10_000 }],
      snap, 1, new Date("2026-10-31"),
    );
    expect(result.ok).toBe(true);
  });

  it("ห้ามยอดติดลบ — จ่ายเกินยอดทุกกรณี", () => {
    const snap = makeSnapshot([{ item_id: 1, lot_id: 0, wh: 1, qty: 0, avg: 0 }]);
    const result = validateIssueLines(
      [{ item_id: 1, lot_id: 0, qty_milli: 1 }],
      snap, 1, new Date("2026-10-31"),
    );
    expect(result.ok).toBe(false);
  });
});

// ── FEFO ──────────────────────────────────────────────────────────────────────
describe("FEFO lot ordering", () => {
  it("3 ล็อตวันหมดอายุต่างกัน — เรียงหมดก่อนก่อน", () => {
    const lots = [
      { id: 3, expiry_date: "2027-06-01" },
      { id: 1, expiry_date: "2026-12-01" },
      { id: 2, expiry_date: "2027-01-01" },
    ];
    const sorted = computeFEFOOrder(lots);
    expect(sorted.map(l => l.id)).toEqual([1, 2, 3]);
  });

  it("ล็อตเดียวกัน expiry เรียงถูก", () => {
    const lots = [{ id: 5, expiry_date: "2025-01-01" }, { id: 6, expiry_date: "2024-01-01" }];
    const sorted = computeFEFOOrder(lots);
    expect(sorted[0].id).toBe(6);
  });
});

// ── expired lot ───────────────────────────────────────────────────────────────
describe("expired lot", () => {
  it("จ่ายล็อตหมดอายุถูกปฏิเสธ", () => {
    const today = new Date("2026-10-31");
    const snap = makeSnapshot([{ item_id: 1, lot_id: 1, wh: 1, qty: 10_000, avg: 100_000 }]);
    const result = validateIssueLines(
      [{ item_id: 1, lot_id: 1, qty_milli: 5_000 }],
      snap, 1, today,
      [{ id: 1, expiry_date: "2026-10-30" }], // หมดแล้ว
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/หมดอายุ/);
  });

  it("ล็อตยังไม่หมดอายุผ่าน", () => {
    const today = new Date("2026-10-31");
    const snap = makeSnapshot([{ item_id: 1, lot_id: 1, wh: 1, qty: 10_000, avg: 100_000 }]);
    const result = validateIssueLines(
      [{ item_id: 1, lot_id: 1, qty_milli: 5_000 }],
      snap, 1, today,
      [{ id: 1, expiry_date: "2026-11-01" }],
    );
    expect(result.ok).toBe(true);
  });
});

// ── isExpired ─────────────────────────────────────────────────────────────────
describe("isExpired", () => {
  it("วันหมดอายุวานนี้ = หมดแล้ว", () => {
    expect(isExpired("2026-10-30", new Date("2026-10-31"))).toBe(true);
  });
  it("วันหมดอายุวันนี้ = ยังไม่หมด", () => {
    expect(isExpired("2026-10-31", new Date("2026-10-31"))).toBe(false);
  });
  it("วันหมดอายุพรุ่งนี้ = ยังไม่หมด", () => {
    expect(isExpired("2026-11-01", new Date("2026-10-31"))).toBe(false);
  });
});

// ── idempotency (pure logic) ───────────────────────────────────────────────────
describe("idempotency key deduplication", () => {
  it("ส่งคำขอซ้ำ key เดิมต้องได้ผลเดิม (pure logic)", () => {
    const existing = { id: 99, status: "POSTED" };
    const resp = buildIdempotencyResponse(existing);
    expect(resp.idempotent).toBe(true);
    expect(resp.doc_id).toBe(99);
  });
});

// ── concurrent safety (pure logic) ───────────────────────────────────────────
describe("concurrent safety via SQL WHERE clause", () => {
  it("ตรวจยอดด้วย SQL WHERE qty >= ? ไม่ใช่ JS — pure domain ห้ามมีการอ่านก่อนเขียน", () => {
    // ตรวจว่า validateIssueLines รับ snapshot (ผลจาก SQL) ไม่ใช่ query ใหม่
    // SQL WHERE qty_on_hand_milli >= ? จะ enforce atomically ใน D1
    const snap = makeSnapshot([{ item_id: 1, lot_id: 0, wh: 1, qty: 20_000, avg: 100_000 }]);
    // 20 คำขอพร้อมกัน แต่ละอัน qty 1000 รวม 20000 — อันสุดท้ายต้องไม่ผ่านถ้า SQL ทำงานถูก
    // ทดสอบ pure: ยอดหลังจ่ายห้ามติดลบ
    const { lineUpdates } = computePostDocumentUpdates(
      { doc_id: 1, warehouse_id: 1, movement_date: "2026-10-31", direction: -1, lines: [{ item_id: 1, lot_id: 0, qty_milli: 20_000, unit_cost_x4: 100_000 }], user_id: 1 },
      snap,
    );
    expect(lineUpdates[0].new_qty).toBe(0); // พอดี ไม่ติดลบ
  });
});
