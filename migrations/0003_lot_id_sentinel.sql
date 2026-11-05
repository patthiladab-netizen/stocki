-- Migration 0003: ใช้ lot_id=0 แทน NULL ใน stock_balances และ stock_movements
-- แก้ปัญหา SQLite ที่ถือว่า NULL != NULL ใน PRIMARY KEY ทำให้ ON CONFLICT ไม่ทำงาน
-- ใช้ GROUP BY + SUM เพื่อรวม duplicate rows ที่อาจสะสมจาก ON CONFLICT ที่ไม่ทำงาน

-- ล้างตารางกลางที่อาจค้างจากการ run ครั้งก่อน
DROP TABLE IF EXISTS stock_balances_new;
DROP TABLE IF EXISTS stock_movements_new;

-- ── stock_balances ────────────────────────────────────────────────────────────
CREATE TABLE stock_balances_new (
  item_id      INTEGER NOT NULL REFERENCES items(id),
  lot_id       INTEGER NOT NULL DEFAULT 0,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  qty_on_hand_milli INTEGER NOT NULL DEFAULT 0,
  avg_cost_x4  INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (item_id, lot_id, warehouse_id)
);

-- รวม duplicate rows ด้วย GROUP BY (SUM qty, weighted avg cost)
INSERT INTO stock_balances_new (item_id, lot_id, warehouse_id, qty_on_hand_milli, avg_cost_x4, updated_at)
SELECT
  item_id,
  COALESCE(lot_id, 0)                                                   AS lot_id,
  warehouse_id,
  SUM(qty_on_hand_milli)                                                AS qty_on_hand_milli,
  CASE
    WHEN SUM(qty_on_hand_milli) > 0
    THEN CAST(SUM(CAST(qty_on_hand_milli AS REAL) * avg_cost_x4)
              / SUM(qty_on_hand_milli) AS INTEGER)
    ELSE MAX(avg_cost_x4)
  END                                                                    AS avg_cost_x4,
  MAX(updated_at)                                                        AS updated_at
FROM stock_balances
GROUP BY item_id, COALESCE(lot_id, 0), warehouse_id;

DROP TABLE stock_balances;
ALTER TABLE stock_balances_new RENAME TO stock_balances;

-- ── stock_movements ────────────────────────────────────────────────────────────
CREATE TABLE stock_movements_new (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id  INTEGER NOT NULL REFERENCES documents(id),
  line_id      INTEGER REFERENCES document_lines(id),
  item_id      INTEGER NOT NULL REFERENCES items(id),
  lot_id       INTEGER NOT NULL DEFAULT 0,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  movement_date TEXT NOT NULL,
  direction    INTEGER NOT NULL CHECK(direction IN (1,-1)),
  qty_milli    INTEGER NOT NULL,
  unit_cost_x4 INTEGER NOT NULL DEFAULT 0,
  balance_qty_after_milli INTEGER NOT NULL,
  avg_cost_after_x4 INTEGER NOT NULL DEFAULT 0
);

INSERT INTO stock_movements_new
  SELECT id, document_id, line_id, item_id, COALESCE(lot_id, 0),
         warehouse_id, movement_date, direction, qty_milli,
         unit_cost_x4, balance_qty_after_milli, avg_cost_after_x4
  FROM stock_movements;

DROP TABLE stock_movements;
ALTER TABLE stock_movements_new RENAME TO stock_movements;

CREATE INDEX IF NOT EXISTS idx_sm_item_wh_date
  ON stock_movements(item_id, warehouse_id, movement_date);

CREATE INDEX IF NOT EXISTS idx_sm_doc
  ON stock_movements(document_id);
