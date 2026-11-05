import { useState } from "react";
import { useStore } from "../store";
import ResetPassword from "./ResetPassword";

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const setUser = useStore((s) => s.setUser);

  if (showReset) return <ResetPassword onBack={() => setShowReset(false)} />;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json() as any;
      if (!res.ok) {
        if (data.error === "account_locked") setError("บัญชีถูกล็อก 15 นาที เนื่องจากล็อกอินผิดหลายครั้ง");
        else setError("อีเมลหรือรหัสผ่านไม่ถูกต้อง");
        return;
      }
      const me = await fetch("/api/auth/me").then((r) => r.json()) as any;
      setUser({ email: me.email, role: me.role });
      onLogin();
    } catch {
      setError("เกิดข้อผิดพลาด กรุณาลองใหม่");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-lg shadow p-8 w-full max-w-sm">
        <h1 className="text-2xl font-bold text-center mb-6" style={{color:"#FF6200"}}>Stocki!</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">อีเมล</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">รหัสผ่าน</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full text-white rounded py-2 font-medium disabled:opacity-50"
            style={{backgroundColor:"#FF6200"}}
          >
            {loading ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
          </button>
          <button type="button" onClick={() => setShowReset(true)} className="w-full text-gray-400 text-sm py-1 hover:underline">
            ลืมรหัสผ่าน?
          </button>
        </form>
      </div>
    </div>
  );
}
