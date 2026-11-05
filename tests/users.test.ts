import { describe, it, expect } from "vitest";
import { checkUserChange } from "../src/domain/userRules";
import { ERROR_MESSAGES_TH } from "../src/domain/errorMessages";
import app from "../src/api/index";

const owner = { id: 1, role: "OWNER", is_active: 1 };
const staff = { id: 2, role: "STAFF", is_active: 1 };

describe("checkUserChange", () => {
  it("allows promoting staff", () =>
    expect(checkUserChange({ actorId: 1, target: staff, patch: { role: "OWNER" }, activeOwners: 1 })).toBeNull());
  it("allows deactivating staff", () =>
    expect(checkUserChange({ actorId: 1, target: staff, patch: { is_active: false }, activeOwners: 1 })).toBeNull());
  it("blocks deactivating yourself", () =>
    expect(checkUserChange({ actorId: 1, target: owner, patch: { is_active: false }, activeOwners: 2 })).toBe("cannot_change_self"));
  it("blocks demoting yourself", () =>
    expect(checkUserChange({ actorId: 1, target: owner, patch: { role: "STAFF" }, activeOwners: 2 })).toBe("cannot_change_self"));
  it("allows resetting your own password", () =>
    expect(checkUserChange({ actorId: 1, target: owner, patch: { password: "longenough" }, activeOwners: 1 })).toBeNull());
  it("blocks removing the last active owner", () => {
    const other = { id: 3, role: "OWNER", is_active: 1 };
    expect(checkUserChange({ actorId: 1, target: other, patch: { role: "STAFF" }, activeOwners: 1 })).toBe("last_owner");
    expect(checkUserChange({ actorId: 1, target: other, patch: { is_active: false }, activeOwners: 1 })).toBe("last_owner");
  });
  it("allows demoting an owner when another remains", () =>
    expect(checkUserChange({ actorId: 1, target: { id: 3, role: "OWNER", is_active: 1 }, patch: { role: "STAFF" }, activeOwners: 2 })).toBeNull());
  it("error codes have Thai messages", () => {
    for (const code of ["cannot_change_self", "last_owner", "email_taken", "account_disabled"]) {
      expect(ERROR_MESSAGES_TH[code]).toMatch(/[฀-๿]/);
    }
  });
});

function fakeDb(role: "OWNER" | "STAFF") {
  return {
    prepare(sql: string) {
      const stmt = {
        bind: () => stmt,
        first: async () =>
          sql.includes("FROM sessions")
            ? { id: "s1", expires_at: new Date(Date.now() + 3600e3).toISOString(), user_id: 9, email: "x@x", role, is_active: 1 }
            : null,
        run: async () => ({ meta: { changes: 0 } }),
        all: async () => ({ results: [{ id: 9, email: "x@x", role, is_active: 1, locked_until: null, password_hash: "SECRET" }] }),
      };
      return stmt;
    },
    batch: async () => [],
  };
}

async function call(role: "OWNER" | "STAFF", method: string, path: string, body?: unknown) {
  const res = await app.request(
    path,
    { method, headers: { "Content-Type": "application/json", Cookie: "session=s1" }, body: body ? JSON.stringify(body) : undefined },
    { DB: fakeDb(role), ADMIN_EMAIL: "x@x", APP_SECRET: "s" },
  );
  return { res, json: (await res.json()) as Record<string, unknown> };
}

describe("/api/users access", () => {
  it("STAFF gets 403 on list", async () => {
    const { res, json } = await call("STAFF", "GET", "/api/users");
    expect(res.status).toBe(403);
    expect(json.message).toMatch(/[฀-๿]/);
  });
  it("STAFF gets 403 on create", async () => {
    const { res } = await call("STAFF", "POST", "/api/users", { email: "a@b.co", role: "STAFF", password: "12345678" });
    expect(res.status).toBe(403);
  });
  it("OWNER list never contains password_hash", async () => {
    const { res, json } = await call("OWNER", "GET", "/api/users");
    expect(res.status).toBe(200);
    expect(JSON.stringify(json)).not.toContain("SECRET");
    expect(JSON.stringify(json)).not.toContain("password_hash");
  });
  it("rejects short password", async () => {
    const { res } = await call("OWNER", "POST", "/api/users", { email: "a@b.co", role: "STAFF", password: "123" });
    expect(res.status).toBe(400);
  });
});
