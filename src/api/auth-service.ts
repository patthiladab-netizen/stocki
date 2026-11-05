import type { Database } from "better-sqlite3";
import { verifyPassword, checkLockout, generateSessionId } from "../domain/auth";

const LOCK_MINUTES = 15;
const MAX_FAILURES = 10;
const SESSION_HOURS = 8;

type LoginOk = { ok: true; user: { id: number; email: string; role: string }; sessionId: string };
type LoginFail = { ok: false; reason: "invalid_credentials" | "locked" | "inactive" };

export function createAuthService(db: Database) {
  return {
    async login(email: string, password: string): Promise<LoginOk | LoginFail> {
      const user = db.prepare(
        "SELECT id, email, password_hash, role, is_active, failed_logins, locked_until FROM users WHERE email = ?",
      ).get(email) as any;

      if (!user) return { ok: false, reason: "invalid_credentials" };
      if (!user.is_active) return { ok: false, reason: "inactive" };

      // ตรวจล็อค
      if (checkLockout(user.failed_logins, user.locked_until)) {
        return { ok: false, reason: "locked" };
      }

      const valid = await verifyPassword(password, user.password_hash);

      if (!valid) {
        const newFails = user.failed_logins + 1;
        if (newFails >= MAX_FAILURES) {
          const lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString();
          db.prepare("UPDATE users SET failed_logins=?, locked_until=? WHERE id=?")
            .run(newFails, lockedUntil, user.id);
        } else {
          db.prepare("UPDATE users SET failed_logins=? WHERE id=?").run(newFails, user.id);
        }
        // ถ้าเพิ่ง lock ครบ 10 ให้ return locked
        if (newFails >= MAX_FAILURES) {
          return { ok: false, reason: "locked" };
        }
        return { ok: false, reason: "invalid_credentials" };
      }

      // reset
      db.prepare("UPDATE users SET failed_logins=0, locked_until=NULL WHERE id=?").run(user.id);

      const sessionId = generateSessionId();
      const expiresAt = new Date(Date.now() + SESSION_HOURS * 3_600_000).toISOString();
      db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)").run(sessionId, user.id, expiresAt);

      return { ok: true, user: { id: user.id, email: user.email, role: user.role }, sessionId };
    },

    logout(sessionId: string) {
      db.prepare("DELETE FROM sessions WHERE id=?").run(sessionId);
    },

    getSession(sessionId: string) {
      const row = db.prepare(
        "SELECT s.id, s.expires_at, u.id as user_id, u.email, u.role, u.is_active FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=?",
      ).get(sessionId) as any;
      if (!row) return null;
      if (new Date(row.expires_at).getTime() < Date.now()) {
        db.prepare("DELETE FROM sessions WHERE id=?").run(sessionId);
        return null;
      }
      return { userId: row.user_id, email: row.email, role: row.role };
    },
  };
}
