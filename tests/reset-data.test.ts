import { describe, it, expect } from "vitest";
import app from "../src/api/index";

function fakeDb(role: "OWNER" | "STAFF" | null) {
  const batches: string[][] = [];
  const db = {
    batches,
    prepare(sql: string) {
      const stmt = {
        sql,
        bind: () => stmt,
        first: async () =>
          sql.includes("FROM sessions") && role
            ? { id: "s1", expires_at: new Date(Date.now() + 3600e3).toISOString(), user_id: 1, email: "o@x", role, is_active: 1 }
            : null,
        run: async () => ({ meta: { changes: 0, last_row_id: 0 } }),
        all: async () => ({ results: [] }),
      };
      return stmt;
    },
    batch: async (stmts: Array<{ sql: string }>) => {
      batches.push(stmts.map(s => s.sql));
      return stmts.map(() => ({ meta: { changes: 1 } }));
    },
  };
  return db;
}

async function callReset(role: "OWNER" | "STAFF" | null, body: unknown) {
  const DB = fakeDb(role);
  const res = await app.request(
    "/api/admin/reset-data",
    { method: "POST", headers: { "Content-Type": "application/json", Cookie: "session=s1" }, body: JSON.stringify(body) },
    { DB, ADMIN_EMAIL: "o@x", APP_SECRET: "x" },
  );
  return { res, json: await res.json() as Record<string, unknown>, DB };
}

describe("POST /api/admin/reset-data", () => {
  it("ไม่ได้ล็อกอิน → 401 พร้อมข้อความไทย", async () => {
    const { res, json } = await callReset(null, { confirm: "RESET" });
    expect(res.status).toBe(401);
    expect(json.error).toBe("unauthorized");
    expect(json.message).toMatch(/[฀-๿]/);
  });

  it("STAFF → 403 และไม่ลบอะไร", async () => {
    const { res, DB } = await callReset("STAFF", { confirm: "RESET" });
    expect(res.status).toBe(403);
    expect(DB.batches).toHaveLength(0);
  });

  it("OWNER ไม่ส่งคำยืนยัน → 400 และไม่ลบอะไร", async () => {
    const { res, json, DB } = await callReset("OWNER", { confirm: "reset" });
    expect(res.status).toBe(400);
    expect(json.error).toBe("confirm_required");
    expect(DB.batches).toHaveLength(0);
  });

  it("OWNER + confirm RESET → ลบใน db.batch() ครั้งเดียว และ audit action ผ่าน CHECK", async () => {
    const { res, DB } = await callReset("OWNER", { confirm: "RESET" });
    expect(res.status).toBe(200);
    expect(DB.batches).toHaveLength(1);
    const sqls = DB.batches[0];
    for (const t of ["stock_movements", "stock_balances", "document_lines", "documents", "lots", "items"]) {
      expect(sqls.some(s => s.includes(`DELETE FROM ${t}`))).toBe(true);
    }
    const audit = sqls.find(s => s.includes("INSERT INTO audit_logs"))!;
    expect(audit).toMatch(/'(INSERT|UPDATE|DELETE)'/);
    expect(audit).not.toContain("'RESET_DATA'");
  });
});
