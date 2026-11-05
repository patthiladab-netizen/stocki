import { useState, useRef, useEffect } from "react";
import { errorText } from "../errors";
import { fmtQty, todayBangkok, fmtDateTh } from "../format";

type LotOption = {
  id: number;
  lot_no: string;
  expiry_date: string;
  qty_on_hand_milli: number;
  is_expired: number;
};

type LineItem = {
  item_id: number;
  lot_id: number | null;
  sku: string;
  name_th: string;
  unit: string;
  qty_milli: number;
  lot_no?: string;
  expiry_date?: string;
};

type Item = { id: number; sku: string; name_th: string; barcode: string; track_lot: number; unit_id?: number };
type Unit = { id: number; name_th: string };

const input = "border rounded px-3 min-h-[44px] w-full";
const btn = "min-h-[44px] px-4 rounded whitespace-nowrap";

export default function Issue({ navigate }: { navigate: (path: string) => void }) {
  const barcodeRef = useRef<HTMLInputElement>(null);

  const [barcodeInput, setBarcodeInput] = useState("");
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [warehouses, setWarehouses] = useState<Array<{ id: number; code: string; name: string }>>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [docDate, setDocDate] = useState(todayBangkok());
  const [refText, setRefText] = useState("");
  const [lines, setLines] = useState<LineItem[]>([]);
  const [pendingItem, setPendingItem] = useState<Item | null>(null);
  const [pendingQty, setPendingQty] = useState("1");
  const [pendingLotId, setPendingLotId] = useState<number | null>(null);
  const [lotOptions, setLotOptions] = useState<LotOption[]>([]);
  const [noLotAvailable, setNoLotAvailable] = useState<number | null>(null);
  const [thaiWarning, setThaiWarning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const isFuture = docDate > todayBangkok();

  useEffect(() => {
    fetch("/api/warehouses").then(r => r.json()).then(d => {
      if (d.warehouses?.length) {
        setWarehouses(d.warehouses);
        setWarehouseId(d.warehouses[0].id);
      }
    }).catch(() => {});
    fetch("/api/units").then(r => r.json()).then(d => setUnits(d.units ?? [])).catch(() => {});
    barcodeRef.current?.focus();
  }, []);

  const unitName = (item: Item | null) => units.find(u => u.id === item?.unit_id)?.name_th ?? "";

  function detectThai(val: string) {
    setThaiWarning(/[฀-๿]/.test(val));
  }

  async function lookupBarcode(barcode: string) {
    if (!barcode.trim() || !warehouseId) return;
    const res = await fetch(`/api/items?q=${encodeURIComponent(barcode)}`);
    const r = await res.json().catch(() => ({})) as any;
    if (!res.ok) { setError(errorText(r, res.status)); return; }
    const item = (r.items ?? []).find((i: Item) => i.barcode === barcode || i.sku === barcode);
    if (!item) { setError(`ไม่พบสินค้า: ${barcode}`); return; }

    setPendingItem(item);
    setBarcodeInput("");
    setError("");
    setNotice("");

    const lr = await fetch(`/api/lots/suggest?item_id=${item.id}&warehouse_id=${warehouseId}`).then(r => r.json()).catch(() => ({}));
    if (item.track_lot) {
      const lots: LotOption[] = lr.lots ?? [];
      setLotOptions(lots);
      const firstUsable = lots.find(l => !l.is_expired);
      setPendingLotId(firstUsable ? firstUsable.id : null);
      setNoLotAvailable(null);
    } else {
      setLotOptions([]);
      setPendingLotId(null);
      setNoLotAvailable(typeof lr.no_lot_qty_milli === "number" ? lr.no_lot_qty_milli : null);
    }
  }

  /** ยอดที่ยังตัดได้ = ยอดคงเหลือ − จำนวนที่เพิ่มในรายการแล้ว (สินค้า+ล็อตเดียวกัน) */
  function availableFor(item: Item, lotId: number | null): number | null {
    const onHand = item.track_lot
      ? lotOptions.find(l => l.id === lotId)?.qty_on_hand_milli ?? null
      : noLotAvailable;
    if (onHand == null) return null;
    const used = lines
      .filter(l => l.item_id === item.id && (l.lot_id ?? 0) === (lotId ?? 0))
      .reduce((s, l) => s + l.qty_milli, 0);
    return onHand - used;
  }

  function clearPending() {
    setPendingItem(null);
    setPendingQty("1");
    setPendingLotId(null);
    setLotOptions([]);
    setNoLotAvailable(null);
    setError("");
    setTimeout(() => barcodeRef.current?.focus(), 50);
  }

  function addLine() {
    if (!pendingItem) return;
    const qty = Math.round(parseFloat(pendingQty) * 1000);
    if (isNaN(qty) || qty <= 0) { setError("จำนวนต้องมากกว่า 0"); return; }
    if (pendingItem.track_lot && pendingLotId === null) { setError("เลือกล็อตก่อน"); return; }
    const selectedLot = lotOptions.find(l => l.id === pendingLotId);
    if (selectedLot?.is_expired) { setError("ล็อตนี้หมดอายุแล้ว จ่ายไม่ได้"); return; }
    const available = availableFor(pendingItem, pendingLotId);
    if (available != null && qty > available) {
      const unit = unitName(pendingItem);
      setError(`ยอดไม่เพียงพอ: คงเหลือ ${fmtQty(Math.max(available, 0) / 1000)} ${unit} แต่ต้องการตัด ${fmtQty(qty / 1000)} ${unit}`.replace(/\s+$/, ""));
      return;
    }

    setLines(prev => [...prev, {
      item_id: pendingItem.id,
      lot_id: pendingLotId,
      sku: pendingItem.sku,
      name_th: pendingItem.name_th,
      unit: unitName(pendingItem),
      qty_milli: qty,
      lot_no: selectedLot?.lot_no,
      expiry_date: selectedLot?.expiry_date,
    }]);
    clearPending();
  }

  function cancelDoc() {
    if (lines.length > 0 && !window.confirm("ยกเลิกใบตัดนี้? รายการที่เพิ่มไว้จะหายทั้งหมด")) return;
    navigate("/");
  }

  async function save() {
    if (!warehouseId) { setError("เลือกคลังก่อน"); return; }
    if (lines.length === 0) { setError("ไม่มีรายการ"); return; }
    setSaving(true);
    setError("");
    try {
      const key = `iss-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const res = await fetch("/api/documents/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({
          idempotency_key: key,
          warehouse_id: warehouseId,
          doc_date: docDate,
          ref_text: refText || undefined,
          lines: lines.map(l => ({ item_id: l.item_id, lot_id: l.lot_id ?? 0, qty_milli: l.qty_milli, unit_cost_x4: 0 })),
        }),
      });
      const r = await res.json().catch(() => ({})) as any;
      if (!res.ok || r.ok !== true) throw new Error(errorText(r, res.status));
      if (r.draft) {
        setLines([]);
        setRefText("");
        setNotice(`บันทึกเป็นดราฟแล้ว (วันที่ล่วงหน้า) ${r.doc_no ?? ""} จะบันทึกจริงได้เมื่อถึงวันที่ในเอกสาร`);
        return;
      }
      navigate(`/documents/${r.doc_id ?? r.id}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">ตัดสินค้าออกจากคลัง</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div>
          <label htmlFor="iss-warehouse" className="block text-sm font-medium mb-1">คลัง</label>
          <select id="iss-warehouse" className={input} value={warehouseId ?? ""} onChange={e => setWarehouseId(Number(e.target.value))}>
            {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="iss-date" className="block text-sm font-medium mb-1">วันที่เอกสาร</label>
          <input id="iss-date" type="date" lang="th" className={input} value={docDate} onChange={e => setDocDate(e.target.value)} />
          <p className="text-xs text-gray-500 mt-1">วันที่: {fmtDateTh(docDate)}</p>
          {isFuture && <p className="text-xs text-amber-700 mt-1">วันที่ล่วงหน้า — จะบันทึกเป็นดราฟ ยังไม่ตัดสต็อกจนถึงวันที่ในเอกสาร</p>}
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="iss-ref" className="block text-sm font-medium mb-1">อ้างอิง</label>
          <input id="iss-ref" type="text" className={input} value={refText} onChange={e => setRefText(e.target.value)} placeholder="เช่น ใบเบิก, ชื่อแผนก" />
        </div>
      </div>

      <div className="bg-gray-50 rounded p-4 mb-4">
        <label htmlFor="iss-scan" className="block text-sm font-medium mb-1">สแกนบาร์โค้ด / รหัสสินค้า</label>
        {thaiWarning && (
          <div className="bg-yellow-100 border border-yellow-400 text-yellow-800 px-3 py-2 rounded mb-2 text-sm">
            ⚠️ แป้นพิมพ์เป็นภาษาไทย — กรุณาสลับเป็นภาษาอังกฤษก่อนสแกน (Shift+Alt หรือ Win+Space)
          </div>
        )}
        <div className="flex gap-2">
          <input
            id="iss-scan"
            ref={barcodeRef}
            type="text"
            className="border rounded px-3 min-h-[44px] flex-1 min-w-0 font-mono"
            value={barcodeInput}
            onChange={e => { setBarcodeInput(e.target.value); detectThai(e.target.value); }}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); lookupBarcode(barcodeInput); } }}
            placeholder="ยิงบาร์โค้ดแล้วกด Enter"
            autoComplete="off"
          />
          <button onClick={() => lookupBarcode(barcodeInput)} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>ค้นหา</button>
        </div>
      </div>

      {pendingItem && (
        <div className="border border-blue-300 rounded p-4 mb-4 bg-blue-50">
          <div className="font-medium mb-2 break-words">{pendingItem.sku} — {pendingItem.name_th}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="iss-qty" className="block text-sm mb-1">จำนวน</label>
              <div className="flex items-center gap-2">
                <input id="iss-qty" type="number" min="0.001" step="0.001" className={input}
                  value={pendingQty} onChange={e => setPendingQty(e.target.value)} />
                {!!unitName(pendingItem) && <span className="text-sm text-gray-600 whitespace-nowrap">{unitName(pendingItem)}</span>}
              </div>
              {(() => {
                const a = availableFor(pendingItem, pendingLotId);
                return a == null ? null : (
                  <p className={`text-xs mt-1 ${a <= 0 ? "text-red-600" : "text-gray-500"}`}>
                    ตัดได้สูงสุด {fmtQty(Math.max(a, 0) / 1000)} {unitName(pendingItem)}
                  </p>
                );
              })()}
            </div>
            {pendingItem.track_lot ? (
              <div>
                <label htmlFor="iss-lot" className="block text-sm mb-1">ล็อต (FEFO — หมดก่อนอยู่บนสุด)</label>
                {lotOptions.length === 0 ? (
                  <div className="text-red-600 text-sm">ไม่มียอดในคลัง</div>
                ) : (
                  <select id="iss-lot" className={input}
                    value={pendingLotId ?? ""}
                    onChange={e => setPendingLotId(Number(e.target.value))}>
                    {lotOptions.map(l => (
                      <option key={l.id} value={l.id} disabled={!!l.is_expired}>
                        {l.is_expired ? "⚠️ หมดอายุ " : ""}{l.lot_no} — หมด {fmtDateTh(l.expiry_date)} (คงเหลือ {fmtQty(l.qty_on_hand_milli / 1000)})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ) : null}
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={addLine} className={`${btn} bg-orange-600 text-white hover:bg-orange-700`}>เพิ่มรายการ</button>
            <button onClick={clearPending} className={`${btn} bg-gray-400 text-white hover:bg-gray-500`}>ล้างรายการ</button>
          </div>
        </div>
      )}

      {!!error && <div className="text-red-600 bg-red-50 border border-red-300 rounded px-3 py-2 mb-3" role="alert">{error}</div>}
      {!!notice && <div className="text-green-800 bg-green-50 border border-green-300 rounded px-3 py-2 mb-3" role="status">{notice} <button className="underline" onClick={() => navigate("/drafts")}>ดูดราฟ</button></div>}

      {lines.length > 0 && (
        <div className="overflow-x-auto mb-4">
          <table className="w-full border-collapse border text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="border px-2 py-1 text-left">รหัส</th>
                <th className="border px-2 py-1 text-left">ชื่อ</th>
                <th className="border px-2 py-1 text-left">Lot</th>
                <th className="border px-2 py-1 text-left">หมดอายุ</th>
                <th className="border px-2 py-1 text-right">จำนวน</th>
                <th className="border px-2 py-1"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td className="border px-2 py-1">{l.sku}</td>
                  <td className="border px-2 py-1">{l.name_th}</td>
                  <td className="border px-2 py-1">{l.lot_no ?? "-"}</td>
                  <td className="border px-2 py-1 whitespace-nowrap">{fmtDateTh(l.expiry_date)}</td>
                  <td className="border px-2 py-1 text-right whitespace-nowrap">{fmtQty(l.qty_milli / 1000)} {l.unit}</td>
                  <td className="border px-1 py-1 text-center">
                    <button onClick={() => setLines(prev => prev.filter((_, j) => j !== i))}
                      className="text-red-500 hover:text-red-700 text-sm min-h-[44px] px-2 whitespace-nowrap">ลบ</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button onClick={save} disabled={saving || lines.length === 0}
          className={`${btn} px-6 bg-orange-700 text-white hover:bg-orange-800 disabled:opacity-50`}>
          {saving ? "กำลังบันทึก..." : isFuture ? "บันทึกเป็นดราฟ" : "บันทึกใบตัดออก"}
        </button>
        <button onClick={cancelDoc} className={`${btn} border hover:bg-gray-50`}>ยกเลิกใบตัด</button>
      </div>
    </div>
  );
}
