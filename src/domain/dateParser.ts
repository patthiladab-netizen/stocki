/**
 * แปลงวันที่จากรูปแบบต่างๆ เป็น ISO date string (YYYY-MM-DD)
 * รองรับ:
 * - วว/ดด/ปปปป พ.ศ. (เช่น 31/10/2568)
 * - วว/ดด/ปปปป ค.ศ. (เช่น 31/10/2026)
 * - ตัวเลข Excel serial (เช่น 45965)
 */
export function parseThaiDate(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined || raw === "") return null;

  // Excel serial number
  if (typeof raw === "number" || /^\d{4,5}$/.test(String(raw).trim())) {
    const serial = typeof raw === "number" ? raw : parseInt(String(raw).trim(), 10);
    // Excel epoch: 1899-12-30
    const date = new Date((serial - 25569) * 86400 * 1000);
    if (isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 10);
  }

  const s = String(raw).trim();

  // วว/ดด/ปปปป
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    let [, dd, mm, yyyy] = m.map(Number);
    // ถ้าปี >= 2500 ถือว่าเป็น พ.ศ. → ลบ 543
    if (yyyy >= 2500) yyyy -= 543;
    if (yyyy < 1900 || yyyy > 2200) return null;
    const d = new Date(Date.UTC(yyyy, mm - 1, dd));
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  return null;
}
