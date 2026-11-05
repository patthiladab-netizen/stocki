import { useState, useRef, useEffect } from "react";
import { errorText } from "../errors";
import { fmtMoney, fmtQty, todayBangkok, fmtDateTh } from "../format";

type LineItem = {
  item_id: number;
  sku: string;
  name_th: string;
  unit: string;
  qty_milli: number;
  unit_cost_x4: number;
  lot_no?: string;
  lot_mfg_date?: string;
  lot_expiry_date?: string;
  lot_po_no?: string;
  lot_manufacturer_name?: string;
};

type Item = { id: number; sku: string; name_th: string; barcode: string; track_lot: number; standard_cost_x4: number; unit_id?: number };
type Unit = { id: number; name_th: string };

const input = "border rounded px-3 min-h-[44px] w-full";
const btn = "min-h-[44px] px-4 rounded whitespace-nowrap";

export default function Receive({ navigate }: { navigate: (path: string) => void }) {
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
  const [pendingCost, setPendingCost] = useState("");
  const [pendingLotNo, setPendingLotNo] = useState("");
  const [pendingExpiry, setPendingExpiry] = useState("");
  const [pendingMfg, setPendingMfg] = useState("");
  const [pendingPO, setPendingPO] = useState("");
  const [pendingMfgName, setPendingMfgName] = useState("");
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
    if (!barcode.trim()) return;
    const res = await fetch(`/api/items?q=${encodeURIComponent(barcode)}`);
    const r = await res.json().catch(() => ({})) as any;
    if (!res.ok) { setError(errorText(r, res.status)); return; }
    const item = (r.items ?? []).find((i: Item) => i.barcode === barcode || i.sku === barcode);
    if (!item) { setError(`ไม่พบสินค้า: ${barcode}`); return; }
    setPendingItem(item);
    setPendingCost(item.standard_cost_x4 ? (item.standard_cost_x4 / 10000).toFixed(2) : "");
    setError("");
    setNotice("");
    setBarcodeInput("");
  }

  function clearPending() {
    setPendingItem(null);
    setPendingQty("1");
    setPendingCost("");
    setPendingLotNo("");
    setPendingExpiry("");
    setPendingMfg("");
    setPendingPO("");
    setPendingMfgName("");
    setError("");
    setTimeout(() => barcodeRef.current?.focus(), 50);
  }

  function addLine() {
    if (!pendingItem) return;
    const qty = Math.round(parseFloat(pendingQty) * 1000);
    const cost = Math.round(parseFloat(pendingCost) * 10000);
    if (isNaN(qty) || qty <= 0) { setError("จำนวนต้องมากกว่า 0"); return; }
    if (isNaN(cost) || cost < 0) { setError("ต้นทุนต้องไม่ติดลบ"); return; }
    const lot = !!pendingItem.track_lot;
    if (lot && (!pendingLotNo || !pendingExpiry || !pendingMfg || !pendingPO || !pendingMfgName)) {
      setError("สินค้านี้ใช้ล็อต — กรุณากรอก Lot No., วันผลิต, วันหมดอายุ, เลขที่ PO และโรงงานผู้ผลิต");
      return;
    }
    if (lot && pendingExpiry <= pendingMfg) { setError("วันหมดอายุต้องอยู่หลังวันผลิต"); return; }

    setLines(prev => [...prev, {
      item_id: pendingItem.id,
      sku: pendingItem.sku,
      name_th: pendingItem.name_th,
      unit: unitName(pendingItem),
      qty_milli: qty,
      unit_cost_x4: cost,
      lot_no: lot ? pendingLotNo : undefined,
      lot_mfg_date: lot ? pendingMfg : undefined,
      lot_expiry_date: lot ? pendingExpiry : undefined,
      lot_po_no: lot ? pendingPO : undefined,
      lot_manufacturer_name: lot ? pendingMfgName : undefined,
    }]);
    clearPending();
  }

  function cancelDoc() {
    if (lines.length > 0 && !window.confirm("ยกเลิกใบรับนี้? รายการที่เพิ่มไว้จะหายทั้งหมด")) return;
    navigate("/");
  }

  async function save() {
    if (!warehouseId) { setError("เลือกคลังก่อน"); return; }
    if (lines.length === 0) { setError("ไม่มีรายการ"); return; }
    setSaving(true);
    setError("");
    try {
      const key = `rcv-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const res = await fetch("/api/documents/receive", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({
          idempotency_key: key,
          warehouse_id: warehouseId,
          doc_date: docDate,
          ref_text: refText || undefined,
          lines: lines.map(l => ({
            item_id: l.item_id,
            qty_milli: l.qty_milli,
            unit_cost_x4: l.unit_cost_x4,
            lot_no: l.lot_no,
            lot_mfg_date: l.lot_mfg_date,
            lot_expiry_date: l.lot_expiry_date,
            lot_po_no: l.lot_po_no,
            lot_manufacturer_name: l.lot_manufacturer_name,
          })),
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
      <h1 className="text-2xl font-bold mb-4">รับสินค้าเข้าคลัง</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div>
          <label htmlFor="rcv-warehouse" className="block text-sm font-medium mb-1">คลัง</label>
          <select id="rcv-warehouse" className={input} value={warehouseId ?? ""} onChange={e => setWarehouseId(Number(e.target.value))}>
            {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="rcv-date" className="block text-sm font-medium mb-1">วันที่เอกสาร</label>
          <input id="rcv-date" type="date" lang="th" className={input} value={docDate} onChange={e => setDocDate(e.target.value)} />
          <p className="text-xs text-gray-500 mt-1">วันที่: {fmtDateTh(docDate)}</p>
          {isFuture && <p className="text-xs text-amber-700 mt-1">วันที่ล่วงหน้า — จะบันทึกเป็นดราฟ ยังไม่เพิ่มสต็อกจนถึงวันที่ในเอกสาร</p>}
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="rcv-ref" className="block text-sm font-medium mb-1">อ้างอิง (เลขที่ PO หรืออื่นๆ)</label>
          <input id="rcv-ref" type="text" className={input} value={refText} onChange={e => setRefText(e.target.value)} placeholder="เช่น PO-2611-001" />
        </div>
      </div>

      <div className="bg-gray-50 rounded p-4 mb-4">
        <label htmlFor="rcv-scan" className="block text-sm font-medium mb-1">สแกนบาร์โค้ด / รหัสสินค้า</label>
        {thaiWarning && (
          <div className="bg-yellow-100 border border-yellow-400 text-yellow-800 px-3 py-2 rounded mb-2 text-sm">
            ⚠️ แป้นพิมพ์เป็นภาษาไทย — กรุณาสลับเป็นภาษาอังกฤษก่อนสแกน (Shift+Alt หรือ Win+Space)
          </div>
        )}
        <div className="flex gap-2">
          <input
            id="rcv-scan"
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
              <label htmlFor="rcv-qty" className="block text-sm mb-1">จำนวน</label>
              <div className="flex items-center gap-2">
                <input id="rcv-qty" type="number" min="0.001" step="0.001" className={input}
                  value={pendingQty} onChange={e => setPendingQty(e.target.value)} />
                {!!unitName(pendingItem) && <span className="text-sm text-gray-600 whitespace-nowrap">{unitName(pendingItem)}</span>}
              </div>
            </div>
            <div>
              <label htmlFor="rcv-cost" className="block text-sm mb-1">ต้นทุนต่อหน่วย (บาท)</label>
              <input id="rcv-cost" type="number" min="0" step="0.0001" className={input}
                value={pendingCost} onChange={e => setPendingCost(e.target.value)} />
            </div>
            {pendingItem.track_lot ? (
              <>
                <div>
                  <label htmlFor="rcv-lot" className="block text-sm mb-1">Lot No. *</label>
                  <input id="rcv-lot" type="text" className={input} value={pendingLotNo} onChange={e => setPendingLotNo(e.target.value)} />
                </div>
                <div>
                  <label htmlFor="rcv-po" className="block text-sm mb-1">เลขที่ PO *</label>
                  <input id="rcv-po" type="text" className={input} value={pendingPO} onChange={e => setPendingPO(e.target.value)} />
                </div>
                <div>
                  <label htmlFor="rcv-mfg" className="block text-sm mb-1">วันผลิต *</label>
                  <input id="rcv-mfg" type="date" lang="th" className={input} value={pendingMfg} onChange={e => setPendingMfg(e.target.value)} />
                  {!!pendingMfg && <p className="text-xs text-gray-500 mt-1">{fmtDateTh(pendingMfg)}</p>}
                </div>
                <div>
                  <label htmlFor="rcv-exp" className="block text-sm mb-1">วันหมดอายุ *</label>
                  <input id="rcv-exp" type="date" lang="th" className={input} value={pendingExpiry} onChange={e => setPendingExpiry(e.target.value)} />
                  {!!pendingExpiry && <p className="text-xs text-gray-500 mt-1">{fmtDateTh(pendingExpiry)}</p>}
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="rcv-mfgname" className="block text-sm mb-1">โรงงานผู้ผลิต *</label>
                  <input id="rcv-mfgname" type="text" className={input} value={pendingMfgName} onChange={e => setPendingMfgName(e.target.value)} />
                </div>
              </>
            ) : null}
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={addLine} className={`${btn} bg-green-600 text-white hover:bg-green-700`}>เพิ่มรายการ</button>
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
                <th className="border px-2 py-1 text-right">จำนวน</th>
                <th className="border px-2 py-1 text-right whitespace-nowrap">ต้นทุน/หน่วย</th>
                <th className="border px-2 py-1"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td className="border px-2 py-1">{l.sku}</td>
                  <td className="border px-2 py-1">{l.name_th}</td>
                  <td className="border px-2 py-1">{l.lot_no ?? "-"}</td>
                  <td className="border px-2 py-1 text-right whitespace-nowrap">{fmtQty(l.qty_milli / 1000)} {l.unit}</td>
                  <td className="border px-2 py-1 text-right">{fmtMoney(l.unit_cost_x4 / 10000)}</td>
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
          className={`${btn} px-6 bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-50`}>
          {saving ? "กำลังบันทึก..." : isFuture ? "บันทึกเป็นดราฟ" : "บันทึกใบรับ"}
        </button>
        <button onClick={cancelDoc} className={`${btn} border hover:bg-gray-50`}>ยกเลิกใบรับ</button>
      </div>
    </div>
  );
}
