-- Migration 0000: initial schema
-- Stocki v0.1

CREATE TABLE IF NOT EXISTS company (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  tax_id TEXT,
  branch_code TEXT,
  costing_method TEXT NOT NULL DEFAULT 'MOVING_AVG' CHECK (costing_method IN ('MOVING_AVG'))
);

CREATE TABLE IF NOT EXISTS warehouses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  branch_code TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name_th TEXT NOT NULL,
  decimal_places INTEGER NOT NULL DEFAULT 3
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE,
  name_th TEXT NOT NULL,
  barcode TEXT,
  category_id INTEGER REFERENCES categories(id),
  unit_id INTEGER REFERENCES units(id),
  track_lot INTEGER NOT NULL DEFAULT 0,
  reorder_point_milli INTEGER NOT NULL DEFAULT 0,
  standard_cost_x4 INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE'))
);

CREATE INDEX IF NOT EXISTS items_barcode_idx ON items(barcode);
CREATE INDEX IF NOT EXISTS items_sku_idx ON items(sku);

CREATE TABLE IF NOT EXISTS lots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id),
  lot_no TEXT NOT NULL,
  mfg_date TEXT NOT NULL,
  expiry_date TEXT NOT NULL,
  po_no TEXT NOT NULL,
  manufacturer_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(item_id, lot_no)
);

CREATE INDEX IF NOT EXISTS lots_item_expiry_idx ON lots(item_id, expiry_date);

CREATE TABLE IF NOT EXISTS doc_sequences (
  doc_type TEXT NOT NULL,
  yymm TEXT NOT NULL,
  last_no INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (doc_type, yymm)
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('OPENING','RECEIVE','ISSUE','CANCEL')),
  doc_no TEXT NOT NULL UNIQUE,
  doc_date TEXT NOT NULL,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','POSTED','CANCELLED')),
  ref_text TEXT,
  note TEXT,
  created_by INTEGER,
  posted_by INTEGER,
  posted_at TEXT,
  idempotency_key TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS document_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  lot_id INTEGER REFERENCES lots(id),
  qty_milli INTEGER NOT NULL,
  unit_cost_x4 INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id),
  line_id INTEGER NOT NULL REFERENCES document_lines(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  lot_id INTEGER REFERENCES lots(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  movement_date TEXT NOT NULL,
  direction INTEGER NOT NULL CHECK (direction IN (1,-1)),
  qty_milli INTEGER NOT NULL,
  unit_cost_x4 INTEGER NOT NULL,
  balance_qty_after_milli INTEGER NOT NULL,
  avg_cost_after_x4 INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS movements_item_wh_date_idx ON stock_movements(item_id, warehouse_id, movement_date);

CREATE TABLE IF NOT EXISTS stock_balances (
  item_id INTEGER NOT NULL REFERENCES items(id),
  lot_id INTEGER REFERENCES lots(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  qty_on_hand_milli INTEGER NOT NULL DEFAULT 0,
  avg_cost_x4 INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (item_id, lot_id, warehouse_id)
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'STAFF' CHECK (role IN ('OWNER','STAFF')),
  is_active INTEGER NOT NULL DEFAULT 1,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  old_json TEXT,
  new_json TEXT,
  user_id INTEGER,
  at TEXT NOT NULL
);
