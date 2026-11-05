export const ERROR_MESSAGES_TH: Record<string, string> = {
  unauthorized: "กรุณาเข้าสู่ระบบ",
  forbidden: "คุณไม่มีสิทธิ์ทำรายการนี้",
  not_found: "ไม่พบข้อมูล",
  invalid_input: "ข้อมูลไม่ถูกต้อง",
  invalid_json: "รูปแบบข้อมูลไม่ถูกต้อง",
  missing_params: "ข้อมูลไม่ครบ",
  missing_fields: "กรอกข้อมูลไม่ครบ",
  invalid_credentials: "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
  account_locked: "บัญชีถูกล็อกชั่วคราว 15 นาที เพราะใส่รหัสผ่านผิดหลายครั้ง",
  already_initialized: "ตั้งค่าระบบไปแล้ว",
  invalid_secret: "APP_SECRET ไม่ถูกต้อง",
  barcode_duplicate: "บาร์โค้ดนี้มีสินค้าอื่นใช้อยู่แล้ว",
  invalid_date: "วันที่เอกสารไม่ถูกต้อง",
  insufficient_stock: "ยอดคงเหลือไม่พอจ่าย",
  lot_expired: "ล็อตนี้หมดอายุแล้ว จ่ายไม่ได้",
  validation_failed: "ข้อมูลบางรายการไม่ถูกต้อง",
  not_draft: "แก้ไขได้เฉพาะเอกสารดราฟ",
  cannot_cancel: "ยกเลิกได้เฉพาะเอกสารที่บันทึกแล้ว",
  cannot_cancel_cancel: "ยกเลิกเอกสารยกเลิกไม่ได้",
  confirm_required: "ต้องพิมพ์คำยืนยัน RESET ก่อนล้างข้อมูล",
  email_taken: "อีเมลนี้มีผู้ใช้อยู่แล้ว",
  cannot_change_self: "ปิดใช้งานหรือลดสิทธิ์บัญชีของตัวเองไม่ได้",
  last_owner: "ต้องมีเจ้าของที่ใช้งานอยู่อย่างน้อย 1 คน",
  account_disabled: "บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อเจ้าของร้าน",
  internal_error: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่",
};

const THAI_CHARS = /[฀-๿]/;

/** เติม message ภาษาไทยให้ body ที่มี error แต่ยังไม่มี message */
export function withThaiMessage<T extends Record<string, unknown>>(body: T): T & { message?: string } {
  if (typeof body.error !== "string" || typeof body.message === "string") return body;
  const code = body.error;
  const message = ERROR_MESSAGES_TH[code]
    ?? ERROR_MESSAGES_TH[code.toLowerCase()]
    ?? (THAI_CHARS.test(code) ? code : ERROR_MESSAGES_TH.internal_error);
  return { ...body, message };
}
