import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { useStore } from "./store";
import Login from "./pages/Login";
import Setup from "./pages/Setup";
import Items from "./pages/Items";
import Import from "./pages/Import";
import Receive from "./pages/Receive";
import Reports from "./pages/Reports";
import Issue from "./pages/Issue";
import DocumentDetail from "./pages/DocumentDetail";
import Drafts from "./pages/Drafts";
import ResetDataDialog from "./pages/ResetData";
import Users from "./pages/Users";

type Page = "items" | "import" | "receive" | "issue" | "reports" | "drafts" | "users" | "document";

const LABELS: Record<Page, string> = {
  items: "สินค้า", import: "นำเข้า Excel", receive: "รับสินค้า", issue: "ตัดออก",
  reports: "รายงาน", drafts: "ดราฟ", users: "ผู้ใช้งาน", document: "เอกสาร",
};
const SHORT: Partial<Record<Page, string>> = { import: "นำเข้า", receive: "รับเข้า" };

const ICON_PATHS: Partial<Record<Page, string>> = {
  items: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
  receive: "M12 4v12m0 0l-5-5m5 5l5-5M4 20h16",
  issue: "M12 20V8m0 0l-5 5m5-5l5 5M4 4h16",
  reports: "M9 19V10m6 9V5m-12 14h18M3 19V14",
  import: "M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M8 8l4-4 4 4M12 4v12",
};

function Icon({ page }: { page: Page }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICON_PATHS[page]} />
    </svg>
  );
}

