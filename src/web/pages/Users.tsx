import { useEffect, useState } from "react";
import { errorText } from "../errors";

type Role = "OWNER" | "STAFF";
type User = { id: number; email: string; role: Role; is_active: boolean; locked_until: string | null };

const ROLE_TH: Record<Role, string> = { OWNER: "เจ้าของ", STAFF: "พนักงาน" };
const btn = "min-h-[44px] px-3 rounded-lg text-sm border whitespace-nowrap disabled:opacity-50";

async function api(path: string, method: string, body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(errorText(json, res.status));
  return json;
}

export default function Users({ currentEmail }: { currentEmail: string }) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("STAFF");
  const [password, setPassword] = useState("");
  const [resetFor, setResetFor] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState("");

  async function load() {
    setLoading(true);
    try {
      const json = await api("/api/users", "GET");
      setUsers(json.users ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      await fn();
      setNotice(ok);
      await load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addUser(ev: React.FormEvent) {
    ev.preventDefault();
    const done = await run(() => api("/api/users", "POST", { email, role, password }), `เพิ่มผู้ใช้ ${email} แล้ว`);
    if (done) { setEmail(""); setPassword(""); setRole("STAFF"); }
  }

  async function savePassword(ev: React.FormEvent) {
    ev.preventDefault();
    if (!resetFor) return;
    const done = await run(() => api(`/api/users/${resetFor.id}`, "PATCH", { password: newPassword }),
      `ตั้งรหัสผ่านใหม่ให้ ${resetFor.email} แล้ว (ต้องล็อกอินใหม่)`);
    if (done) { setResetFor(null); setNewPassword(""); }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold mb-1">ผู้ใช้งาน</h1>
      <p className="text-sm text-gray-500 mb-5">เพิ่มบัญชีพนักงาน เปลี่ยนบทบาท ตั้งรหัสผ่านใหม่ หรือปิดใช้งาน — พนักงานจะไม่เห็นต้นทุนและมูลค่าสินค้า</p>

      {error && <div role="alert" className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>}
      {notice && <div role="status" className="mb-4 p-3 rounded-lg bg-green-50 text-green-700 text-sm">{notice}</div>}

      <form onSubmit={addUser} className="bg-white border border-gray-200 rounded-xl p-4 mb-6 grid gap-3 md:grid-cols-4 md:items-end">
        <div className="md:col-span-2">
          <label htmlFor="u-email" className="block text-sm font-medium mb-1">อีเมล</label>
          <input id="u-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full border rounded-lg px-3 min-h-[44px]" placeholder="staff@ร้านของคุณ.com" />
        </div>
        <div>
          <label htmlFor="u-role" className="block text-sm font-medium mb-1">บทบาท</label>
          <select id="u-role" value={role} onChange={(e) => setRole(e.target.value as Role)} className="w-full border rounded-lg px-3 min-h-[44px]">
            <option value="STAFF">พนักงาน</option>
            <option value="OWNER">เจ้าของ</option>
          </select>
        </div>
        <div>
          <label htmlFor="u-pass" className="block text-sm font-medium mb-1">รหัสผ่านเริ่มต้น</label>
          <input id="u-pass" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
            className="w-full border rounded-lg px-3 min-h-[44px]" placeholder="อย่างน้อย 8 ตัว" autoComplete="new-password" />
        </div>
        <div className="md:col-span-4">
          <button type="submit" disabled={busy} className="min-h-[44px] px-5 rounded-lg bg-orange-600 text-white font-semibold whitespace-nowrap disabled:opacity-50">+ เพิ่มผู้ใช้</button>
        </div>
      </form>

      {loading ? (
        <p className="text-gray-400">กำลังโหลด...</p>
      ) : (
        <ul className="grid gap-3">
          {users.map((u) => {
            const self = u.email === currentEmail;
            const locked = !!u.locked_until && new Date(u.locked_until).getTime() > Date.now();
            return (
              <li key={u.id} className={`bg-white border border-gray-200 rounded-xl p-4 flex flex-col md:flex-row md:items-center gap-3 ${u.is_active ? "" : "opacity-60"}`}>
                <div className="flex-1 min-w-0">
                  <div className="font-medium break-all">{u.email}{self && <span className="text-xs text-gray-400"> (คุณ)</span>}</div>
                  <div className="flex flex-wrap gap-2 mt-1 text-xs">
                    <span className={`px-2 py-0.5 rounded-full ${u.role === "OWNER" ? "bg-orange-100 text-orange-700" : "bg-blue-100 text-blue-700"}`}>{ROLE_TH[u.role]}</span>
                    <span className={`px-2 py-0.5 rounded-full ${u.is_active ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-600"}`}>{u.is_active ? "ใช้งาน" : "ปิด"}</span>
                    {locked && <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700">ถูกล็อกชั่วคราว</span>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className={`${btn} border-gray-300`} disabled={busy || self}
                    title={self ? "เปลี่ยนบทบาทของตัวเองไม่ได้" : undefined}
                    onClick={() => run(() => api(`/api/users/${u.id}`, "PATCH", { role: u.role === "OWNER" ? "STAFF" : "OWNER" }),
                      `เปลี่ยน ${u.email} เป็น${u.role === "OWNER" ? "พนักงาน" : "เจ้าของ"}แล้ว`)}>
                    เปลี่ยนเป็น{u.role === "OWNER" ? "พนักงาน" : "เจ้าของ"}
                  </button>
                  <button className={`${btn} border-gray-300`} disabled={busy} onClick={() => { setResetFor(u); setNewPassword(""); }}>
                    ตั้งรหัสผ่านใหม่
                  </button>
                  <button className={`${btn} ${u.is_active ? "border-red-300 text-red-600" : "border-green-400 text-green-700"}`}
                    disabled={busy || self} title={self ? "ปิดใช้งานบัญชีของตัวเองไม่ได้" : undefined}
                    onClick={() => {
                      if (u.is_active && !window.confirm(`ปิดใช้งาน ${u.email}? ผู้ใช้นี้จะถูกออกจากระบบทันทีและล็อกอินไม่ได้`)) return;
                      run(() => api(`/api/users/${u.id}`, "PATCH", { is_active: !u.is_active }),
                        `${u.is_active ? "ปิด" : "เปิด"}ใช้งาน ${u.email} แล้ว`);
                    }}>
                    {u.is_active ? "ปิดใช้งาน" : "เปิดใช้งาน"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {resetFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true" aria-labelledby="reset-title">
          <form onSubmit={savePassword} className="bg-white rounded-xl p-5 w-full max-w-sm max-h-[90vh] overflow-y-auto">
            <h2 id="reset-title" className="text-lg font-bold mb-1">ตั้งรหัสผ่านใหม่</h2>
            <p className="text-sm text-gray-500 mb-3 break-all">{resetFor.email} — จะถูกออกจากระบบทุกเครื่อง และปลดล็อกบัญชีถ้าถูกล็อกอยู่</p>
            <label htmlFor="u-newpass" className="block text-sm font-medium mb-1">รหัสผ่านใหม่</label>
            <input id="u-newpass" type="password" required minLength={8} autoFocus value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password"
              className="w-full border rounded-lg px-3 min-h-[44px] mb-4" placeholder="อย่างน้อย 8 ตัว" />
            <div className="flex gap-2 justify-end">
              <button type="button" className={`${btn} border-gray-300`} onClick={() => setResetFor(null)}>ยกเลิก</button>
              <button type="submit" disabled={busy} className="min-h-[44px] px-4 rounded-lg bg-orange-600 text-white font-semibold whitespace-nowrap disabled:opacity-50">บันทึก</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
