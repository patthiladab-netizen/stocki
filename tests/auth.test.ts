import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { hashPassword, verifyPassword, checkLockout } from "../src/domain/auth";
import { createAuthService } from "../src/api/auth-service";

// ── password hashing ──────────────────────────────────────────────────────────
describe("password hashing", () => {
  it("hashPassword produces a non-empty string different from input", async () => {
    const hash = await hashPassword("secret123");
    expect(hash).toBeTruthy();
    expect(hash).not.toBe("secret123");
  });

  it("verifyPassword returns true for correct password", async () => {
    const hash = await hashPassword("correct");
    expect(await verifyPassword("correct", hash)).toBe(true);
  });

  it("verifyPassword returns false for wrong password", async () => {
    const hash = await hashPassword("correct");
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("two hashes of same password differ (unique salt)", async () => {
    const h1 = await hashPassword("same");
    const h2 = await hashPassword("same");
    expect(h1).not.toBe(h2);
  });
});

// ── lockout logic ─────────────────────────────────────────────────────────────
describe("checkLockout", () => {
  it("not locked when failed_logins < 10", () => {
    expect(checkLockout(5, null)).toBe(false);
    expect(checkLockout(9, null)).toBe(false);
  });

  it("locked when failed_logins >= 10 and locked_until in future", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(checkLockout(10, future)).toBe(true);
  });

  it("not locked when locked_until has passed", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(checkLockout(10, past)).toBe(false);
  });

  it("not locked when failed_logins >= 10 but locked_until is null", () => {
    expect(checkLockout(10, null)).toBe(false);
  });
});

// ── auth service (in-memory sqlite) ──────────────────────────────────────────
function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'STAFF',
      is_active INTEGER NOT NULL DEFAULT 1,
      failed_logins INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT
    );
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL
    );
  `);
  return db;
}

describe("AuthService.login", () => {
  let db: ReturnType<typeof makeDb>;
  let svc: ReturnType<typeof createAuthService>;

  beforeEach(async () => {
    db = makeDb();
    svc = createAuthService(db);
    const hash = await hashPassword("pass1234");
    db.prepare("INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)").run("owner@test.com", hash, "OWNER");
    db.prepare("INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)").run("staff@test.com", hash, "STAFF");
  });

  it("returns user on correct credentials", async () => {
    const result = await svc.login("owner@test.com", "pass1234");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user.role).toBe("OWNER");
  });

  it("fails on wrong password", async () => {
    const result = await svc.login("owner@test.com", "wrongpass");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_credentials");
  });

  it("fails on unknown email", async () => {
    const result = await svc.login("nobody@test.com", "pass1234");
    expect(result.ok).toBe(false);
  });

  it("increments failed_logins on wrong password", async () => {
    await svc.login("owner@test.com", "bad");
    const row = db.prepare("SELECT failed_logins FROM users WHERE email=?").get("owner@test.com") as any;
    expect(row.failed_logins).toBe(1);
  });

  it("resets failed_logins on successful login", async () => {
    // fail twice first
    await svc.login("owner@test.com", "bad");
    await svc.login("owner@test.com", "bad");
    await svc.login("owner@test.com", "pass1234");
    const row = db.prepare("SELECT failed_logins FROM users WHERE email=?").get("owner@test.com") as any;
    expect(row.failed_logins).toBe(0);
  });

  it("locks account after 10 failed attempts for 15 minutes", async () => {
    for (let i = 0; i < 10; i++) {
      await svc.login("owner@test.com", "bad");
    }
    const row = db.prepare("SELECT failed_logins, locked_until FROM users WHERE email=?").get("owner@test.com") as any;
    expect(row.failed_logins).toBe(10);
    expect(row.locked_until).toBeTruthy();
    const lockedMs = new Date(row.locked_until).getTime();
    expect(lockedMs).toBeGreaterThan(Date.now() + 14 * 60 * 1000);

    // 11th attempt returns locked
    const result = await svc.login("owner@test.com", "bad");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("locked");
  });
});
