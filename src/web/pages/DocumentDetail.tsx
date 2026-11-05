import { useEffect, useState } from "react";
import { useStore } from "../store";
import { fmtMoney, fmtQty, fmtDateTh } from "../format";
import { errorText } from "../errors";

type Document = {
  id: number;
  doc_type: string;
  doc_no: string;
  doc_date: string;
  status: string;
  warehouse_name: string;
  ref_text: string | null;
  note: string | null;
  posted_at: string | null;
};

type Line = {
  id: number;
  item_id: number;
  sku: string;
  name_th: string;
  lot_no: string | null;
  expiry_date: string | null;
  qty_milli: number;
  unit_cost_x4?: number;
};

type Props = { docId: number; onBack: () => void };

const DOC_TYPE_LABEL: Record<string, string> = {
  OPENING: "ยอดยกมา",
  RECEIVE: "ใบรับ",
  ISSUE: "ใบตัดออก",
  CANCEL: "ยกเลิก",
};

const STATUS_TH: Record<string, string> = { DRAFT: "ดราฟ", POSTED: "บันทึกแล้ว", CANCELLED: "ยกเลิกแล้ว" };

export default function DocumentDetail({ docId, onBack }: Props) {
  const { user } = useStore();
  const [doc, setDoc] = useState<Document | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelMsg, setCancelMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const isOwner = user?.role === "OWNER";

  useEffect(() => {
    async function load() {
      setLoading(true);
      const res = await fetch(`/api/documents/${docId}`, { credentials: "include" });
      if (!res.ok) { setError("ไม่พบเอกสาร"); setLoading(false); return; }
      const json = await res.json() as any;
      setDoc(json.document);
      setLines(json.lines ?? []);
      setLoading(false);
    }
    load();
  }, [docId, reload]);

  async function doCancel() {
    setCancelling(true);
    setCancelMsg(null);
    try {
      const res = await fetch(`/api/documents/${docId}/cancel`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "Idempotency-Key": `cancel-${docId}` },
      });
      const json = await res.json().catch(() => ({})) as any;
      if (!res.ok) {
        setCancelMsg({ ok: false, text: errorText(json, res.status) });
      } else {
        setCancelMsg({ ok: true, text: `ยกเลิกแล้ว — สร้างเอกสารกลับรายการ ${json.cancel_no ?? ""}`.trim() });
        setReload(r => r + 1);
      }
    } catch {
      setCancelMsg({ ok: false, text: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่" });
    } finally {
      setCancelling(false);
      setConfirmCancel(false);
    }
  }

  if (loading) return <div className="p-4 text-gray-500">กำลังโหลด…</div>;
  if (error || !doc) return (
    <div className="p-4">
      <button onClick={onBack} className="text-blue-600 text-sm mb-3">← กลับ</button>
      <p className="text-red-500">{error || "ไม่พบเอกสาร"}</p>
    </div>
  );

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <button onClick={onBack} className="text-blue-600 text-sm mb-4 min-h-[44px] hover:underline">← กลับ</button>

      <div className="bg-white border rounded-lg p-4 mb-4 print:border-0">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div>
            <h1 className="text-xl font-bold">{DOC_TYPE_LABEL[doc.doc_type] ?? doc.doc_type}</h1>
            <p className="text-2xl font-mono font-bold text-blue-700">{doc.doc_no}</p>
          </div>
          <div className="sm:text-right text-sm text-gray-500">
            <p>คลัง: <strong>{doc.warehouse_name}</strong></p>
            <p>วันที่: <strong>{fmtDateTh(doc.doc_date)}</strong></p>
            <p>สถานะ: <strong className={doc.status === "POSTED" ? "text-green-600" : doc.status === "CANCELLED" ? "text-red-600" : "text-yellow-600"}>{STATUS_TH[doc.status] ?? doc.status}</strong></p>
          </div>
        </div>
        {doc.ref_text && <p className="text-sm text-gray-600">อ้างอิง: {doc.ref_text}</p>}
        {doc.note && <p className="text-sm text-gray-600">หมายเหตุ: {doc.note}</p>}
      </div>

      <div className="bg-white border rounded-lg overflow-x-auto">
        <table className="text-sm w-full border-collapse">
          <thead className="bg-gray-100">
            <tr>
              <th className="border px-3 py-2 text-left">#</th>
              <th className="border px-3 py-2 text-left">รหัส</th>
              <th className="border px-3 py-2 text-left">ชื่อสินค้า</th>
              <th className="border px-3 py-2 text-left">Lot No.</th>
              <th className="border px-3 py-2 text-left">วันหมดอายุ</th>
              <th className="border px-3 py-2 text-right">จำนวน</th>
              {isOwner && <th className="border px-3 py-2 text-right">ต้นทุน/หน่วย</th>}
              {isOwner && <th className="border px-3 py-2 text-right">มูลค่า</th>}
            </tr>
          </thead>
          <tbody>
            {lines.map((line, i) => {
              const qty = line.qty_milli / 1000;
              const cost = (line.unit_cost_x4 ?? 0) / 10000;
              const value = qty * cost;
              return (
                <tr key={line.id} className="hover:bg-gray-50">
                  <td className="border px-3 py-2">{i + 1}</td>
                  <td className="border px-3 py-2 font-mono text-xs">{line.sku}</td>
                  <td className="border px-3 py-2">{line.name_th}</td>
                  <td className="border px-3 py-2">{line.lot_no ?? "-"}</td>
                  <td className="border px-3 py-2">{fmtDateTh(line.expiry_date)}</td>
                  <td className="border px-3 py-2 text-right whitespace-nowrap">{fmtQty(qty)}</td>
                  {isOwner && <td className="border px-3 py-2 text-right whitespace-nowrap">{fmtMoney(cost)}</td>}
                  {isOwner && <td className="border px-3 py-2 text-right whitespace-nowrap">{fmtMoney(value)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex gap-2 print:hidden">
        <button
          onClick={() => window.print()}
          className="bg-gray-700 text-white px-4 min-h-[44px] whitespace-nowrap rounded text-sm"
        >
          🖨️ พิมพ์เอกสาร
        </button>
        {isOwner && doc.status === "POSTED" && doc.doc_type !== "CANCEL" && (
          <button
            onClick={() => setConfirmCancel(true)}
            disabled={cancelling}
            className="border border-red-300 text-red-600 bg-white px-4 min-h-[44px] whitespace-nowrap rounded text-sm hover:bg-red-50 disabled:opacity-50"
          >
            ยกเลิกเอกสาร
          </button>
        )}
      </div>

      {cancelMsg && (
        <p role="status" className={`mt-3 text-sm ${cancelMsg.ok ? "text-green-700" : "text-red-600"}`}>{cancelMsg.text}</p>
      )}

      {confirmCancel && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="cancel-title">
          <div className="bg-white rounded-lg p-5 max-w-md w-full shadow-lg">
            <h2 id="cancel-title" className="text-lg font-bold mb-2">ยกเลิกเอกสาร {doc.doc_no}?</h2>
            <p className="text-sm text-gray-600 mb-4">
              ระบบจะไม่ลบเอกสารนี้ แต่จะสร้างเอกสารกลับรายการ เพื่อคืนยอดสต็อกและต้นทุนให้เหมือนก่อนบันทึก
              เอกสารเดิมจะเปลี่ยนสถานะเป็น "ยกเลิกแล้ว" และย้อนกลับไม่ได้
            </p>
            <div className="flex gap-2 justify-end flex-wrap">
              <button onClick={() => setConfirmCancel(false)} disabled={cancelling}
                className="border px-4 min-h-[44px] whitespace-nowrap rounded text-sm">ไม่ยกเลิก</button>
              <button onClick={doCancel} disabled={cancelling}
                className="bg-red-600 text-white px-4 min-h-[44px] whitespace-nowrap rounded text-sm disabled:opacity-50">
                {cancelling ? "กำลังยกเลิก…" : "ยืนยันยกเลิกเอกสาร"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
