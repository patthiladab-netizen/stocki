import { sqliteTable, text, integer, primaryKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";

// ── company ──────────────────────────────────────────────────────────────────
export const company = sqliteTable("company", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  tax_id: text("tax_id"),
  branch_code: text("branch_code"),
  costing_method: text("costing_method", { enum: ["MOVING_AVG"] }).notNull().default("MOVING_AVG"),
});

// ── warehouses ────────────────────────────────────────────────────────────────
export const warehouses = sqliteTable("warehouses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  branch_code: text("branch_code"),
  is_active: integer("is_active", { mode: "boolean" }).notNull().default(true),
});

// ── units ─────────────────────────────────────────────────────────────────────
export const units = sqliteTable("units", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  name_th: text("name_th").notNull(),
  decimal_places: integer("decimal_places").notNull().default(3),
});

// ── categories ────────────────────────────────────────────────────────────────
export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
});

// ── items ─────────────────────────────────────────────────────────────────────
export const items = sqliteTable("items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sku: text("sku").notNull().unique(),
  name_th: text("name_th").notNull(),
  barcode: text("barcode"),
  category_id: integer("category_id").references(() => categories.id),
  unit_id: integer("unit_id").references(() => units.id),
  track_lot: integer("track_lot", { mode: "boolean" }).notNull().default(false),
  reorder_point_milli: integer("reorder_point_milli").notNull().default(0),
  standard_cost_x4: integer("standard_cost_x4").notNull().default(0),
  status: text("status", { enum: ["ACTIVE", "INACTIVE"] }).notNull().default("ACTIVE"),
}, (t) => ({
  idx_barcode: uniqueIndex("items_barcode_unique_idx").on(t.barcode),
  idx_sku: index("items_sku_idx").on(t.sku),
}));

// ── lots ──────────────────────────────────────────────────────────────────────
export const lots = sqliteTable("lots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  item_id: integer("item_id").notNull().references(() => items.id),
  lot_no: text("lot_no").notNull(),
  mfg_date: text("mfg_date").notNull(),
  expiry_date: text("expiry_date").notNull(),
  po_no: text("po_no").notNull(),
  manufacturer_name: text("manufacturer_name").notNull(),
  created_at: text("created_at").notNull(),
}, (t) => ({
  uq_item_lot: uniqueIndex("lots_item_lot_uq").on(t.item_id, t.lot_no),
  idx_expiry: index("lots_item_expiry_idx").on(t.item_id, t.expiry_date),
}));

// ── doc_sequences ─────────────────────────────────────────────────────────────
export const doc_sequences = sqliteTable("doc_sequences", {
  doc_type: text("doc_type").notNull(),
  yymm: text("yymm").notNull(),
  last_no: integer("last_no").notNull().default(0),
}, (t) => ({
  pk: primaryKey({ columns: [t.doc_type, t.yymm] }),
}));

// ── documents ─────────────────────────────────────────────────────────────────
export const documents = sqliteTable("documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  doc_type: text("doc_type", { enum: ["OPENING", "RECEIVE", "ISSUE", "CANCEL"] }).notNull(),
  doc_no: text("doc_no").notNull().unique(),
  doc_date: text("doc_date").notNull(),
  warehouse_id: integer("warehouse_id").notNull().references(() => warehouses.id),
  status: text("status", { enum: ["DRAFT", "POSTED", "CANCELLED"] }).notNull().default("DRAFT"),
  ref_text: text("ref_text"),
  note: text("note"),
  created_by: integer("created_by"),
  posted_by: integer("posted_by"),
  posted_at: text("posted_at"),
  idempotency_key: text("idempotency_key").notNull().unique(),
});

// ── document_lines ────────────────────────────────────────────────────────────
export const document_lines = sqliteTable("document_lines", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  document_id: integer("document_id").notNull().references(() => documents.id),
  item_id: integer("item_id").notNull().references(() => items.id),
  lot_id: integer("lot_id").references(() => lots.id),
  qty_milli: integer("qty_milli").notNull(),
  unit_cost_x4: integer("unit_cost_x4").notNull().default(0),
});

// ── stock_movements ───────────────────────────────────────────────────────────
export const stock_movements = sqliteTable("stock_movements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  document_id: integer("document_id").notNull().references(() => documents.id),
  line_id: integer("line_id").references(() => document_lines.id),
  item_id: integer("item_id").notNull().references(() => items.id),
  lot_id: integer("lot_id").notNull().default(0),
  warehouse_id: integer("warehouse_id").notNull().references(() => warehouses.id),
  movement_date: text("movement_date").notNull(),
  direction: integer("direction").notNull(), // +1 or -1
  qty_milli: integer("qty_milli").notNull(),
  unit_cost_x4: integer("unit_cost_x4").notNull(),
  balance_qty_after_milli: integer("balance_qty_after_milli").notNull(),
  avg_cost_after_x4: integer("avg_cost_after_x4").notNull(),
}, (t) => ({
  idx_item_wh_date: index("movements_item_wh_date_idx").on(t.item_id, t.warehouse_id, t.movement_date),
}));

// ── stock_balances ────────────────────────────────────────────────────────────
export const stock_balances = sqliteTable("stock_balances", {
  item_id: integer("item_id").notNull().references(() => items.id),
  lot_id: integer("lot_id").notNull().default(0),
  warehouse_id: integer("warehouse_id").notNull().references(() => warehouses.id),
  qty_on_hand_milli: integer("qty_on_hand_milli").notNull().default(0),
  avg_cost_x4: integer("avg_cost_x4").notNull().default(0),
  updated_at: text("updated_at").notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.item_id, t.lot_id, t.warehouse_id] }),
}));

// ── users ─────────────────────────────────────────────────────────────────────
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  password_hash: text("password_hash").notNull(),
  role: text("role", { enum: ["OWNER", "STAFF"] }).notNull().default("STAFF"),
  is_active: integer("is_active", { mode: "boolean" }).notNull().default(true),
  failed_logins: integer("failed_logins").notNull().default(0),
  locked_until: text("locked_until"),
});

// ── sessions ──────────────────────────────────────────────────────────────────
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  user_id: integer("user_id").notNull().references(() => users.id),
  expires_at: text("expires_at").notNull(),
});

// ── audit_logs ────────────────────────────────────────────────────────────────
export const audit_logs = sqliteTable("audit_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  table_name: text("table_name").notNull(),
  record_id: text("record_id").notNull(),
  action: text("action", { enum: ["INSERT", "UPDATE", "DELETE"] }).notNull(),
  old_json: text("old_json"),
  new_json: text("new_json"),
  user_id: integer("user_id"),
  at: text("at").notNull(),
});
