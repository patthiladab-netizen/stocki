import { useState } from "react";
import { errorText } from "../errors";

export default function Setup({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) { setError("รหัสผ่านไม่ตรงกัน"); return; }
    if (password.length < 8) { setError("รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร"); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/setup/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) { setError(errorText(await res.json().catch(() => ({})), res.status)); return; }
      onDone();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-lg shadow p-8 w-full max-w-sm">
        <h1 className="text-2xl font-bold text-center mb-2 text-gray-800">ตั้งค่าระบบครั้งแรก</h1>
        <p className="text-sm text-gray-500 text-center mb-6">ตั้งรหัสผ่านสำหรับผู้ดูแลระบบ</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">รหัสผ่าน</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className="w-full border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ยืนยันรหัสผ่าน</label>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required className="w-full border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button type="submit" disabled={loading} className="w-full bg-blue-600 text-white rounded py-2 font-medium hover:bg-blue-700 disabled:opacity-50">
            {loading ? "กำลังบันทึก..." : "ตั้งค่า"}
          </button>
        </form>
      </div>
    </div>
  );
}
