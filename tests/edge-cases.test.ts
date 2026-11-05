/**
 * Edge-case unit tests — ตรวจพฤติกรรมเส้นขอบที่ test ชุดหลักไม่ครอบคลุม
 */
import { describe, it, expect } from "vitest";
import { computePostDocumentUpdates, type BalanceSnapshot } from "../src/domain/postDocument";
import {
  validateIssueLines,
  isExpired,
  buildIdempotencyResponse,
} from "../src/domain/documentEngine";
import { validateImportRows } from "../src/domain/importValidator";
import { parseThaiDate } from "../src/domain/dateParser";

const UNITS = new Set(["ชิ้น", "กก.", "ลัง"]);
const WAREHOUSES = new Set(["WH01"]);
const TODAY = new Date("2026-11-02");
const TOMORROW = new Date("2026-11-03");

function snap(entries: Array<{ item_id: number; lot_id: number; wh: number; qty: number; avg: number }>): BalanceSnapshot {
  const m: BalanceSnapshot = new Map();
  for (const e of entries) m.set(`${e.item_id}:${e.lot_id}:${e.wh}`, { qty: e.qty, avg_cost: e.avg });
  return m;
}

function makeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    รหัส: "SKU001", ชื่อ: "สินค้า", บาร์โค้ด: "1234", หน่วย: "ชิ้น", หมวด: "A", คลัง: "WH01",
    จำนวนยกมา: 10, ต้นทุนต่อหน่วย: 100, จุดสั่งซื้อ: 5, "ใช้ล็อต": "N",
    ...overrides,
  };
}
function makeLotRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return makeRow({
    "ใช้ล็อต": "Y", "Lot No.": "LOT001", วันผลิต: "01/01/2026", วันหมดอายุ: "01/01/2027",
    "เลขที่ PO": "PO001", โรงงานผู้ผลิต: "ABC",
    ...overrides,
  });
}

// ── 1. postDocument: ยอดไม่ติดลบหลังตัดออก ────────────────────────────────────
describe("postDocument — ห้ามยอดติดลบ", () => {
  it("qty จ่ายพอดีกับยอดคงเหลือ → new_balance = 0", () => {
    const s = snap([{ item_id: 1, lot_id: 0, wh: 1, qty: 10_000, avg: 1_000_000 }]);
    const { newBalances } = computePostDocumentUpdates(
      { doc_id: 1, warehouse_id: 1, movement_date: "2026-10-31", direction: -1,
        lines: [{ item_id: 1, lot_id: 0, qty_milli: 10_000, unit_cost_x4: 1_000_000 }], user_id: 1 },
      s,
    );
    const bal = newBalances.get("1:0:1");
    expect(bal?.qty).toBe(0);
  });

  it("ต้นทุนเฉลี่ยไม่เปลี่ยนหลังตัดออก (direction=-1)", () => {
    const s = snap([{ item_id: 2, lot_id: 0, wh: 1, qty: 20_000, avg: 1_500_000 }]);
    const { lineUpdates } = computePostDocumentUpdates(
      { doc_id: 2, warehouse_id: 1, movement_date: "2026-10-31", direction: -1,
        lines: [{ item_id: 2, lot_id: 0, qty_milli: 5_000, unit_cost_x4: 1_500_000 }], user_id: 1 },
      s,
    );
    expect(lineUpdates[0].new_avg_cost).toBe(1_500_000);
  });
});

