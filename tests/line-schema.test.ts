import { describe, it, expect } from "vitest";
import { issueLineSchema, receiveLineSchema } from "../src/api/documents-service";

describe("document line schemas accept non-lot items", () => {
  it("issue: lot_id null → 0", () => {
    const r = issueLineSchema.safeParse({ item_id: 1, lot_id: null, qty_milli: 1000 });
    expect(r.success).toBe(true);
    expect(r.success && r.data.lot_id).toBe(0);
  });
  it("issue: lot_id missing → 0", () => {
    const r = issueLineSchema.safeParse({ item_id: 1, qty_milli: 1000 });
    expect(r.success && r.data.lot_id).toBe(0);
  });
  it("issue: real lot id kept", () => {
    const r = issueLineSchema.safeParse({ item_id: 1, lot_id: 7, qty_milli: 1000 });
    expect(r.success && r.data.lot_id).toBe(7);
  });
  it("receive: lot_id null accepted", () => {
    const r = receiveLineSchema.safeParse({ item_id: 1, lot_id: null, qty_milli: 1000, unit_cost_x4: 1000000 });
    expect(r.success).toBe(true);
  });
  it("issue: negative lot id rejected", () => {
    expect(issueLineSchema.safeParse({ item_id: 1, lot_id: -1, qty_milli: 1000 }).success).toBe(false);
  });
});
