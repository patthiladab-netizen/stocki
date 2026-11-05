import { useState, useEffect } from "react";
import { useStore } from "../store";
import { errorText } from "../errors";
import { fmtMoney, fmtQty } from "../format";

type Item = {
  id: number;
  sku: string;
  name_th: string;
  barcode?: string;
  track_lot: number;
  status: string;
  standard_cost_x4?: number;
  unit_id?: number;
  category_id?: number;
  reorder_point_milli?: number;
};

type Unit = { id: number; code: string; name_th: string; decimal_places?: number };

const btnBase = "min-h-[44px] whitespace-nowrap rounded-lg text-sm font-medium px-3 transition-colors";

export default function Items() {
  const user = useStore((s) => s.user);
  const isOwner = user?.role === "OWNER";
  const [items, setItems] = useState<Item[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [onHand, setOnHand] = useState<Map<number, number>>(new Map());
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [editItem, setEditItem] = useState<Item | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [pageError, setPageError] = useState("");

  async function load(query = "") {
    setLoading(true);
    const res = await fetch(`/api/items?q=${encodeURIComponent(query)}`);
    const data = await res.json().catch(() => ({})) as any;
    if (!res.ok) setPageError(errorText(data, res.status));
    setItems(data.items ?? []);
    setLoading(false);
    loadOnHand();
  }

  async function loadOnHand() {
    const res = await fetch("/api/reports/balance", { credentials: "include" });
    if (!res.ok) return;
    const json = await res.json() as { data?: Array<{ item_id: number; qty_on_hand_milli: number }> };
    const m = new Map<number, number>();
    for (const r of json.data ?? []) m.set(r.item_id, (m.get(r.item_id) ?? 0) + (r.qty_on_hand_milli ?? 0));
    setOnHand(m);
  }

  async function toggleStatus(item: Item) {
    const newStatus = item.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    const res = await fetch(`/api/items/${item.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    if (!res.ok) {
      setPageError(errorText(await res.json().catch(() => ({})), res.status));
      return;
    }
    setPageError("");
    load(q);
  }

  useEffect(() => {
    load();
    fetch("/api/units").then(r => r.json()).then(d => setUnits(d.units ?? [])).catch(() => {});
  }, []);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    load(q);
  }

  function qtyText(item: Item, unit?: Unit) {
    const milli = onHand.get(item.id);
    if (milli === undefined) return "—";
    return `${fmtQty(milli / 1000, unit?.decimal_places ?? 3)}${unit ? ` ${unit.name_th}` : ""}`;
  }

  function actions(item: Item) {
    return (
      <>
        <button
          onClick={() => { setEditItem(item); setShowForm(true); }}
          className={`${btnBase} border border-gray-200 text-gray-600 hover:border-orange-300 hover:text-orange-600`}
        >แก้ไข</button>
        <button
          onClick={() => toggleStatus(item)}
          className={`${btnBase} border ${item.status === "ACTIVE" ? "border-red-200 text-red-600 hover:bg-red-50" : "border-green-200 text-green-600 hover:bg-green-50"}`}
        >{item.status === "ACTIVE" ? "ปิดใช้งาน" : "เปิดใช้งาน"}</button>
      </>
    );
  }

  const empty = (
    <div className="px-4 py-16 text-center">
      <div className="text-4xl mb-3">📦</div>
      <div className="text-gray-500 font-medium mb-1">ยังไม่มีสินค้าในระบบ</div>
      <div className="text-gray-400 text-xs">กด "+ เพิ่มสินค้า" เพื่อเริ่มต้น หรือนำเข้าจาก Excel</div>
    </div>
  );

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-3 mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900">รายการสินค้า</h1>
          <p className="text-sm text-gray-500 mt-0.5">จัดการและค้นหาสินค้าทั้งหมดในระบบ</p>
        </div>
        {isOwner && (
          <button
            onClick={() => { setEditItem(null); setShowForm(true); }}
            className="shrink-0 flex items-center gap-1.5 text-white text-sm font-semibold px-4 min-h-[44px] whitespace-nowrap rounded-lg shadow-sm hover:opacity-90 transition-opacity"
            style={{ background: "#FF6200" }}
          >
            <span className="text-base leading-none">+</span> เพิ่มสินค้า
          </button>
        )}
      </div>

      <form onSubmit={handleSearch} className="flex gap-2 mb-5">
        <div className="relative flex-1 min-w-0">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" aria-hidden="true">🔍</span>
          <label htmlFor="item-search" className="sr-only">ค้นหาสินค้า</label>
          <input
            id="item-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ค้นหาชื่อหรือบาร์โค้ด..."
            className="w-full border border-gray-200 rounded-xl pl-9 pr-3 min-h-[44px] text-sm shadow-sm focus:outline-none focus:ring-2 focus:border-transparent"
            style={{ "--tw-ring-color": "#FF6200" } as React.CSSProperties}
          />
        </div>
        <button type="submit" className="bg-white border border-gray-200 px-5 min-h-[44px] whitespace-nowrap rounded-xl text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors">ค้นหา</button>
      </form>

      {!!pageError && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2 mb-4">⚠️ {pageError}</div>}

      {loading ? (
        <div className="flex items-center gap-2 text-gray-400 text-sm py-10 justify-center">
          <span className="animate-spin">⏳</span> กำลังโหลด...
        </div>
      ) : (
        <>
          {/* mobile: cards */}
          <div className="md:hidden space-y-3">
            {items.length === 0 && <div className="bg-white rounded-2xl border border-gray-100">{empty}</div>}
            {items.map((item) => {
              const unit = units.find(u => u.id === item.unit_id);
              return (
                <div key={item.id} className={`bg-white rounded-2xl border border-gray-100 shadow-sm p-4 ${item.status === "INACTIVE" ? "opacity-60" : ""}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-gray-800 break-words">
                        {item.name_th}
                        {item.status === "INACTIVE" && <span className="ml-2 text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">ปิดใช้งาน</span>}
                      </div>
                      <div className="font-mono text-xs text-gray-500 mt-0.5 break-all">{item.sku}{item.barcode ? ` · ${item.barcode}` : ""}</div>
                      {!!item.track_lot && <span className="inline-block mt-1 bg-green-100 text-green-700 text-xs font-semibold px-2 py-0.5 rounded-full">ใช้ล็อต</span>}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs text-gray-400">คงเหลือ</div>
                      <div className="font-semibold text-gray-800 whitespace-nowrap">{qtyText(item, unit)}</div>
                    </div>
                  </div>
                  {isOwner && <div className="flex gap-2 mt-3">{actions(item)}</div>}
                </div>
              );
            })}
          </div>

          {/* desktop: table */}
          <div className="hidden md:block bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: "#f8f9fb" }} className="text-left border-b border-gray-100">
                    <th className="px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">รหัส</th>
                    <th className="px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">ชื่อสินค้า</th>
                    <th className="px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">บาร์โค้ด</th>
                    <th className="px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide text-right">คงเหลือ</th>
                    <th className="px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide text-center">ล็อต</th>
                    {isOwner && <th className="px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide text-right">ต้นทุน</th>}
                    {isOwner && <th className="px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide text-center">จัดการ</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {items.map((item) => {
                    const unit = units.find(u => u.id === item.unit_id);
                    return (
                      <tr key={item.id} className={`hover:bg-orange-50/40 transition-colors ${item.status === "INACTIVE" ? "opacity-50" : ""}`}>
                        <td className="px-4 py-3 font-mono text-xs text-gray-500">{item.sku}</td>
                        <td className="px-4 py-3 font-medium text-gray-800">
                          {item.name_th}
                          {item.status === "INACTIVE" && <span className="ml-2 text-xs bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded whitespace-nowrap">ปิดใช้งาน</span>}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-400">{item.barcode ?? "—"}</td>
                        <td className="px-4 py-3 text-right whitespace-nowrap text-gray-700">{qtyText(item, unit)}</td>
                        <td className="px-4 py-3 text-center">
                          {item.track_lot
                            ? <span className="inline-block bg-green-100 text-green-700 text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap">ใช้ล็อต</span>
                            : <span className="text-gray-300">—</span>}
                        </td>
                        {isOwner && (
                          <td className="px-4 py-3 text-right font-mono text-gray-700 whitespace-nowrap">
                            {item.standard_cost_x4 !== undefined ? fmtMoney(item.standard_cost_x4 / 10000) : "—"}
                          </td>
                        )}
                        {isOwner && (
                          <td className="px-4 py-2 text-center">
                            <div className="flex items-center justify-center gap-1.5">{actions(item)}</div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {items.length === 0 && (
                    <tr><td colSpan={7}>{empty}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {showForm && (
        <ItemForm
          item={editItem}
          units={units}
          onSave={() => { setShowForm(false); load(q); }}
          onCancel={() => setShowForm(false)}
        />
      )}
    </div>
  );
}

function ItemForm({ item, units, onSave, onCancel }: { item: Item | null; units: Unit[]; onSave: () => void; onCancel: () => void }) {
  const [sku, setSku] = useState(item?.sku ?? "");
  const [name, setName] = useState(item?.name_th ?? "");
  const [barcode, setBarcode] = useState(item?.barcode ?? "");
  const [trackLot, setTrackLot] = useState(item ? Boolean(item.track_lot) : false);
  const [cost, setCost] = useState(item?.standard_cost_x4 !== undefined ? (item.standard_cost_x4 / 10000).toString() : "0");
  const [unitId, setUnitId] = useState<number>(item?.unit_id ?? (units[0]?.id ?? 1));
  const [reorderPoint, setReorderPoint] = useState(item?.reorder_point_milli !== undefined ? (item.reorder_point_milli / 1000).toString() : "0");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!item && units.length > 0 && unitId !== units[0].id) {
      setUnitId(units[0].id);
    }
  }, [units]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const costVal = parseFloat(cost);
    if (isNaN(costVal) || costVal < 0) { setError("ต้นทุนต้องเป็นตัวเลขที่ไม่ติดลบ"); return; }
    const reorderVal = parseFloat(reorderPoint);
    if (isNaN(reorderVal) || reorderVal < 0) { setError("จุดสั่งซื้อต้องเป็นตัวเลขที่ไม่ติดลบ"); return; }
    const body: Record<string, unknown> = {
      sku,
      name_th: name,
      barcode: barcode.trim() || undefined,
      unit_id: unitId,
      track_lot: trackLot,
      standard_cost_x4: Math.round(costVal * 10000),
      reorder_point_milli: Math.round(reorderVal * 1000),
    };
    const url = item ? `/api/items/${item.id}` : "/api/items";
    const method = item ? "PUT" : "POST";
    setSaving(true);
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setSaving(false);
    if (!res.ok) {
      setError(errorText(await res.json().catch(() => ({})), res.status));
      return;
    }
    onSave();
  }

  const inputCls = "w-full border border-gray-200 rounded-lg px-3 min-h-[44px] text-sm focus:outline-none focus:ring-2 focus:border-transparent transition-shadow";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-labelledby="item-form-title">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="px-6 pt-6 pb-4 border-b border-gray-100">
          <h2 id="item-form-title" className="text-lg font-bold text-gray-900">{item ? "แก้ไขสินค้า" : "เพิ่มสินค้าใหม่"}</h2>
          <p className="text-xs text-gray-400 mt-0.5">{item ? `แก้ไขข้อมูลสินค้า ${item.sku}` : "กรอกข้อมูลสินค้าที่ต้องการเพิ่ม"}</p>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="f-sku" className="block text-xs font-semibold text-gray-600 mb-1.5">รหัสสินค้า (SKU) *</label>
              <input id="f-sku" value={sku} onChange={(e) => setSku(e.target.value)} required className={inputCls} placeholder="เช่น TEST-001" />
            </div>
            <div>
              <label htmlFor="f-unit" className="block text-xs font-semibold text-gray-600 mb-1.5">หน่วยนับ *</label>
              <select id="f-unit" value={unitId} onChange={(e) => setUnitId(Number(e.target.value))} className={inputCls} required>
                {units.map(u => <option key={u.id} value={u.id}>{u.name_th} ({u.code})</option>)}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="f-name" className="block text-xs font-semibold text-gray-600 mb-1.5">ชื่อสินค้า *</label>
            <input id="f-name" value={name} onChange={(e) => setName(e.target.value)} required className={inputCls} placeholder="ชื่อสินค้าภาษาไทย" />
          </div>
          <div>
            <label htmlFor="f-barcode" className="block text-xs font-semibold text-gray-600 mb-1.5">บาร์โค้ด</label>
            <input id="f-barcode" value={barcode} onChange={(e) => setBarcode(e.target.value)} className={inputCls} placeholder="EAN-13 หรือ Code128" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="f-cost" className="block text-xs font-semibold text-gray-600 mb-1.5">ต้นทุนมาตรฐาน (บาท)</label>
              <input id="f-cost" type="number" step="0.0001" min="0" value={cost} onChange={(e) => setCost(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label htmlFor="f-reorder" className="block text-xs font-semibold text-gray-600 mb-1.5">จุดสั่งซื้อ</label>
              <input id="f-reorder" type="number" step="0.001" min="0" value={reorderPoint} onChange={(e) => setReorderPoint(e.target.value)} className={inputCls} />
            </div>
          </div>
          <label htmlFor="track_lot" className="flex items-center gap-3 cursor-pointer py-2 px-3 rounded-lg bg-gray-50 border border-gray-100">
            <input type="checkbox" id="track_lot" checked={trackLot} onChange={(e) => setTrackLot(e.target.checked)} className="w-5 h-5 accent-orange-500" />
            <div>
              <div className="text-sm font-medium text-gray-700">ใช้ล็อต / วันหมดอายุ</div>
              <div className="text-xs text-gray-400">เปิดเพื่อบันทึก Lot No. และวันหมดอายุทุกครั้งที่รับสินค้า</div>
            </div>
          </label>
          {!!error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2" role="alert">⚠️ {error}</div>
          )}
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={saving}
              className="flex-1 text-white text-sm font-semibold rounded-lg min-h-[44px] whitespace-nowrap hover:opacity-90 transition-opacity disabled:opacity-50"
              style={{ background: "#FF6200" }}>
              {saving ? "กำลังบันทึก..." : "บันทึก"}
            </button>
            <button type="button" onClick={onCancel} className="flex-1 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg min-h-[44px] whitespace-nowrap hover:bg-gray-200 transition-colors">ยกเลิก</button>
          </div>
        </form>
      </div>
    </div>
  );
}
