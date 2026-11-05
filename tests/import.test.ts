import { describe, it, expect } from "vitest";
import { validateImportRows } from "../src/domain/importValidator";
import { parseThaiDate } from "../src/domain/dateParser";

const UNITS = new Set(["ชิ้น", "กก.", "ลัง", "แพ็ค"]);
const WAREHOUSES = new Set(["WH01", "WH02"]);

function makeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    รหัส: "SKU001",
    ชื่อ: "สินค้าทดสอบ",
    บาร์โค้ด: "1234567890",
    หน่วย: "ชิ้น",
    หมวด: "A",
    คลัง: "WH01",
    จำนวนยกมา: 10,
    ต้นทุนต่อหน่วย: 100,
    จุดสั่งซื้อ: 5,
    "ใช้ล็อต": "N",
    ...overrides,
  };
}

function makeLotRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return makeRow({
    "ใช้ล็อต": "Y",
    "Lot No.": "LOT001",
    วันผลิต: "01/01/2026",
    วันหมดอายุ: "01/01/2027",
    "เลขที่ PO": "PO001",
    โรงงานผู้ผลิต: "บริษัท ABC",
    ...overrides,
  });
}

describe("validateImportRows", () => {
  it("แถวปกติผ่าน", () => {
    const { valid, errors } = validateImportRows([makeRow()], UNITS, WAREHOUSES);
    expect(errors).toHaveLength(0);
    expect(valid).toHaveLength(1);
    expect(valid[0].sku).toBe("SKU001");
  });

  it("หน่วยไม่รู้จัก → error", () => {
    const { errors } = validateImportRows([makeRow({ หน่วย: "ลิตร" })], UNITS, WAREHOUSES);
    expect(errors[0].errors.some(e => e.includes("หน่วยไม่รู้จัก"))).toBe(true);
  });

  it("จำนวนติดลบ → error", () => {
    const { errors } = validateImportRows([makeRow({ จำนวนยกมา: -5 })], UNITS, WAREHOUSES);
    expect(errors[0].errors.some(e => e.includes("ติดลบ"))).toBe(true);
  });

  it("รหัสซ้ำในไฟล์เดียวกัน → error แถวที่ 2", () => {
    const { errors } = validateImportRows([makeRow(), makeRow()], UNITS, WAREHOUSES);
    expect(errors).toHaveLength(1);
    expect(errors[0].rowNum).toBe(3); // แถวที่ 2 ใน Excel = rowNum 3
  });

  it("สินค้าใช้ล็อตแต่ขาด lot_no → error", () => {
    const { errors } = validateImportRows(
      [makeLotRow({ "Lot No.": "" })],
      UNITS, WAREHOUSES,
    );
    expect(errors[0].errors.some(e => e.includes("Lot No."))).toBe(true);
  });

  it("วันหมดอายุก่อนวันผลิต → error", () => {
    const { errors } = validateImportRows(
      [makeLotRow({ วันผลิต: "01/01/2027", วันหมดอายุ: "01/01/2026" })],
      UNITS, WAREHOUSES,
    );
    expect(errors[0].errors.some(e => e.includes("วันหมดอายุต้องมาหลัง"))).toBe(true);
  });

  it("สินค้าใช้ล็อตข้อมูลครบผ่าน", () => {
    const { valid, errors } = validateImportRows([makeLotRow()], UNITS, WAREHOUSES);
    expect(errors).toHaveLength(0);
    expect(valid[0].track_lot).toBe(true);
    expect(valid[0].lot_no).toBe("LOT001");
  });

  it("1000 แถวผ่านทั้งหมด (คนละ SKU)", () => {
    const rows = Array.from({ length: 1000 }, (_, i) =>
      makeRow({ รหัส: `SKU${String(i).padStart(4, "0")}`, บาร์โค้ด: `885${String(i).padStart(10, "0")}` }),
    );
    const { valid, errors } = validateImportRows(rows, UNITS, WAREHOUSES);
    expect(errors).toHaveLength(0);
    expect(valid).toHaveLength(1000);
  });

  it("แถวผิดไม่ถูกนับเป็น valid", () => {
    const rows = [makeRow(), makeRow({ จำนวนยกมา: -1 }), makeRow({ รหัส: "SKU002", บาร์โค้ด: "999" })];
    const { valid, errors } = validateImportRows(rows, UNITS, WAREHOUSES);
    expect(errors).toHaveLength(1);
    expect(valid).toHaveLength(2);
  });

  it("บาร์โค้ดซ้ำในไฟล์ (คนละ SKU) → error พร้อมเลขแถวและ SKU", () => {
    const { valid, errors } = validateImportRows(
      [makeRow({ รหัส: "A", บาร์โค้ด: "111" }), makeRow({ รหัส: "B", บาร์โค้ด: "111" })],
      UNITS, WAREHOUSES,
    );
    expect(valid).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0].rowNum).toBe(3);
    expect(errors[0].errors).toContain("บาร์โค้ด 111 ซ้ำกับแถว 2 (SKU A)");
  });

  it("SKU เดียวกันหลายล็อตใช้บาร์โค้ดเดียวกันได้", () => {
    const { errors } = validateImportRows(
      [makeLotRow({ "Lot No.": "L1" }), makeLotRow({ "Lot No.": "L2" })],
      UNITS, WAREHOUSES,
    );
    expect(errors).toHaveLength(0);
  });

  it("บาร์โค้ดซ้ำกับสินค้าในระบบ (คนละ SKU) → error", () => {
    const { valid, errors } = validateImportRows(
      [makeRow({ รหัส: "ZZT-DUP", บาร์โค้ด: "8850001100001" })],
      UNITS, WAREHOUSES, new Map([["8850001100001", "PUMP-001"]]),
    );
    expect(valid).toHaveLength(0);
    expect(errors[0].errors).toContain("บาร์โค้ด 8850001100001 ซ้ำกับสินค้า PUMP-001");
  });

  it("บาร์โค้ดเดิมของ SKU เดิมในระบบ (นำเข้าไฟล์ซ้ำ) → ผ่าน", () => {
    const { errors } = validateImportRows(
      [makeRow({ รหัส: "PUMP-001", บาร์โค้ด: "8850001100001" })],
      UNITS, WAREHOUSES, new Map([["8850001100001", "PUMP-001"]]),
    );
    expect(errors).toHaveLength(0);
  });

  it("แถวไม่มีบาร์โค้ดหลายแถวไม่ถือว่าซ้ำ", () => {
    const { errors } = validateImportRows(
      [makeRow({ รหัส: "A", บาร์โค้ด: "" }), makeRow({ รหัส: "B", บาร์โค้ด: "" })],
      UNITS, WAREHOUSES,
    );
    expect(errors).toHaveLength(0);
  });
});

describe("parseThaiDate", () => {
  it("วันที่ไทย พ.ศ.", () => {
    expect(parseThaiDate("31/10/2568")).toBe("2025-10-31");
  });

  it("วันที่ไทย ค.ศ.", () => {
    expect(parseThaiDate("31/10/2026")).toBe("2026-10-31");
  });

  it("Excel serial", () => {
    // 45961 = 2025-10-31
    expect(parseThaiDate(45961)).toBe("2025-10-31");
  });

  it("ISO date ผ่าน", () => {
    expect(parseThaiDate("2026-10-31")).toBe("2026-10-31");
  });

  it("ค่าว่าง → null", () => {
    expect(parseThaiDate("")).toBeNull();
    expect(parseThaiDate(null)).toBeNull();
  });
});
