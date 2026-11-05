import { describe, it, expect } from "vitest";
import { fmtDateTh } from "../src/web/format";

describe("fmtDateTh", () => {
  it("ISO → dd/mm/yyyy พ.ศ.", () => expect(fmtDateTh("2026-11-03")).toBe("03/11/2569"));
  it("ISO datetime uses date part", () => expect(fmtDateTh("2026-01-05T10:00:00Z")).toBe("05/01/2569"));
  it("empty → dash", () => expect(fmtDateTh(null)).toBe("-"));
  it("unknown format passes through", () => expect(fmtDateTh("abc")).toBe("abc"));
});
