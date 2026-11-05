import { describe, it, expect, beforeEach } from "vitest";
import {
  filterCostFields,
  buildBalanceRows,
  buildMovementSummary,
  buildExpiringRows,
  buildReorderRows,
  buildExcelColumns,
} from "../src/domain/reportEngine";

// ── helpers ───────────────────────────────────────────────────────────────────

const ownerRole = "OWNER";
const staffRole = "STAFF";

const sampleBalances = [
  {
    item_id: 1,
    sku: "A001",
    name_th: "สินค้า A",
    category: "หมวด 1",
    warehouse: "คลัง 1",
    lot_no: null,
    expiry_date: null,
    qty_on_hand_milli: 10_000,
    avg_cost_x4: 1_100_000,
    unit: "ชิ้น",
  },
];

const sampleMovements = [
  { doc_type: "OPENING", qty_milli: 5_000, unit_cost_x4: 1_000_000, direction: 1 },
  { doc_type: "RECEIVE",  qty_milli: 10_000, unit_cost_x4: 1_000_000, direction: 1 },
  { doc_type: "ISSUE",    qty_milli: 5_000,  unit_cost_x4: 1_000_000, direction: -1 },
];

// ── tests ─────────────────────────────────────────────────────────────────────

describe("reportEngine.filterCostFields", () => {
  it("OWNER เห็นต้นทุนและมูลค่า", () => {
    const rows = filterCostFields(sampleBalances, ownerRole);
    expect(rows[0]).toHaveProperty("avg_cost_x4");
    expect(rows[0]).toHaveProperty("total_value_x4");
  });

  it("STAFF ไม่เห็น avg_cost_x4 และ total_value_x4", () => {
    const rows = filterCostFields(sampleBalances, staffRole);
    expect(rows[0]).not.toHaveProperty("avg_cost_x4");
    expect(rows[0]).not.toHaveProperty("total_value_x4");
  });
});

describe("reportEngine.buildBalanceRows — ยอดยกมา+รับ−จ่าย = คงเหลือ", () => {
  it("คำนวณยอดคงเหลือถูกต้อง", () => {
    // opening 5 + receive 10 - issue 5 = 10
    const result = buildBalanceRows(sampleMovements);
    expect(result.net_qty_milli).toBe(10_000);
  });
});

describe("reportEngine.buildMovementSummary", () => {
  it("รวมรับและจ่ายแยกประเภทถูกต้อง", () => {
    const summary = buildMovementSummary(sampleMovements);
    expect(summary.total_in_milli).toBe(15_000);  // opening+receive
    expect(summary.total_out_milli).toBe(5_000);
  });
});

describe("reportEngine.buildExpiringRows", () => {
  const today = new Date("2026-11-01");
  const rows = [
    { lot_no: "L1", expiry_date: "2026-11-20", item_id: 1, qty_on_hand_milli: 1000 },
    { lot_no: "L2", expiry_date: "2027-03-01", item_id: 1, qty_on_hand_milli: 1000 },
    { lot_no: "L3", expiry_date: "2026-10-01", item_id: 1, qty_on_hand_milli: 0 },  // หมดแล้ว qty=0
  ];

  it("กรอง 30 วัน เจอแค่ L1", () => {
    const result = buildExpiringRows(rows, 30, today);
    expect(result).toHaveLength(1);
    expect(result[0].lot_no).toBe("L1");
  });

  it("ไม่แสดงล็อตที่ qty=0", () => {
    const result = buildExpiringRows(rows, 90, today);
    const nos = result.map((r: any) => r.lot_no);
    expect(nos).not.toContain("L3");
  });
});

describe("reportEngine.buildReorderRows", () => {
  const items = [
    { item_id: 1, sku: "A001", reorder_point_milli: 5_000, qty_on_hand_milli: 3_000 },
    { item_id: 2, sku: "A002", reorder_point_milli: 5_000, qty_on_hand_milli: 8_000 },
  ];
  it("แสดงเฉพาะรายการที่ต่ำกว่าจุดสั่งซื้อ", () => {
    const result = buildReorderRows(items);
    expect(result).toHaveLength(1);
    expect(result[0].sku).toBe("A001");
  });
});

describe("reportEngine.buildExcelColumns — STAFF ไม่เห็นคอลัมน์มูลค่า", () => {
  it("OWNER เห็นคอลัมน์ต้นทุนและมูลค่า", () => {
    const cols = buildExcelColumns(ownerRole);
    expect(cols.some((c: any) => c.key === "avg_cost")).toBe(true);
    expect(cols.some((c: any) => c.key === "total_value")).toBe(true);
  });

  it("STAFF ไม่เห็นคอลัมน์ต้นทุนและมูลค่า", () => {
    const cols = buildExcelColumns(staffRole);
    expect(cols.some((c: any) => c.key === "avg_cost")).toBe(false);
    expect(cols.some((c: any) => c.key === "total_value")).toBe(false);
  });
});
