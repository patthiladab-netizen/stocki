import { describe, it, expect } from "vitest";
import { bangkokToday, isFutureDocDate } from "../src/domain/docDate";
import { withThaiMessage, ERROR_MESSAGES_TH } from "../src/domain/errorMessages";
import { classifyExistingDoc, extractDbErrorCode } from "../src/domain/documentEngine";

describe("bangkokToday", () => {
  it("UTC 2026-11-02T16:59Z = 23:59 Bangkok → 2026-11-02", () => {
    expect(bangkokToday(Date.parse("2026-11-02T16:59:00Z"))).toBe("2026-11-02");
  });
  it("UTC 2026-11-02T17:00Z = 00:00 Bangkok next day → 2026-11-03", () => {
    expect(bangkokToday(Date.parse("2026-11-02T17:00:00Z"))).toBe("2026-11-03");
  });
});

describe("isFutureDocDate", () => {
  const now = Date.parse("2026-11-02T05:00:00Z"); // 12:00 Bangkok, 2 Nov
  it("today is not future", () => expect(isFutureDocDate("2026-11-02", now)).toBe(false));
  it("yesterday is not future", () => expect(isFutureDocDate("2026-11-01", now)).toBe(false));
  it("tomorrow is future", () => expect(isFutureDocDate("2026-11-03", now)).toBe(true));
  it("Bangkok rolls over before UTC does", () => {
    // 23:30 UTC 2 Nov = 06:30 Bangkok 3 Nov → 3 Nov is today, not future
    expect(isFutureDocDate("2026-11-03", Date.parse("2026-11-02T23:30:00Z"))).toBe(false);
  });
});

describe("withThaiMessage", () => {
  it("adds Thai message for known codes", () => {
    for (const code of ["unauthorized", "forbidden", "not_found", "invalid_input", "barcode_duplicate", "invalid_date", "insufficient_stock", "lot_expired", "not_draft"]) {
      const out = withThaiMessage({ error: code });
      expect(out.error).toBe(code);
      expect(out.message).toBe(ERROR_MESSAGES_TH[code]);
      expect(out.message).toMatch(/[฀-๿]/);
    }
  });
  it("keeps an existing message", () => {
    expect(withThaiMessage({ error: "invalid_date", message: "ยังไม่ถึงวันที่ในเอกสาร" }).message).toBe("ยังไม่ถึงวันที่ในเอกสาร");
  });
  it("uses the error itself when it is already Thai", () => {
    expect(withThaiMessage({ error: "รหัสสินค้าซ้ำ" }).message).toBe("รหัสสินค้าซ้ำ");
  });
  it("falls back to a generic Thai message for unknown codes", () => {
    expect(withThaiMessage({ error: "weird_code" }).message).toMatch(/[฀-๿]/);
  });
  it("leaves non-error bodies untouched", () => {
    expect(withThaiMessage({ ok: true })).toEqual({ ok: true });
  });
});

describe("classifyExistingDoc (idempotency)", () => {
  it("no doc → new", () => expect(classifyExistingDoc(null)).toBe("new"));
  it("POSTED → posted", () => expect(classifyExistingDoc({ status: "POSTED", line_count: 2 })).toBe("posted"));
  it("DRAFT with lines → intentional draft (return it, never delete)", () =>
    expect(classifyExistingDoc({ status: "DRAFT", line_count: 1 })).toBe("draft"));
  it("DRAFT without lines → stale leftover from a failed post (safe to delete)", () =>
    expect(classifyExistingDoc({ status: "DRAFT", line_count: 0 })).toBe("stale"));
  it("CANCELLED → posted (already final)", () => expect(classifyExistingDoc({ status: "CANCELLED", line_count: 1 })).toBe("posted"));
});

describe("extractDbErrorCode", () => {
  it("detects the no-negative-stock trigger", () =>
    expect(extractDbErrorCode(new Error("D1_ERROR: insufficient_stock: SQLITE_CONSTRAINT"))).toBe("insufficient_stock"));
  it("detects barcode unique violation", () =>
    expect(extractDbErrorCode(new Error("UNIQUE constraint failed: items.barcode: SQLITE_CONSTRAINT"))).toBe("barcode_duplicate"));
  it("unknown errors → null", () => expect(extractDbErrorCode(new Error("boom"))).toBeNull());
});
