// Pure functions for report building — no HTTP, no DB calls

export type BalanceRow = {
  item_id: number;
  sku: string;
  name_th: string;
  category: string;
  warehouse: string;
  lot_no: string | null;
  expiry_date: string | null;
  qty_on_hand_milli: number;
  avg_cost_x4: number;
  unit: string;
};

type MovementRow = {
  doc_type: string;
  qty_milli: number;
  unit_cost_x4: number;
  direction: number;
};

// ── filterCostFields ──────────────────────────────────────────────────────────
// STAFF ห้ามเห็น avg_cost_x4 และ total_value_x4 (ตรวจที่ API layer)
export function filterCostFields(rows: BalanceRow[], role: string) {
  return rows.map((r) => {
    const base = {
      item_id: r.item_id,
      sku: r.sku,
      name_th: r.name_th,
      category: r.category,
      warehouse: r.warehouse,
      lot_no: r.lot_no,
      expiry_date: r.expiry_date,
      qty_on_hand_milli: r.qty_on_hand_milli,
      unit: r.unit,
    };
    if (role === "OWNER") {
      return {
        ...base,
        avg_cost_x4: r.avg_cost_x4,
        total_value_x4: Math.round((r.qty_on_hand_milli / 1000) * r.avg_cost_x4),
      };
    }
    return base;
  });
}

// ── buildBalanceRows ──────────────────────────────────────────────────────────
// คำนวณยอดคงเหลือจาก movements: ยอดยกมา + รับ − จ่าย = คงเหลือ
export function buildBalanceRows(movements: MovementRow[]) {
  const net_qty_milli = movements.reduce(
    (acc, m) => acc + m.direction * m.qty_milli,
    0,
  );
  return { net_qty_milli };
}

// ── buildMovementSummary ──────────────────────────────────────────────────────
export function buildMovementSummary(movements: MovementRow[]) {
  const total_in_milli = movements
    .filter((m) => m.direction === 1)
    .reduce((acc, m) => acc + m.qty_milli, 0);
  const total_out_milli = movements
    .filter((m) => m.direction === -1)
    .reduce((acc, m) => acc + m.qty_milli, 0);
  return { total_in_milli, total_out_milli };
}

// ── buildExpiringRows ─────────────────────────────────────────────────────────
export function buildExpiringRows(
  rows: { lot_no: string; expiry_date: string; item_id: number; qty_on_hand_milli: number }[],
  days: number,
  today: Date = new Date(),
) {
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() + days);
  return rows.filter((r) => {
    if (r.qty_on_hand_milli <= 0) return false;
    const exp = new Date(r.expiry_date);
    return exp >= today && exp <= cutoff;
  });
}

// ── buildReorderRows ──────────────────────────────────────────────────────────
export function buildReorderRows(
  items: { item_id: number; sku: string; reorder_point_milli: number; qty_on_hand_milli: number }[],
) {
  return items.filter((i) => i.qty_on_hand_milli < i.reorder_point_milli);
}

// ── buildExcelColumns ─────────────────────────────────────────────────────────
export function buildExcelColumns(role: string) {
  const base = [
    { key: "sku", label: "รหัส" },
    { key: "name_th", label: "ชื่อสินค้า" },
    { key: "category", label: "หมวด" },
    { key: "warehouse", label: "คลัง" },
    { key: "unit", label: "หน่วย" },
    { key: "qty_on_hand", label: "คงเหลือ" },
    { key: "lot_no", label: "Lot No." },
    { key: "expiry_date", label: "วันหมดอายุ" },
  ];
  if (role === "OWNER") {
    return [
      ...base,
      { key: "avg_cost", label: "ต้นทุนเฉลี่ย/หน่วย" },
      { key: "total_value", label: "มูลค่ารวม" },
    ];
  }
  return base;
}
