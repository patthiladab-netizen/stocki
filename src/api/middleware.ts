import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";

export async function requireAuth(c: Context<any>, next: Next) {
  const sessionId = getCookie(c, "session");
  if (!sessionId) return c.json({ error: "unauthorized" }, 401);
  const session = c.get("session");
  if (!session) return c.json({ error: "unauthorized" }, 401);
  await next();
}

export async function requireOwner(c: Context<any>, next: Next) {
  const session = c.get("session");
  if (!session || session.role !== "OWNER") return c.json({ error: "forbidden" }, 403);
  await next();
}
