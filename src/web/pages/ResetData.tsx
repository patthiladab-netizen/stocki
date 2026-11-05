import { useState } from "react";
import { errorText } from "../errors";

const CONFIRM_WORD = "ล้างข้อมูล";

function convert(rows: any[]) {
  return rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      if (k.endsWith("_milli")) out[k.replace(/_milli$/, "")] = typeof v === "number" ? v / 1000 : v;
      else if (k.endsWith("_x4")) out[k.replace(/_x4$/, "")] = typeof v === "number" ? v / 10000 : v;
      else out[k] = v;
    }
    return out;
  });
}

async function getJson(url: string) {
  const res = await fetch(url, { credentials: "include" });
  const json = await res.json().catch(() => ({})) as any;
  if (!res.ok) throw new Error(errorText(json, res.status));
  return json;
}

export default function ResetDataDialog({ onClose }: { onClose: () => void }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");

  async function run() {
    setBusy(true);
    setError("");
    try {
      setStep("กำลังสำรองข้อมูลเป็น Excel...");
      const [items, balance, movements] = await Promise.all([
        getJson("/api/items"),
        getJson("/api/reports/balance"),
        getJson("/api/reports/movements"),
      ]);
      const { utils, writeFile } = await import("xlsx");
      const wb = utils.book_new();
      utils.book_append_sheet(wb, utils.json_to_sheet(convert(items.items ?? [])), "สินค้า");
      utils.book_append_sheet(wb, utils.json_to_sheet(convert(balance.data ?? [])), "ยอดคงเหลือ");
      utils.book_append_sheet(wb, utils.json_to_sheet(convert(movements.data ?? [])), "รับ-จ่าย");
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      writeFile(wb, `stocki-backup-${stamp}.xlsx`);

      setStep("กำลังล้างข้อมูล...");
      const res = await fetch("/api/admin/reset-data", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "RESET" }),
      });
      const json = await res.json().catch(() => ({})) as any;
      if (!res.ok || json.ok !== true) throw new Error(errorText(json, res.status));
      window.location.reload();
    } catch (e: any) {
      setError(`ล้างข้อมูลไม่สำเร็จ: ${e.message}`);
      setStep("");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-labelledby="reset-title">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6">
        <h2 id="reset-title" className="text-lg font-bold text-red-700 mb-2">ล้างข้อมูลทั้งหมด</h2>
        <p className="text-sm text-gray-700 mb-2">
          จะลบ <strong>สินค้า เอกสาร ล็อต ยอดสต็อก หมวด หน่วย และคลัง</strong> ทั้งหมด กู้คืนไม่ได้ ผู้ใช้และรหัสผ่านยังอยู่
        </p>
        <p className="text-sm text-gray-500 mb-4">ระบบจะดาวน์โหลดไฟล์ Excel สำรอง (สินค้า, ยอดคงเหลือ, รับ-จ่าย) ให้ก่อนลบ</p>
        <label htmlFor="reset-confirm" className="block text-sm font-medium mb-1">
          พิมพ์คำว่า <span className="font-mono bg-gray-100 px-1 rounded">{CONFIRM_WORD}</span> เพื่อยืนยัน
        </label>
        <input id="reset-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} disabled={busy}
          className="w-full border rounded-lg px-3 min-h-[44px] mb-3" autoComplete="off" />
        {!!step && <p className="text-sm text-gray-600 mb-2">{step}</p>}
        {!!error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 mb-2">{error}</p>}
        <div className="flex gap-2">
          <button onClick={run} disabled={busy || typed.trim() !== CONFIRM_WORD}
            className="flex-1 bg-red-600 text-white rounded-lg min-h-[44px] font-semibold whitespace-nowrap disabled:opacity-40">
            สำรองแล้วล้างข้อมูล
          </button>
          <button onClick={onClose} disabled={busy} className="flex-1 bg-gray-100 rounded-lg min-h-[44px] whitespace-nowrap">ปิด</button>
        </div>
      </div>
    </div>
  );
}
