const BANGKOK_OFFSET_MS = 7 * 3600e3;

/** วันที่วันนี้ตามเวลาไทย (YYYY-MM-DD) */
export function bangkokToday(now: number = Date.now()): string {
  return new Date(now + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
}

/** วันที่เอกสารอยู่ในอนาคต (เทียบกับวันนี้ตามเวลาไทย) → ต้องเก็บเป็นดราฟ */
export function isFutureDocDate(doc_date: string, now: number = Date.now()): boolean {
  return doc_date > bangkokToday(now);
}
