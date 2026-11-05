/**
 * postDocument() — สร้าง batch statements สำหรับเปลี่ยนยอดสต็อก
 * Pure logic ไม่ depend D1 types โดยตรง — ผู้เรียกส่ง preparer function มาให้
 */

export type PostLine = {
  item_id: number;
  lot_id: number;        // 0 = ไม่มีล็อต (sentinel)
  qty_milli: number;     // จำนวนสัมบูรณ์ (ไม่รวม direction)
  unit_cost_x4: number;
};

export type PostDocumentInput = {
  doc_id: number;
  warehouse_id: number;
  movement_date: string;
  direction: 1 | -1;
  lines: PostLine[];
  user_id: number;
};

export type BalanceSnapshot = Map<string, { qty: number; avg_cost: number }>;

/**
 * คำนวณ balance ใหม่หลัง post
 * คืน balances ที่อัปเดตแล้ว พร้อม SQL params สำหรับแต่ละ line
 */
export function computePostDocumentUpdates(
  input: PostDocumentInput,
  snapshot: BalanceSnapshot,
): {
  lineUpdates: Array<{
    item_id: number;
    lot_id: number;
    warehouse_id: number;
    qty_milli: number;
    unit_cost_x4: number;
    new_qty: number;
    new_avg_cost: number;
    direction: 1 | -1;
  }>;
  newBalances: BalanceSnapshot;
} {
  const newBalances: BalanceSnapshot = new Map(snapshot);
  const lineUpdates = [];

  for (const line of input.lines) {
    const key = `${line.item_id}:${line.lot_id ?? 0}:${input.warehouse_id}`;
    const cur = newBalances.get(key) ?? { qty: 0, avg_cost: 0 };

    const newQty = cur.qty + input.direction * line.qty_milli;
    let newAvgCost = cur.avg_cost;

    if (input.direction === 1 && cur.qty + line.qty_milli > 0) {
      newAvgCost = Math.round(
        (cur.qty * cur.avg_cost + line.qty_milli * line.unit_cost_x4) /
          (cur.qty + line.qty_milli),
      );
    }

    lineUpdates.push({
      item_id: line.item_id,
      lot_id: line.lot_id,   // 0 = no lot
      warehouse_id: input.warehouse_id,
      qty_milli: line.qty_milli,
      unit_cost_x4: line.unit_cost_x4,
      new_qty: newQty,
      new_avg_cost: newAvgCost,
      direction: input.direction,
    });

    newBalances.set(key, { qty: newQty, avg_cost: newAvgCost });
  }

  return { lineUpdates, newBalances };
}
