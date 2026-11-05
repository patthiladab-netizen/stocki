const moneyFmt = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function fmtMoney(v: number | null | undefined): string {
  return v == null ? "-" : moneyFmt.format(v);
}

export function fmtQty(v: number | null | undefined, decimals = 3): string {
  if (v == null) return "-";
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: decimals }).format(v);
}

export function roundTo(v: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

export function todayBangkok(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
}

/** "2026-11-03" → "03/11/2569" (วว/ดด/ปปปป พ.ศ.) */
export function fmtDateTh(iso: string | null | undefined): string {
  if (!iso) return "-";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${Number(m[1]) + 543}`;
}
