import { useEffect, useState } from "react";
import { errorText } from "../errors";
import { fmtQty, todayBangkok, fmtDateTh } from "../format";

type Draft = {
  id: number;
  doc_type: string;
  doc_no: string;
  doc_date: string;
  ref_text: string | null;
  note: string | null;
  warehouse_id: number;
  warehouse_name?: string;
};

type Line = Record<string, any> & { item_id: number; qty_milli: number; sku?: string; name_th?: string; lot_no?: string | null };

const TYPE_TH: Record<string, string> = { RECEIVE: "รับเข้า", ISSUE: "ตัดออก", OPENING: "ยอดยกมา" };
const btn = "min-h-[44px] px-3 rounded text-sm whitespace-nowrap";

export default function Drafts({ navigate }: { navigate: (path: string) => void }) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  const today = todayBangkok();

  async function load() {
    setLoading(true);
    const res = await fetch("/api/documents?status=DRAFT&limit=200", { credentials: "include" });
    const json = await res.json().catch(() => ({})) as any;
    if (!res.ok) setError(errorText(json, res.status));
    setDrafts((json.documents ?? []).filter((d: any) => d.status === undefined || d.status === "DRAFT"));
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function remove(d: Draft) {
    if (!window.confirm(`ลบดราฟ ${d.doc_no}? ลบแล้วกู้คืนไม่ได้`)) return;
    setBusyId(d.id);
    setError("");
    const res = await fetch(`/api/documents/${d.id}`, { method: "DELETE", credentials: "include" });
    const json = await res.json().catch(() => ({})) as any;
    setBusyId(null);
    if (!res.ok || json.ok === false) { setError(errorText(json, res.status)); return; }
    setNotice(`ลบดราฟ ${d.doc_no} แล้ว`);
    load();
  }

  async function post(d: Draft) {
    if (!window.confirm(`บันทึกจริง ${d.doc_no}? สต็อกจะเปลี่ยนทันทีและแก้ไขไม่ได้อีก`)) return;
    setBusyId(d.id);
    setError("");
    const key = `post-${d.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const res = await fetch(`/api/documents/${d.id}/post`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({ idempotency_key: key }),
    });
    const json = await res.json().catch(() => ({})) as any;
    setBusyId(null);
    if (!res.ok || json.ok !== true) { setError(errorText(json, res.status)); return; }
    navigate(`/documents/${json.doc_id ?? json.id ?? d.id}`);
  }

  return (
    <div className="max-w-4xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-1">ดราฟ</h1>
      <p className="text-sm text-gray-500 mb-4">เอกสารที่ลงวันที่ล่วงหน้า ยังไม่เปลี่ยนสต็อก กด "บันทึกจริง" ได้เมื่อถึงวันที่ในเอกสาร</p>

      {!!error && <div className="text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 mb-3 text-sm" role="alert">{error}</div>}
      {!!notice && <div className="text-green-800 bg-green-50 border border-green-200 rounded px-3 py-2 mb-3 text-sm" role="status">{notice}</div>}

      {loading ? (
        <p className="text-gray-500 text-sm">กำลังโหลด…</p>
      ) : drafts.length === 0 ? (
        <p className="text-gray-400 text-sm">ไม่มีดราฟ</p>
      ) : (
        <div className="space-y-3">
          {drafts.map((d) => {
            const notDue = d.doc_date > today;
            return (
              <div key={d.id} className="bg-white border rounded-xl p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold">{TYPE_TH[d.doc_type] ?? d.doc_type} · <span className="font-mono">{d.doc_no}</span></div>
                    <div className="text-sm text-gray-600">วันที่ {fmtDateTh(d.doc_date)}{d.warehouse_name ? ` · ${d.warehouse_name}` : ""}</div>
                    {!!d.ref_text && <div className="text-sm text-gray-500 break-words">อ้างอิง: {d.ref_text}</div>}
                  </div>
                  {notDue && <span className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded whitespace-nowrap">รอถึงวันที่</span>}
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  <button onClick={() => setEditing(d)} disabled={busyId === d.id} className={`${btn} border hover:bg-gray-50`}>แก้ไข</button>
                  <button onClick={() => remove(d)} disabled={busyId === d.id} className={`${btn} border border-red-200 text-red-600 hover:bg-red-50`}>ลบ</button>
                  <button onClick={() => post(d)} disabled={notDue || busyId === d.id}
                    title={notDue ? `บันทึกจริงได้ตั้งแต่ ${fmtDateTh(d.doc_date)}` : undefined}
                    className={`${btn} bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-40`}>
                    บันทึกจริง
                  </button>
                </div>
                {notDue && <p className="text-xs text-gray-500 mt-1">บันทึกจริงได้ตั้งแต่ {fmtDateTh(d.doc_date)}</p>}
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <DraftEditor draft={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setNotice("บันทึกการแก้ไขดราฟแล้ว"); load(); }} />
      )}
    </div>
  );
}

function DraftEditor({ draft, onClose, onSaved }: { draft: Draft; onClose: () => void; onSaved: () => void }) {
  const [docDate, setDocDate] = useState(draft.doc_date);
  const [refText, setRefText] = useState(draft.ref_text ?? "");
  const [lines, setLines] = useState<Line[]>([]);
  const [qtys, setQtys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/documents/${draft.id}`, { credentials: "include" });
      const json = await res.json().catch(() => ({})) as any;
      if (!res.ok) { setError(errorText(json, res.status)); setLoading(false); return; }
      const ls: Line[] = json.lines ?? [];
      setLines(ls);
      setQtys(ls.map((l) => String(l.qty_milli / 1000)));
      setLoading(false);
    })();
  }, [draft.id]);

  async function save() {
    setError("");
    const kept: Line[] = [];
    for (let i = 0; i < lines.length; i++) {
      const q = Math.round(parseFloat(qtys[i]) * 1000);
      if (isNaN(q) || q < 0) { setError(`รายการที่ ${i + 1}: จำนวนไม่ถูกต้อง`); return; }
      if (q > 0) kept.push({ ...lines[i], qty_milli: q });
    }
    if (kept.length === 0) { setError("ต้องมีอย่างน้อย 1 รายการ (ถ้าไม่ใช้แล้วให้ลบดราฟ)"); return; }
    setSaving(true);
    const res = await fetch(`/api/documents/${draft.id}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        doc_date: docDate,
        warehouse_id: draft.warehouse_id,
        ref_text: refText || undefined,
        note: draft.note ?? undefined,
        lines: kept.map((l) => ({
          item_id: l.item_id,
          lot_id: l.lot_id ?? undefined,
          qty_milli: l.qty_milli,
          unit_cost_x4: l.unit_cost_x4 ?? 0,
          lot_no: l.lot_no ?? undefined,
          lot_mfg_date: l.mfg_date ?? l.lot_mfg_date ?? undefined,
          lot_expiry_date: l.expiry_date ?? l.lot_expiry_date ?? undefined,
          lot_po_no: l.po_no ?? l.lot_po_no ?? undefined,
          lot_manufacturer_name: l.manufacturer_name ?? l.lot_manufacturer_name ?? undefined,
        })),
      }),
    });
    const json = await res.json().catch(() => ({})) as any;
    setSaving(false);
    if (!res.ok || json.ok === false) { setError(errorText(json, res.status)); return; }
    onSaved();
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-labelledby="draft-edit-title">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
        <h2 id="draft-edit-title" className="text-lg font-bold mb-4">แก้ไขดราฟ {draft.doc_no}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <div>
            <label htmlFor="draft-date" className="block text-sm font-medium mb-1">วันที่เอกสาร</label>
            <input id="draft-date" type="date" lang="th" value={docDate} onChange={(e) => setDocDate(e.target.value)} className="border rounded px-3 min-h-[44px] w-full" />
            <p className="text-xs text-gray-500 mt-1">วันที่: {fmtDateTh(docDate)}</p>
          </div>
          <div>
            <label htmlFor="draft-ref" className="block text-sm font-medium mb-1">อ้างอิง</label>
            <input id="draft-ref" value={refText} onChange={(e) => setRefText(e.target.value)} className="border rounded px-3 min-h-[44px] w-full" />
          </div>
        </div>
        {loading ? <p className="text-sm text-gray-500">กำลังโหลด…</p> : (
          <div className="space-y-2 mb-4">
            {lines.map((l, i) => (
              <div key={l.id ?? i} className="flex items-center gap-2">
                <label htmlFor={`draft-qty-${i}`} className="flex-1 min-w-0 text-sm">
                  <span className="font-mono text-xs text-gray-500">{l.sku}</span> {l.name_th}
                  {!!l.lot_no && <span className="text-xs text-gray-500"> · ล็อต {l.lot_no}</span>}
                  <span className="block text-xs text-gray-400">เดิม {fmtQty(l.qty_milli / 1000)}</span>
                </label>
                <input id={`draft-qty-${i}`} type="number" min="0" step="0.001" value={qtys[i] ?? ""}
                  onChange={(e) => setQtys((prev) => prev.map((q, j) => (j === i ? e.target.value : q)))}
                  className="border rounded px-2 min-h-[44px] w-28 text-right" />
              </div>
            ))}
            <p className="text-xs text-gray-500">ใส่ 0 เพื่อเอารายการนั้นออก</p>
          </div>
        )}
        {!!error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 mb-3" role="alert">{error}</p>}
        <div className="flex gap-2">
          <button onClick={save} disabled={saving || loading} className={`${btn} flex-1 bg-blue-700 text-white disabled:opacity-50`}>{saving ? "กำลังบันทึก..." : "บันทึกการแก้ไข"}</button>
          <button onClick={onClose} className={`${btn} flex-1 bg-gray-100`}>ปิด</button>
        </div>
      </div>
    </div>
  );
}