function App() {
  const { user, setUser } = useStore();
  const [checking, setChecking] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [page, setPage] = useState<Page>("items");
  const [docId, setDocId] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showReset, setShowReset] = useState(false);

  useEffect(() => {
    async function init() {
      const setup = await fetch("/api/setup/status").then((r) => r.json()) as any;
      if (setup.needsSetup) { setNeedsSetup(true); setChecking(false); return; }
      const me = await fetch("/api/auth/me");
      if (me.ok) {
        const data = await me.json() as any;
        setUser({ email: data.email, role: data.role });
      }
      setChecking(false);
    }
    init();
  }, []);

  async function handleLogout() {
    setMenuOpen(false);
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
  }

  if (checking) return <div className="min-h-screen flex items-center justify-center text-gray-400">กำลังโหลด...</div>;
  if (needsSetup) return <Setup onDone={() => { setNeedsSetup(false); }} />;
  if (!user) return <Login onLogin={() => {}} />;

  function go(p: Page) {
    setPage(p);
    setDocId(null);
    setMenuOpen(false);
  }

  const isOwner = user.role === "OWNER";
  const mainPages: Page[] = ["items", "receive", "issue", "reports", ...(isOwner ? ["import" as Page] : [])];

  const navigateFn = (path: string) => {
    if (path.startsWith("/documents/")) {
      setDocId(Number(path.split("/").pop()));
      setPage("document");
    } else if (path === "/drafts") {
      go("drafts");
    } else {
      go("items");
    }
  };

  const roleLabel = isOwner ? "ผู้ดูแล" : "พนักงาน";

  return (
    <div className="min-h-screen bg-slate-50 overflow-x-hidden pb-[calc(72px+env(safe-area-inset-bottom))] md:pb-0">
      <nav className="bg-white border-b border-gray-200 shadow-sm px-4 md:px-6 flex items-center gap-1 print:hidden" style={{ minHeight: "52px" }}>
        <span className="font-extrabold text-lg mr-5" style={{ color: "#FF6200", letterSpacing: "-0.5px" }}>Stocki!</span>
        <div className="hidden md:flex items-center gap-1">
          {[...mainPages, "drafts" as Page, ...(isOwner ? ["users" as Page] : [])].map((p) => {
            const active = page === p;
            return (
              <button key={p} onClick={() => go(p)}
                className="text-sm px-3 flex items-center whitespace-nowrap transition-colors"
                style={{
                  height: "52px", fontWeight: active ? 700 : 400,
                  color: active ? "#FF6200" : "#4b5563",
                  borderBottom: active ? "2px solid #FF6200" : "2px solid transparent",
                }}>
                {LABELS[p]}
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-4 relative">
          <span className="hidden md:inline text-xs text-gray-400 whitespace-nowrap">{user.email} ({roleLabel})</span>
          {isOwner && (
            <button onClick={() => setShowReset(true)} className="hidden md:inline text-xs text-gray-500 hover:text-red-600 whitespace-nowrap min-h-[44px]">ล้างข้อมูลทั้งหมด</button>
          )}
          <button onClick={handleLogout} className="hidden md:inline text-xs text-red-500 hover:text-red-700 font-medium whitespace-nowrap min-h-[44px]">ออกจากระบบ</button>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="md:hidden flex items-center justify-center w-11 h-11 rounded-full bg-orange-50 text-orange-600 font-bold"
            aria-label="เมนูโปรไฟล์" aria-expanded={menuOpen}
          >
            {user.email.slice(0, 1).toUpperCase()}
          </button>
          {menuOpen && (
            <div className="md:hidden absolute right-0 top-12 z-50 w-64 bg-white border border-gray-200 rounded-xl shadow-lg py-2">
              <div className="px-4 py-2 text-xs text-gray-500 border-b border-gray-100 break-all">{user.email}<br />{roleLabel}</div>
              <button onClick={() => go("drafts")} className="w-full text-left px-4 min-h-[44px] text-sm hover:bg-gray-50">ดราฟ (เอกสารลงวันที่ล่วงหน้า)</button>
              {isOwner && (
                <button onClick={() => go("users")} className="w-full text-left px-4 min-h-[44px] text-sm hover:bg-gray-50">ผู้ใช้งาน (บัญชีพนักงาน)</button>
              )}
              {isOwner && (
                <button onClick={() => { setMenuOpen(false); setShowReset(true); }} className="w-full text-left px-4 min-h-[44px] text-sm text-red-600 hover:bg-red-50">ล้างข้อมูลทั้งหมด</button>
              )}
              <button onClick={handleLogout} className="w-full text-left px-4 min-h-[44px] text-sm text-red-500 hover:bg-red-50">ออกจากระบบ</button>
            </div>
          )}
        </div>
      </nav>
      <main>
        {page === "items" && <Items />}
        {page === "import" && isOwner && <Import />}
        {page === "receive" && <Receive navigate={navigateFn} />}
        {page === "issue" && <Issue navigate={navigateFn} />}
        {page === "reports" && <Reports />}
        {page === "drafts" && <Drafts navigate={navigateFn} />}
        {page === "users" && isOwner && <Users currentEmail={user.email} />}
        {page === "document" && !!docId && <DocumentDetail docId={docId} onBack={() => go("items")} />}
      </main>
      <footer className="print:hidden border-t border-gray-200 bg-white mt-8 text-xs text-gray-400">
        <div className="py-6 px-4 flex flex-wrap justify-center gap-6 border-b border-gray-100">
          {[
            { href: "https://www.marsmedia.co.th/barcode-101-what-is-barcode/", icon: "🔢", label: "Barcode 101", desc: "บาร์โค้ดคืออะไร?" },
            { href: "https://www.marsmedia.co.th/hardware/", icon: "📷", label: "เครื่องอ่านบาร์โค้ด", desc: "สแกนเนอร์ทุกรุ่น" },
            { href: "https://www.marsmedia.co.th/tsc-te-series-barcode-printer/", icon: "🖨️", label: "เครื่องพิมพ์ความร้อน", desc: "พิมพ์ฉลากบาร์โค้ด" },
            { href: "https://www.marsmedia.co.th/media/", icon: "🏷️", label: "สติกเกอร์ ริบบอน RFID", desc: "วัสดุสิ้นเปลือง" },
          ].map(({ href, icon, label, desc }) => (
            <a key={href} href={href} target="_blank" rel="noopener noreferrer"
              className="flex flex-col items-center gap-1 w-28 hover:opacity-70 transition-opacity no-underline text-gray-500">
              <span className="text-2xl">{icon}</span>
              <span className="font-semibold text-gray-700 text-center leading-tight">{label}</span>
              <span className="text-center leading-tight">{desc}</span>
            </a>
          ))}
        </div>
        <div className="py-3 px-4 text-center">
          <span style={{ color: "#FF6200", fontWeight: 700 }}>Stocki!</span> — ระบบสต็อกสินค้าโอเพ่นซอร์ส ฟรีตลอดชีพ
          <span className="mx-2">·</span>
          © 2026 Mars Media. สงวนลิขสิทธิ์.
        </div>
      </footer>

      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-gray-200 flex print:hidden pb-[env(safe-area-inset-bottom)]" aria-label="เมนูหลัก">
        {mainPages.map((p) => {
          const active = page === p;
          return (
            <button key={p} onClick={() => go(p)}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[56px] text-[11px] whitespace-nowrap"
              style={{ color: active ? "#FF6200" : "#6b7280", fontWeight: active ? 700 : 400 }}
              aria-current={active ? "page" : undefined}>
              <Icon page={p} />
              {SHORT[p] ?? LABELS[p]}
            </button>
          );
        })}
      </nav>

      {showReset && isOwner && <ResetDataDialog onClose={() => setShowReset(false)} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
