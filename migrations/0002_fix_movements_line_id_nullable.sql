-- Migration 0002: make stock_movements.line_id nullable
-- D1 does not support ALTER COLUMN, so we recreate the table

CREATE TABLE stock_movements_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id),
  line_id INTEGER REFERENCES document_lines(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  lot_id INTEGER REFERENCES lots(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  movement_date TEXT NOT NULL,
  direction INTEGER NOT NULL CHECK(direction IN (1,-1)),
  qty_milli INTEGER NOT NULL,
  unit_cost_x4 INTEGER NOT NULL,
  balance_qty_after_milli INTEGER NOT NULL,
  avg_cost_after_x4 INTEGER NOT NULL
);

INSERT INTO stock_movements_new SELECT * FROM stock_movements;
DROP TABLE stock_movements;
ALTER TABLE stock_movements_new RENAME TO stock_movements;

CREATE INDEX IF NOT EXISTS idx_sm_item_wh_date ON stock_movements(item_id, warehouse_id, movement_date);
