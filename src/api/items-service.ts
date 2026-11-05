import type { Database } from "better-sqlite3";

type CreateItemInput = {
  sku: string;
  name_th: string;
  barcode?: string;
  category_id?: number;
  unit_id: number;
  track_lot?: boolean;
  reorder_point_milli?: number;
  standard_cost_x4?: number;
};

type SearchOpts = { role?: string };

function stripCost<T extends Record<string, any>>(item: T): Omit<T, "standard_cost_x4"> {
  const { standard_cost_x4, ...rest } = item;
  return rest as Omit<T, "standard_cost_x4">;
}

export function createItemsService(db: Database) {
  function writeAudit(action: "INSERT" | "UPDATE" | "DELETE", recordId: number, oldData: any, newData: any, userId: number) {
    db.prepare(
      "INSERT INTO audit_logs (table_name, record_id, action, old_json, new_json, user_id, at) VALUES ('items',?,?,?,?,?,?)",
    ).run(
      String(recordId),
      action,
      oldData ? JSON.stringify(oldData) : null,
      newData ? JSON.stringify(newData) : null,
      userId,
      new Date().toISOString(),
    );
  }

  return {
    create(input: CreateItemInput, userId: number): number {
      const result = db.prepare(
        `INSERT INTO items (sku, name_th, barcode, category_id, unit_id, track_lot, reorder_point_milli, standard_cost_x4)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        input.sku,
        input.name_th,
        input.barcode ?? null,
        input.category_id ?? null,
        input.unit_id,
        input.track_lot ? 1 : 0,
        input.reorder_point_milli ?? 0,
        input.standard_cost_x4 ?? 0,
      );
      const id = Number(result.lastInsertRowid);
      writeAudit("INSERT", id, null, input, userId);
      return id;
    },

    getById(id: number) {
      return db.prepare("SELECT * FROM items WHERE id=?").get(id) as any;
    },

    search(q: string, opts: SearchOpts = {}) {
      let rows: any[];
      if (q && /^\d{8,}$/.test(q.trim())) {
        // barcode exact match
        rows = db.prepare("SELECT * FROM items WHERE barcode=? AND status='ACTIVE'").all(q.trim());
      } else if (q) {
        rows = db.prepare("SELECT * FROM items WHERE name_th LIKE ? AND status='ACTIVE'").all(`%${q}%`);
      } else {
        rows = db.prepare("SELECT * FROM items WHERE status='ACTIVE'").all();
      }
      if (opts.role === "STAFF") return rows.map(stripCost);
      return rows;
    },

    update(id: number, patch: Partial<CreateItemInput>, userId: number) {
      const old = db.prepare("SELECT * FROM items WHERE id=?").get(id) as any;
      if (!old) throw new Error("item not found");
      const merged = { ...old, ...patch };
      db.prepare(
        `UPDATE items SET sku=?, name_th=?, barcode=?, category_id=?, unit_id=?, track_lot=?, reorder_point_milli=?, standard_cost_x4=?
         WHERE id=?`,
      ).run(
        merged.sku,
        merged.name_th,
        merged.barcode ?? null,
        merged.category_id ?? null,
        merged.unit_id,
        merged.track_lot ? 1 : 0,
        merged.reorder_point_milli ?? 0,
        merged.standard_cost_x4 ?? 0,
        id,
      );
      writeAudit("UPDATE", id, old, merged, userId);
    },
  };
}
