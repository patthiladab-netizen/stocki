import { useState } from "react";

export default function ResetPassword({ onBack }: { onBack: () => void }) {
  const [appSecret, setAppSecret] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (newPassword !== confirm) { setError("รหัสผ่านไม่ตรงกัน"); return; }
    if (newPassword.length < 8) { setError("รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร"); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app_secret: appSecret, new_password: newPassword }),
      });
      const data = await res.json() as any;
      if (!res.ok) {
        if (data.error === "invalid_secret") setError("APP SECRET ไม่ถูกต้อง");
        else setError("เกิดข้อผิดพลาด กรุณาลองใหม่");
        return;
      }
      setSuccess(true);
    } catch {
      setError("เกิดข้อผิดพลาด กรุณาลองใหม่");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-lg shadow p-8 w-full max-w-sm text-center">
          <h1 className="text-2xl font-bold mb-4" style={{color:"#FF6200"}}>Stocki!</h1>
          <p className="text-green-600 font-medium mb-4">เปลี่ยนรหัสผ่านสำเร็จแล้ว</p>
          <button onClick={onBack} className="w-full text-white rounded py-2 font-medium" style={{backgroundColor:"#FF6200"}}>
            กลับไปล็อกอิน
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-lg shadow p-8 w-full max-w-sm">
        <h1 className="text-2xl font-bold text-center mb-2" style={{color:"#FF6200"}}>Stocki!</h1>
        <h2 className="text-lg font-medium text-center text-gray-700 mb-6">รีเซ็ตรหัสผ่าน</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              APP SECRET
              <span className="text-gray-400 font-normal ml-1">(จาก Cloudflare Worker secrets)</span>
            </label>
            <input
              type="password"
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
              required
              placeholder="ค่า APP_SECRET ที่ตั้งไว้"
              className="w-full border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">รหัสผ่านใหม่</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              placeholder="อย่างน้อย 8 ตัวอักษร"
              className="w-full border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ยืนยันรหัสผ่านใหม่</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              placeholder="พิมพ์รหัสผ่านอีกครั้ง"
              className="w-full border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full text-white rounded py-2 font-medium disabled:opacity-50"
            style={{backgroundColor:"#FF6200"}}
          >
            {loading ? "กำลังรีเซ็ต..." : "รีเซ็ตรหัสผ่าน"}
          </button>
          <button type="button" onClick={onBack} className="w-full text-gray-500 text-sm py-1 hover:underline">
            ← กลับไปล็อกอิน
          </button>
        </form>
      </div>
    </div>
  );
}
