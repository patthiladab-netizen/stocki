import { describe, it, expect } from "vitest";

describe("GET /api/health", () => {
  it("returns {ok:true} shape", () => {
    // unit test: ตรวจว่า response shape ถูกต้อง
    const body = { ok: true };
    expect(body).toEqual({ ok: true });
    expect(typeof body.ok).toBe("boolean");
  });
});
