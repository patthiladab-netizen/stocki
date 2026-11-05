import { useEffect, useState } from "react";
import { useStore } from "../store";
import { errorText } from "../errors";
import { fmtMoney, fmtQty, roundTo, fmtDateTh } from "../format";

type ReportType = "balance" | "movements" | "card" | "lots" | "expiring" | "reorder";

type ItemOption = { id: number; sku: string; name_th: string; barcode?: string | null };

/** แถวบัตรคุมสินค้า: แยก qty เป็นรับเข้า/ตัดออกตาม direction */
function cardRow(r: Record<string, any>): Record<string, any> {
  const qty = r.qty_milli ?? 0;
  const out: Record<string, any> = {
    doc_date: r.doc_date,
    doc_no: r.doc_no,
    doc_type: r.doc_type,
    warehouse: r.warehouse,
    lot_no: r.lot_no,
    in_milli: r.direction === 1 ? qty : null,
    out_milli: r.direction === -1 ? qty : null,
    balance_qty_after_milli: r.balance_qty_after_milli,
  };
  if ("unit_cost_x4" in r) out.unit_cost_x4 = r.unit_cost_x4;
  if ("avg_cost_after_x4" in r) out.avg_cost_after_x4 = r.avg_cost_after_x4;
  return out;
}

function transformRow(row: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k.endsWith("_milli")) out[k.replace(/_milli$/, "")] = v == null ? v : (v as number) / 1000;
    else if (k.endsWith("_x4")) out[k.replace(/_x4$/, "")] = v == null ? v : (v as number) / 10000;
    else out[k] = v;
  }
  return out;
}

const COL_LABELS: Record<string, string> = {
  sku: "รหัส",
  name_th: "ชื่อสินค้า",
  category: "หมวด",
  warehouse: "คลัง",
  unit: "หน่วย",
  lot_no: "Lot No.",
  expiry_date: "วันหมดอายุ",
  mfg_date: "วันผลิต",
  po_no: "เลขที่ PO",
  manufacturer_name: "โรงงาน",
  qty_on_hand: "คงเหลือ",
  total_qty: "คงเหลือ",
  avg_cost: "ต้นทุนเฉลี่ย",
  total_value: "มูลค่ารวม",
  doc_type: "ประเภท",
  doc_date: "วันที่",
  in: "รับเข้า",
  out: "ตัดออก",
  value: "มูลค่า",
  reorder_point: "จุดสั่งซื้อ",
  days_left: "เหลือ (วัน)",
  doc_no: "เลขที่เอกสาร",
  balance_qty_after: "คงเหลือหลังรายการ",
  unit_cost: "ต้นทุน/หน่วย",
  avg_cost_after: "ต้นทุนเฉลี่ยหลังรายการ",
};

const MONEY_KEYS = new Set(["avg_cost", "total_value", "value", "unit_cost", "standard_cost", "avg_cost_after"]);
const QTY_KEYS = new Set(["qty_on_hand", "total_qty", "in", "out", "reorder_point", "qty", "balance_qty_after"]);
const DATE_KEYS = new Set(["doc_date", "expiry_date", "mfg_date"]);
const HIDDEN_KEYS = new Set(["item_id", "id", "lot_id", "warehouse_id"]);
const DOC_TYPE_TH: Record<string, string> = { OPENING: "ยอดยกมา", RECEIVE: "รับเข้า", ISSUE: "ตัดออก", CANCEL: "ยกเลิก" };

function orderCols(keys: string[]): string[] {
  const visible = keys.filter((k) => !HIDDEN_KEYS.has(k));
  const first = ["name_th", "qty_on_hand", "total_qty"].filter((k) => visible.includes(k));
  return [...first, ...visible.filter((k) => !first.includes(k))];
}

