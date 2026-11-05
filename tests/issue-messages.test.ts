import { describe, it, expect } from "vitest";
import { validateIssueLines, formatQtyMilli } from "../src/domain/documentEngine";

const today = new Date("2026-11-03T00:00:00Z");

describe("formatQtyMilli", () => {
  it("trims trailing zeros", () => {
    expect(formatQtyMilli(75000)).toBe("75");
    expect(formatQtyMilli(1500)).toBe("1.5");
    expect(formatQtyMilli(1)).toBe("0.001");
    expect(formatQtyMilli(1234567)).toBe("1,234.567");
  });
});

describe("validateIssueLines — readable Thai messages", () => {
  const snap = new Map([["6:1:1", { qty: 75000, avg_cost: 0 }]]);
  const items = [{ id: 6, sku: "CHIA-001", name_th: "เมล็ดเจีย ออร์แกนิก" }];
  const lots = [{ id: 1, expiry_date: "2027-01-01", lot_no: "CHIA-2025-A1" }];

  it("uses SKU, name, lot no and display quantities", () => {
    const { ok, errors } = validateIssueLines(
      [{ item_id: 6, lot_id: 1, qty_milli: 500000 }], snap, 1, today, lots, items,
    );
    expect(ok).toBe(false);
    expect(errors[0]).toBe("CHIA-001 เมล็ดเจีย ออร์แกนิก ล็อต CHIA-2025-A1: ยอดไม่เพียงพอ คงเหลือ 75 แต่ต้องการตัด 500");
    expect(errors[0]).not.toMatch(/item_id|lot_id|หมดอายุ/);
  });

  it("non-lot item without lot label", () => {
    const { errors } = validateIssueLines(
      [{ item_id: 6, lot_id: 0, qty_milli: 1500 }], new Map(), 1, today, [], items,
    );
    expect(errors[0]).toBe("CHIA-001 เมล็ดเจีย ออร์แกนิก: ยอดไม่เพียงพอ คงเหลือ 0 แต่ต้องการตัด 1.5");
  });

  it("expired lot message in Thai date", () => {
    const { errors } = validateIssueLines(
      [{ item_id: 6, lot_id: 2, qty_milli: 1000 }],
      new Map([["6:2:1", { qty: 5000, avg_cost: 0 }]]), 1, today,
      [{ id: 2, expiry_date: "2026-10-01", lot_no: "OLD-1" }], items,
    );
    expect(errors[0]).toBe("CHIA-001 เมล็ดเจีย ออร์แกนิก ล็อต OLD-1: ล็อตหมดอายุแล้ว (01/10/2026)");
  });

  it("falls back to item id when names unknown", () => {
    const { errors } = validateIssueLines([{ item_id: 9, lot_id: 0, qty_milli: 1000 }], new Map(), 1, today);
    expect(errors[0]).toBe("สินค้า #9: ยอดไม่เพียงพอ คงเหลือ 0 แต่ต้องการตัด 1");
  });
});
