const ERR_TH: Record<string, string> = {
  barcode_duplicate: "บาร์โค้ดนี้มีสินค้าอื่นใช้อยู่แล้ว",
  sku_duplicate: "รหัสสินค้านี้มีอยู่แล้ว",
  unauthorized: "กรุณาเข้าสู่ระบบใหม่",
  Unauthorized: "กรุณาเข้าสู่ระบบใหม่",
  forbidden: "คุณไม่มีสิทธิ์ทำรายการนี้",
  not_found: "ไม่พบข้อมูล",
  invalid_input: "ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง",
  invalid_json: "ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง",
  invalid_date: "วันที่เอกสารไม่ถูกต้อง",
  validation_failed: "ข้อมูลไม่ผ่านการตรวจสอบ",
  insufficient_stock: "ยอดคงเหลือไม่พอจ่าย",
  insufficient_qty: "ยอดคงเหลือไม่พอจ่าย",
  lot_expired: "ล็อตนี้หมดอายุแล้ว จ่ายไม่ได้",
  expired_lot: "ล็อตนี้หมดอายุแล้ว จ่ายไม่ได้",
  lot_required: "สินค้านี้ใช้ล็อต กรุณาเลือกล็อต",
  draft_not_due: "ยังไม่ถึงวันที่ในเอกสาร บันทึกจริงไม่ได้",
  not_draft: "เอกสารนี้ไม่ใช่ดราฟ",
  already_posted: "เอกสารนี้บันทึกไปแล้ว",
  already_cancelled: "เอกสารนี้ถูกยกเลิกไปแล้ว",
  account_locked: "บัญชีถูกล็อก 15 นาที เนื่องจากล็อกอินผิดหลายครั้ง",
  invalid_credentials: "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
  invalid_secret: "APP_SECRET ไม่ถูกต้อง",
  email_taken: "อีเมลนี้มีผู้ใช้อยู่แล้ว",
  cannot_change_self: "ปิดใช้งานหรือลดสิทธิ์บัญชีของตัวเองไม่ได้",
  last_owner: "ต้องมีเจ้าของที่ใช้งานอยู่อย่างน้อย 1 คน",
  account_disabled: "บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อเจ้าของร้าน",
};

const THAI = /[฀-๿]/;

function fromValue(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  if (ERR_TH[v]) return ERR_TH[v];
  if (THAI.test(v)) return v;
  return null;
}

export function errorText(json: any, status?: number): string {
  const msg = fromValue(json?.message) ?? fromValue(json?.error);
  if (msg) return msg;
  if (Array.isArray(json?.errors) && json.errors.length) {
    const parts = json.errors.map((e: any) =>
      typeof e === "string"
        ? fromValue(e) ?? e
        : e?.rowNum
          ? `แถว ${e.rowNum}: ${(e.errors ?? []).join(", ")}`
          : fromValue(e?.message) ?? fromValue(e?.error) ?? "",
    ).filter(Boolean);
    if (parts.length) return parts.join(", ");
  }
  return `เกิดข้อผิดพลาด${status ? ` (HTTP ${status})` : ""}`;
}