export default function Reports() {
  const { user } = useStore();
  const [active, setActive] = useState<ReportType>("balance");
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [expiringDays, setExpiringDays] = useState(30);
  const [unitDecimals, setUnitDecimals] = useState<Map<string, number>>(new Map());
  const [cardQuery, setCardQuery] = useState("");
  const [cardOptions, setCardOptions] = useState<ItemOption[]>([]);
  const [cardItem, setCardItem] = useState<ItemOption | null>(null);
  const [cardSearching, setCardSearching] = useState(false);

  const isOwner = user?.role === "OWNER";

  async function searchCardItems() {
    setCardSearching(true);
    setError("");
    const q = cardQuery.trim();
    const res = await fetch(`/api/items${q ? `?q=${encodeURIComponent(q)}` : ""}`, { credentials: "include" });
    const json = await res.json().catch(() => ({})) as any;
    if (!res.ok) setError(errorText(json, res.status));
    const list: ItemOption[] = json.items ?? (Array.isArray(json) ? json : []);
    setCardOptions(list);
    setCardSearching(false);
    if (list.length === 1) loadCard(list[0]);
  }

  async function loadCard(item: ItemOption) {
    setCardItem(item);
    setLoading(true);
    setError("");
    const res = await fetch(`/api/reports/card/${item.id}`, { credentials: "include" });
    const json = await res.json().catch(() => ({})) as any;
    if (!res.ok) setError(errorText(json, res.status));
    setData((json.data ?? []).map(cardRow));
    setLoading(false);
  }

  async function load(type: ReportType, opts?: { days?: number }) {
    setActive(type);
    setError("");
    if (type === "card") {
      if (cardItem) await loadCard(cardItem);
      else setData([]);
      return;
    }
    setLoading(true);
    let url = `/api/reports/${type}`;
    const params = new URLSearchParams();
    if (type === "movements") {
      if (dateStart) params.set("date_start", dateStart);
      if (dateEnd) params.set("date_end", dateEnd);
    }
    if (type === "expiring") params.set("days", String(opts?.days ?? expiringDays));
    if ([...params].length) url += "?" + params.toString();
    const res = await fetch(url, { credentials: "include" });
    const json = await res.json().catch(() => ({})) as any;
    if (!res.ok) setError(errorText(json, res.status));
    setData(json.data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load("balance");
    fetch("/api/units").then(r => r.json()).then(d => {
      const m = new Map<string, number>();
      for (const u of d.units ?? []) if (u.decimal_places != null) { m.set(u.name_th, u.decimal_places); m.set(u.code, u.decimal_places); }
      setUnitDecimals(m);
    }).catch(() => {});
  }, []);

  const rows = data.map(transformRow);
  const colKeys = rows.length > 0 ? orderCols(Object.keys(rows[0])) : [];

  function decimalsFor(row: Record<string, any>) {
    return unitDecimals.get(row.unit) ?? 3;
  }

  function displayValue(row: Record<string, any>, k: string): string {
    const v = row[k];
    if (v == null || v === "") return "-";
    if (MONEY_KEYS.has(k)) return fmtMoney(Number(v));
    if (QTY_KEYS.has(k)) return fmtQty(Number(v), decimalsFor(row));
    if (k === "doc_type") return DOC_TYPE_TH[v] ?? String(v);
    if (DATE_KEYS.has(k)) return fmtDateTh(String(v));
    return String(v);
  }

  function exportValue(row: Record<string, any>, k: string): string | number {
    const v = row[k];
    if (v == null) return "";
    if (MONEY_KEYS.has(k)) return roundTo(Number(v), 2);
    if (QTY_KEYS.has(k)) return roundTo(Number(v), decimalsFor(row));
    if (k === "doc_type") return DOC_TYPE_TH[v] ?? v;
    if (DATE_KEYS.has(k)) return fmtDateTh(String(v));
    return v;
  }

  async function exportExcel() {
    const { utils, writeFile } = await import("xlsx");
    const wsData = [
      ["ลำดับ", ...colKeys.map((k) => COL_LABELS[k] ?? k)],
      ...rows.map((row, i) => [i + 1, ...colKeys.map((k) => exportValue(row, k))]),
    ];
    const ws = utils.aoa_to_sheet(wsData);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "รายงาน");
    const suffix = active === "card" && cardItem ? `-${cardItem.sku}` : "";
    writeFile(wb, `stocki-${active}${suffix}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  const tabs: { key: ReportType; label: string }[] = [
    { key: "balance", label: "ยอดคงเหลือ" },
    { key: "movements", label: "รับ-จ่าย" },
    { key: "card", label: "บัตรคุมสินค้า" },
    { key: "lots", label: "แยกล็อต" },
    { key: "expiring", label: "ใกล้หมดอายุ" },
    { key: "reorder", label: "ต่ำกว่าจุดสั่ง" },
  ];

  const tabBtn = "min-h-[44px] px-3 rounded text-sm whitespace-nowrap";

  return (
    <div className="p-4 max-w-full">
      <h1 className="text-xl font-bold mb-4">รายงาน</h1>

      <div className="flex gap-2 mb-4 flex-wrap" role="tablist">
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={active === t.key} onClick={() => load(t.key)}
            className={`${tabBtn} ${active === t.key ? "bg-blue-600 text-white" : "bg-gray-100"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {active === "movements" && (
        <div className="flex gap-2 mb-3 flex-wrap items-end">
          <div>
            <label htmlFor="rpt-from" className="block text-xs text-gray-500 mb-1">ตั้งแต่</label>
            <input id="rpt-from" type="date" lang="th" value={dateStart} onChange={(e) => setDateStart(e.target.value)} className="border rounded px-2 min-h-[44px] text-sm" />
          </div>
          <div>
            <label htmlFor="rpt-to" className="block text-xs text-gray-500 mb-1">ถึง</label>
            <input id="rpt-to" type="date" lang="th" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="border rounded px-2 min-h-[44px] text-sm" />
          </div>
          <button onClick={() => load("movements")} className={`${tabBtn} bg-blue-500 text-white`}>กรอง</button>
        </div>
      )}
      {active === "card" && (
        <div className="mb-3">
          <form className="flex gap-2 flex-wrap items-end" onSubmit={(e) => { e.preventDefault(); searchCardItems(); }}>
            <div className="flex-1 min-w-[12rem]">
              <label htmlFor="card-q" className="block text-xs text-gray-500 mb-1">ค้นสินค้า (ชื่อ รหัส หรือบาร์โค้ด)</label>
              <input id="card-q" value={cardQuery} onChange={(e) => setCardQuery(e.target.value)}
                placeholder="เช่น PUMP-001 หรือ ยิงบาร์โค้ด" className="border rounded px-2 min-h-[44px] text-sm w-full" />
            </div>
            <button type="submit" disabled={cardSearching} className={`${tabBtn} bg-blue-500 text-white disabled:opacity-50`}>ค้นหา</button>
          </form>
          {cardOptions.length > 1 && (
            <ul className="mt-2 border rounded bg-white divide-y max-h-60 overflow-auto" aria-label="ผลการค้นหาสินค้า">
              {cardOptions.map((it) => (
                <li key={it.id}>
                  <button type="button" onClick={() => loadCard(it)}
                    className={`w-full text-left px-3 min-h-[44px] text-sm hover:bg-blue-50 ${cardItem?.id === it.id ? "bg-blue-50 font-semibold" : ""}`}>
                    <span className="font-mono text-xs text-gray-500 mr-2">{it.sku}</span>{it.name_th}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {cardItem && (
            <p className="mt-2 text-sm">สินค้า: <strong>{cardItem.sku} {cardItem.name_th}</strong></p>
          )}
          {!cardItem && <p className="mt-2 text-sm text-gray-500">ค้นและเลือกสินค้าเพื่อดูประวัติรับ-จ่าย</p>}
        </div>
      )}
      {active === "expiring" && (
        <div className="flex gap-2 mb-3 items-center flex-wrap">
          <span className="text-sm">ภายใน</span>
          {[30, 60, 90].map((d) => (
            <button key={d} onClick={() => { setExpiringDays(d); load("expiring", { days: d }); }}
              className={`${tabBtn} ${expiringDays === d ? "bg-orange-500 text-white" : "bg-gray-100"}`}>
              {d} วัน
            </button>
          ))}
        </div>
      )}

      {isOwner && rows.length > 0 && (
        <button onClick={exportExcel} className={`${tabBtn} mb-3 bg-green-600 text-white`}>ส่งออก Excel</button>
      )}

      {!!error && <p className="text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 mb-3 text-sm">{error}</p>}

      {loading ? (
        <p className="text-gray-500 text-sm">กำลังโหลด…</p>
      ) : rows.length === 0 ? (
        <p className="text-gray-400 text-sm">ไม่มีข้อมูล</p>
      ) : (
        <div className="overflow-auto max-h-[70vh] border rounded bg-white">
          <table className="text-sm border-collapse min-w-full">
            <thead className="sticky top-0 z-20">
              <tr className="bg-gray-100">
                <th className="border px-2 py-2 text-right whitespace-nowrap">#</th>
                {colKeys.map((k, j) => (
                  <th key={k}
                    className={`border px-2 py-2 whitespace-nowrap bg-gray-100 ${MONEY_KEYS.has(k) || QTY_KEYS.has(k) ? "text-right" : "text-left"} ${j === 0 ? "sticky left-0 z-30" : ""}`}>
                    {COL_LABELS[k] ?? k}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="border px-2 py-1 text-right text-gray-400">{i + 1}</td>
                  {colKeys.map((k, j) => (
                    <td key={k}
                      className={`border px-2 py-1 ${MONEY_KEYS.has(k) || QTY_KEYS.has(k) ? "text-right whitespace-nowrap tabular-nums" : ""} ${j === 0 ? "sticky left-0 z-10 bg-white min-w-[9rem] max-w-[12rem]" : "whitespace-nowrap"}`}>
                      {displayValue(row, k)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
