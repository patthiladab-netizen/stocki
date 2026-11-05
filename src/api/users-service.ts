import { Hono } from "hono";
import { z } from "zod";
import { hashPassword } from "../domain/auth";
import { checkUserChange, type UserPatch } from "../domain/userRules";
import { withThaiMessage } from "../domain/errorMessages";

type Env = { Bindings: { DB: D1Database }; Variables: { session: { userId: number; email: string; role: string } | null } };

const usersApp = new Hono<Env>();

const createSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  role: z.enum(["OWNER", "STAFF"]),
  password: z.string().min(8).max(200),
});
const patchSchema = z.object({
  role: z.enum(["OWNER", "STAFF"]).optional(),
  is_active: z.boolean().optional(),
  password: z.string().min(8).max(200).optional(),
}).refine(p => p.role !== undefined || p.is_active !== undefined || p.password !== undefined);

const SAFE_COLS = "id, email, role, is_active, locked_until";

usersApp.use("/api/users/*", async (c, next) => {
  const s = c.get("session");
  if (!s) return c.json(withThaiMessage({ error: "unauthorized" }), 401);
  if (s.role !== "OWNER") return c.json(withThaiMessage({ error: "forbidden" }), 403);
  await next();
});
usersApp.use("/api/users", async (c, next) => {
  const s = c.get("session");
  if (!s) return c.json(withThaiMessage({ error: "unauthorized" }), 401);
  if (s.role !== "OWNER") return c.json(withThaiMessage({ error: "forbidden" }), 403);
  await next();
});

function audit(db: D1Database, id: number, action: "INSERT" | "UPDATE", oldRow: unknown, newRow: unknown, userId: number) {
  return db.prepare(
    "INSERT INTO audit_logs (table_name, record_id, action, old_json, new_json, user_id, at) VALUES ('users',?,?,?,?,?,?)",
  ).bind(String(id), action, oldRow ? JSON.stringify(oldRow) : null, JSON.stringify(newRow), userId, new Date().toISOString());
}

usersApp.get("/api/users", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT ${SAFE_COLS} FROM users ORDER BY role, email`).all();
  const users = (rows.results as Array<Record<string, unknown>>).map(r => ({
    id: r.id, email: r.email, role: r.role, is_active: !!r.is_active, locked_until: r.locked_until ?? null,
  }));
  return c.json({ users });
});

usersApp.post("/api/users", async (c) => {
  const session = c.get("session")!;
  const parsed = createSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json(withThaiMessage({ error: "invalid_input", issues: parsed.error.issues }), 400);
  const { email, role, password } = parsed.data;

  const dup = await c.env.DB.prepare("SELECT id FROM users WHERE lower(email)=?").bind(email).first();
  if (dup) return c.json(withThaiMessage({ error: "email_taken" }), 409);

  const hash = await hashPassword(password);
  const res = await c.env.DB.prepare(
    "INSERT INTO users (email, password_hash, role, is_active, failed_logins) VALUES (?,?,?,1,0)",
  ).bind(email, hash, role).run();
  const id = Number(res.meta.last_row_id);
  await audit(c.env.DB, id, "INSERT", null, { email, role, is_active: true }, session.userId).run();
  return c.json({ ok: true, user: { id, email, role, is_active: true, locked_until: null } }, 201);
});

usersApp.patch("/api/users/:id", async (c) => {
  const session = c.get("session")!;
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json(withThaiMessage({ error: "invalid_input" }), 400);
  const parsed = patchSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json(withThaiMessage({ error: "invalid_input" }), 400);
  const patch: UserPatch = parsed.data;

  const target = await c.env.DB.prepare(`SELECT ${SAFE_COLS} FROM users WHERE id=?`).bind(id).first() as
    { id: number; email: string; role: string; is_active: number; locked_until: string | null } | null;
  if (!target) return c.json(withThaiMessage({ error: "not_found" }), 404);

  const owners = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role='OWNER' AND is_active=1").first() as { n: number };
  const blocked = checkUserChange({ actorId: session.userId, target, patch, activeOwners: owners.n });
  if (blocked) return c.json(withThaiMessage({ error: blocked }), 409);

  const stmts: D1PreparedStatement[] = [];
  const next = { role: patch.role ?? target.role, is_active: patch.is_active ?? !!target.is_active };
  if (patch.role !== undefined || patch.is_active !== undefined) {
    // Guard in SQL too, so two concurrent demotions cannot remove the last owner.
    stmts.push(c.env.DB.prepare(
      `UPDATE users SET role=?, is_active=? WHERE id=?
       AND (? = 'OWNER' AND ? = 1 OR role <> 'OWNER' OR is_active = 0
            OR (SELECT COUNT(*) FROM users WHERE role='OWNER' AND is_active=1 AND id<>?) >= 1)`,
    ).bind(next.role, next.is_active ? 1 : 0, id, next.role, next.is_active ? 1 : 0, id));
  }
  if (patch.password !== undefined) {
    const hash = await hashPassword(patch.password);
    stmts.push(c.env.DB.prepare("UPDATE users SET password_hash=?, failed_logins=0, locked_until=NULL WHERE id=?").bind(hash, id));
  }
  if (patch.password !== undefined || patch.is_active === false || (patch.role && patch.role !== target.role)) {
    stmts.push(c.env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(id));
  }
  stmts.push(audit(c.env.DB, id, "UPDATE",
    { role: target.role, is_active: !!target.is_active },
    { ...next, password_reset: patch.password !== undefined }, session.userId));

  const results = await c.env.DB.batch(stmts);
  if ((patch.role !== undefined || patch.is_active !== undefined) && results[0]?.meta.changes === 0) {
    return c.json(withThaiMessage({ error: "last_owner" }), 409);
  }
  return c.json({ ok: true, user: { id, email: target.email, ...next, locked_until: patch.password ? null : target.locked_until } });
});

export default usersApp;