// ── 2. moving average หลาย batch ────────────────────────────────────────────────
describe("moving average — edge cases", () => {
  it("รับสินค้าเมื่อยอดเป็น 0 → avg = ราคาที่รับเข้า", () => {
    const s: BalanceSnapshot = new Map();
    const { lineUpdates } = computePostDocumentUpdates(
      { doc_id: 10, warehouse_id: 1, movement_date: "2026-10-31", direction: 1,
        lines: [{ item_id: 5, lot_id: 0, qty_milli: 5_000, unit_cost_x4: 2_000_000 }], user_id: 1 },
      s,
    );
    expect(lineUpdates[0].new_avg_cost).toBe(2_000_000);
  });

  it("รับ 100@50 + 100@150 → avg = 100 (1_000_000 x4 scaled)", () => {
    const s1: BalanceSnapshot = new Map();
    const { newBalances: b1 } = computePostDocumentUpdates(
      { doc_id: 20, warehouse_id: 1, movement_date: "2026-10-31", direction: 1,
        lines: [{ item_id: 6, lot_id: 0, qty_milli: 100_000, unit_cost_x4: 500_000 }], user_id: 1 },
      s1,
    );
    const { lineUpdates: lu2 } = computePostDocumentUpdates(
      { doc_id: 21, warehouse_id: 1, movement_date: "2026-10-31", direction: 1,
        lines: [{ item_id: 6, lot_id: 0, qty_milli: 100_000, unit_cost_x4: 1_500_000 }], user_id: 1 },
      b1,
    );
    expect(lu2[0].new_avg_cost).toBe(1_000_000);
  });
});

// ── 3. validateIssueLines ────────────────────────────────────────────────────────
describe("validateIssueLines — edge cases", () => {
  it("จ่ายหลายรายการ รายการหนึ่งไม่พอ → error เฉพาะรายการนั้น", () => {
    const balances = new Map([
      ["1:0:1", { qty: 10_000, avg_cost: 1_000_000 }],
      ["2:0:1", { qty: 5_000, avg_cost: 500_000 }],
    ]);
    const { ok, errors } = validateIssueLines(
      [
        { item_id: 1, lot_id: 0, qty_milli: 10_000 },
        { item_id: 2, lot_id: 0, qty_milli: 6_000 },
      ],
      balances,
      1,
      TODAY,
    );
    expect(ok).toBe(false);
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatch(/2|ยอดไม่เพียงพอ/);
  });

  it("จ่าย qty พอดีทุกรายการ → ok=true", () => {
    const balances = new Map([["3:0:1", { qty: 1_000, avg_cost: 100_000 }]]);
    const { ok } = validateIssueLines(
      [{ item_id: 3, lot_id: 0, qty_milli: 1_000 }],
      balances,
      1,
      TODAY,
    );
    expect(ok).toBe(true);
  });

  it("lot_id > 0 แต่ lot หมดอายุ → error", () => {
    const balances = new Map([["4:1:1", { qty: 10_000, avg_cost: 1_000_000 }]]);
    const yesterday = new Date(TODAY.getTime() - 86_400_000).toISOString().slice(0, 10);
    const { ok, errors } = validateIssueLines(
      [{ item_id: 4, lot_id: 1, qty_milli: 1_000 }],
      balances,
      1,
      TODAY,
      [{ id: 1, expiry_date: yesterday }],
    );
    expect(ok).toBe(false);
    expect(errors[0]).toMatch(/หมดอายุ/);
  });
});

// ── 4. isExpired ────────────────────────────────────────────────────────────────
describe("isExpired — edge cases", () => {
  it("วันหมดอายุ = วันนี้ → ยังไม่ถือว่าหมดอายุ (exp < today ใช้ strict <)", () => {
    const today = TODAY.toISOString().slice(0, 10);
    expect(isExpired(today, TODAY)).toBe(false);
  });

  it("วันหมดอายุพรุ่งนี้ → ยังไม่หมดอายุ", () => {
    expect(isExpired("2026-11-03", TODAY)).toBe(false);
  });

  it("วันหมดอายุเมื่อวาน → หมดอายุแล้ว", () => {
    expect(isExpired("2026-11-01", TODAY)).toBe(true);
  });
});

// ── 5. idempotency ──────────────────────────────────────────────────────────────
describe("buildIdempotencyResponse", () => {
  it("ส่งกลับ idempotent=true พร้อม doc_id และ status", () => {
    const res = buildIdempotencyResponse({ id: 42, status: "POSTED" });
    expect(res).toMatchObject({ ok: true, idempotent: true, doc_id: 42, status: "POSTED" });
  });
});

