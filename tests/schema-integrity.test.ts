import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { join } from "path";

function setupDb() {
  const db = new Database(":memory:");
  const sql = readFileSync(join(process.cwd(), "migrations/0000_init.sql"), "utf-8");
  db.exec(sql);
  return db;
}

describe("schema integrity: movements sum = balances", () => {
  it("ผลรวม stock_movements ตรงกับ stock_balances หลัง insert", () => {
    const db = setupDb();

    // seed warehouse + item
    db.prepare("INSERT INTO warehouses (code,name,is_active) VALUES ('WH01','คลังหลัก',1)").run();
    db.prepare("INSERT INTO units (code,name_th) VALUES ('PCS','ชิ้น')").run();
    db.prepare("INSERT INTO items (sku,name_th,unit_id,track_lot) VALUES ('SKU001','สินค้าทดสอบ',1,0)").run();

    // insert balance and two movements (direction +1)
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO stock_balances (item_id,lot_id,warehouse_id,qty_on_hand_milli,avg_cost_x4,updated_at) VALUES (1,NULL,1,15000,1000000,?)"
    ).run(now);

    // สร้างเอกสาร + lines + movements จำลอง (qty 10+5=15)
    db.prepare(
      "INSERT INTO doc_sequences (doc_type,yymm,last_no) VALUES ('OPENING','2611',1)"
    ).run();
    db.prepare(
      "INSERT INTO documents (doc_type,doc_no,doc_date,warehouse_id,status,idempotency_key) VALUES ('OPENING','OPN-2611-0001','2026-11-01',1,'POSTED','key-001')"
    ).run();
    db.prepare(
      "INSERT INTO document_lines (document_id,item_id,lot_id,qty_milli,unit_cost_x4) VALUES (1,1,NULL,10000,1000000)"
    ).run();
    db.prepare(
      "INSERT INTO document_lines (document_id,item_id,lot_id,qty_milli,unit_cost_x4) VALUES (1,1,NULL,5000,1000000)"
    ).run();
    db.prepare(
      "INSERT INTO stock_movements (document_id,line_id,item_id,lot_id,warehouse_id,movement_date,direction,qty_milli,unit_cost_x4,balance_qty_after_milli,avg_cost_after_x4) VALUES (1,1,1,NULL,1,'2026-11-01',1,10000,1000000,10000,1000000)"
    ).run();
    db.prepare(
      "INSERT INTO stock_movements (document_id,line_id,item_id,lot_id,warehouse_id,movement_date,direction,qty_milli,unit_cost_x4,balance_qty_after_milli,avg_cost_after_x4) VALUES (1,2,1,NULL,1,'2026-11-01',1,5000,1000000,15000,1000000)"
    ).run();

    // ตรวจ: SUM(direction*qty_milli) จาก movements = qty_on_hand_milli ใน balances
    const movSum = db.prepare(
      "SELECT SUM(direction * qty_milli) as total FROM stock_movements WHERE item_id=1 AND warehouse_id=1"
    ).get() as { total: number };

    const bal = db.prepare(
      "SELECT qty_on_hand_milli FROM stock_balances WHERE item_id=1 AND warehouse_id=1"
    ).get() as { qty_on_hand_milli: number };

    expect(movSum.total).toBe(bal.qty_on_hand_milli);
  });

  it("ห้ามยอดติดลบ — qty_on_hand_milli >= 0", () => {
    const db = setupDb();
    db.prepare("INSERT INTO warehouses (code,name,is_active) VALUES ('WH01','คลังหลัก',1)").run();
    db.prepare("INSERT INTO units (code,name_th) VALUES ('PCS','ชิ้น')").run();
    db.prepare("INSERT INTO items (sku,name_th,unit_id,track_lot) VALUES ('SKU001','สินค้าทดสอบ',1,0)").run();

    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO stock_balances (item_id,lot_id,warehouse_id,qty_on_hand_milli,avg_cost_x4,updated_at) VALUES (1,NULL,1,5000,1000000,?)"
    ).run(now);

    // พยายาม UPDATE WHERE qty >= required — ถ้ายอดไม่พอ changes=0
    const result = db.prepare(
      "UPDATE stock_balances SET qty_on_hand_milli = qty_on_hand_milli - 10000, updated_at=? WHERE item_id=1 AND warehouse_id=1 AND qty_on_hand_milli >= 10000"
    ).run(now);

    expect(result.changes).toBe(0); // ปฏิเสธ — ยอดไม่พอ

    const bal = db.prepare(
      "SELECT qty_on_hand_milli FROM stock_balances WHERE item_id=1 AND warehouse_id=1"
    ).get() as { qty_on_hand_milli: number };

    expect(bal.qty_on_hand_milli).toBeGreaterThanOrEqual(0);
  });
});
