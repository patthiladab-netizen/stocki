import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { createItemsService } from "../src/api/items-service";

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL
    );
    CREATE TABLE units (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name_th TEXT NOT NULL,
      decimal_places INTEGER NOT NULL DEFAULT 3
    );
    CREATE TABLE items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT NOT NULL UNIQUE,
      name_th TEXT NOT NULL,
      barcode TEXT,
      category_id INTEGER,
      unit_id INTEGER,
      track_lot INTEGER NOT NULL DEFAULT 0,
      reorder_point_milli INTEGER NOT NULL DEFAULT 0,
      standard_cost_x4 INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ACTIVE'
    );
    CREATE INDEX items_barcode_idx ON items(barcode);
    CREATE INDEX items_sku_idx ON items(sku);
    CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      action TEXT NOT NULL,
      old_json TEXT,
      new_json TEXT,
      user_id INTEGER,
      at TEXT NOT NULL
    );
    INSERT INTO units (code, name_th) VALUES ('PCS', 'ชิ้น');
    INSERT INTO categories (code, name) VALUES ('GEN', 'ทั่วไป');
  `);
  return db;
}

describe("ItemsService", () => {
  let db: ReturnType<typeof makeDb>;
  let svc: ReturnType<typeof createItemsService>;

  beforeEach(() => {
    db = makeDb();
    svc = createItemsService(db);
  });

  it("creates an item and finds it by id", () => {
    const id = svc.create({ sku: "ITM001", name_th: "สินค้าทดสอบ", unit_id: 1 }, 1);
    const item = svc.getById(id);
    expect(item).toBeTruthy();
    expect(item!.sku).toBe("ITM001");
    expect(item!.name_th).toBe("สินค้าทดสอบ");
  });

  it("searches by name_th", () => {
    svc.create({ sku: "ITM001", name_th: "น้ำตาลทราย", unit_id: 1 }, 1);
    svc.create({ sku: "ITM002", name_th: "เกลือ", unit_id: 1 }, 1);
    const result = svc.search("น้ำตาล");
    expect(result).toHaveLength(1);
    expect(result[0].sku).toBe("ITM001");
  });

  it("searches by barcode exact match", () => {
    svc.create({ sku: "ITM001", name_th: "สินค้า A", barcode: "8850000001111", unit_id: 1 }, 1);
    svc.create({ sku: "ITM002", name_th: "สินค้า B", barcode: "8850000002222", unit_id: 1 }, 1);
    const result = svc.search("8850000001111");
    expect(result).toHaveLength(1);
    expect(result[0].sku).toBe("ITM001");
  });

  it("updates item and writes audit_log", () => {
    const id = svc.create({ sku: "ITM001", name_th: "เดิม", unit_id: 1 }, 1);
    svc.update(id, { name_th: "ใหม่" }, 1);
    const item = svc.getById(id);
    expect(item!.name_th).toBe("ใหม่");
    const log = db.prepare("SELECT * FROM audit_logs WHERE table_name='items' AND record_id=? AND action='UPDATE'").get(String(id)) as any;
    expect(log).toBeTruthy();
    expect(log.action).toBe("UPDATE");
    expect(JSON.parse(log.old_json).name_th).toBe("เดิม");
    expect(JSON.parse(log.new_json).name_th).toBe("ใหม่");
  });

  it("STAFF does not see standard_cost_x4 in list", () => {
    svc.create({ sku: "ITM001", name_th: "สินค้า", standard_cost_x4: 50000, unit_id: 1 }, 1);
    const result = svc.search("", { role: "STAFF" });
    expect(result[0]).not.toHaveProperty("standard_cost_x4");
    expect(result[0]).not.toHaveProperty("avg_cost");
  });

  it("OWNER sees standard_cost_x4 in list", () => {
    svc.create({ sku: "ITM001", name_th: "สินค้า", standard_cost_x4: 50000, unit_id: 1 }, 1);
    const result = svc.search("", { role: "OWNER" });
    expect(result[0]).toHaveProperty("standard_cost_x4");
  });
});