// ── 6. validateImportRows — edge cases ──────────────────────────────────────────
describe("validateImportRows — edge cases", () => {
  it("วันหมดอายุ = วันผลิต → error", () => {
    const rows = [makeLotRow({ วันผลิต: "01/06/2026", วันหมดอายุ: "01/06/2026" })];
    const { errors } = validateImportRows(rows, UNITS, WAREHOUSES);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].errors.join(" ")).toMatch(/วันหมดอายุ/);
  });

  it("lot_no เป็น whitespace เท่านั้น → error ขาดข้อมูลล็อต", () => {
    const rows = [makeLotRow({ "Lot No.": "   " })];
    const { errors } = validateImportRows(rows, UNITS, WAREHOUSES);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("สินค้าใช้ล็อต ขาด mfg_date → error", () => {
    const rows = [makeLotRow({ วันผลิต: "" })];
    const { errors } = validateImportRows(rows, UNITS, WAREHOUSES);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("สินค้าใช้ล็อต ขาด manufacturer_name → error", () => {
    const rows = [makeLotRow({ โรงงานผู้ผลิต: "" })];
    const { errors } = validateImportRows(rows, UNITS, WAREHOUSES);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("จำนวนยกมา = 0 → ผ่าน (ยอดยกมาเป็น 0 ได้)", () => {
    const rows = [makeRow({ จำนวนยกมา: 0 })];
    const { errors } = validateImportRows(rows, UNITS, WAREHOUSES);
    const qtyErrors = errors.filter((e) => e.errors.some((m) => m.includes("จำนวน")));
    expect(qtyErrors.length).toBe(0);
  });

  it("จำนวนยกมา < 0 → error", () => {
    const rows = [makeRow({ จำนวนยกมา: -5 })];
    const { errors } = validateImportRows(rows, UNITS, WAREHOUSES);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("ต้นทุน < 0 → error", () => {
    const rows = [makeRow({ ต้นทุนต่อหน่วย: -100 })];
    const { errors } = validateImportRows(rows, UNITS, WAREHOUSES);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("หน่วยไม่อยู่ใน known set → error พร้อม rowNum ถูกต้อง", () => {
    const rows = [
      makeRow(),
      makeRow({ รหัส: "SKU002", บาร์โค้ด: "9999", หน่วย: "หน่วยไม่รู้จัก" }),
    ];
    const { errors } = validateImportRows(rows, UNITS, WAREHOUSES);
    const unitErr = errors.find((e) => e.rowNum === 3); // row 2 → rowNum 3 (header=1, data starts=2)
    expect(unitErr).toBeTruthy();
  });

  it("สินค้าไม่ใช้ล็อต ไม่กรอกข้อมูลล็อต → ผ่าน", () => {
    const rows = [makeRow()];
    const { errors } = validateImportRows(rows, UNITS, WAREHOUSES);
    expect(errors.length).toBe(0);
  });

  it("สินค้าเดียวกัน lot_no เดียวกัน คลังเดียวกัน 2 แถว → error ซ้ำ", () => {
    const rows = [makeLotRow(), makeLotRow()];
    const { errors } = validateImportRows(rows, UNITS, WAREHOUSES);
    const dupErr = errors.find((e) => e.errors.some((m) => m.includes("ซ้ำ") || m.includes("duplicate")));
    expect(dupErr).toBeTruthy();
  });
});

// ── 7. parseThaiDate — edge cases ──────────────────────────────────────────────
describe("parseThaiDate — edge cases", () => {
  it("ปี พ.ศ. 2567 → 2024-xx-xx", () => {
    const result = parseThaiDate("01/01/2567");
    expect(result?.startsWith("2024")).toBe(true);
  });

  it("ปี ค.ศ. 2025 → 2025-xx-xx", () => {
    const result = parseThaiDate("15/06/2025");
    expect(result?.startsWith("2025")).toBe(true);
  });

  it("Excel serial number 45292 → ISO date string", () => {
    const result = parseThaiDate(45292);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("ค่าว่าง → null (parseThaiDate คืน null สำหรับค่าว่าง)", () => {
    expect(parseThaiDate("")).toBeNull();
    expect(parseThaiDate(undefined)).toBeNull();
  });
});
