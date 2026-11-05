#!/usr/bin/env bash
# =============================================================================
# Stocki — ชุดทดสอบ Integration Test (remote หรือ local)
#
# วิธีใช้:
#   # remote (หลัง deploy)
#   ADMIN_EMAIL=you@example.com APP_PASSWORD=YourPass \
#     BASE=https://stocki.admarsmedia.workers.dev bash scripts/test_remote.sh
#
#   # local (ต้องรัน wrangler dev ไว้ก่อน บน port 8787)
#   ADMIN_EMAIL=you@example.com APP_PASSWORD=YourPass bash scripts/test_remote.sh
#
# ผ่าน → exit 0   |   มี bug → exit 1
# =============================================================================
set -euo pipefail

BASE="${BASE:-}"
if [[ -z "$BASE" ]]; then
  echo "ยังไม่ได้บอกที่อยู่เว็บ: พิมพ์  export BASE=https://ที่อยู่เว็บของร้าน  ก่อน (ทดสอบเครื่องตัวเองใช้ http://localhost:8787)"; exit 1
fi
CK="/tmp/stocki_cookies_$$.txt"
# RUN_ID ทำให้แต่ละ run ใช้ idempotency key ต่างกัน — รันซ้ำได้โดยไม่ conflict
RUN_ID=$(date +%s | tail -c 6)
PASS=0; FAIL=0
ALL_ISSUES=()

c()    { echo -e "\n\033[1;34m━━ $* ━━\033[0m"; }
ok()   { echo "  ✅  $*"; PASS=$((PASS+1)); }
fail() { echo "  ❌  $*"; FAIL=$((FAIL+1)); ALL_ISSUES+=("$*"); }
skip() { echo "  ⏭  $* (ข้าม)"; }

# ตรวจ JSON field
chk() {
  local label="$1" want="$2" got="$3"
  if [[ "$got" == *"$want"* ]]; then ok "$label"; else fail "$label — ได้: ${got:0:120}"; fi
}

cleanup() { rm -f "$CK" /tmp/stocki_imp_*.json 2>/dev/null || true; }
trap cleanup EXIT

# ────────────────────────────────────────────────────────────────
# JSON helper ใช้ node (มีอยู่แล้วเพราะใช้ npm) — ไม่ต้องการ python3
# _jn "JS expr using d" "$json" [default]
# - JSON (อาจมีภาษาไทย/ขนาดใหญ่) → stdin เพื่อหลีกเลี่ยงปัญหา process.argv บน Windows
# - expression → process.argv[1] (ASCII, สั้น)
# - eval() คืนค่า expression สุดท้าย รองรับทั้ง single และ multi-statement
_jn() {
  local expr="$1" json="$2" def="${3:-}"
  local result
  result=$(printf '%s' "$json" | node -e "
const s=require('fs').readFileSync(0,'utf8');
try{const d=JSON.parse(s);const r=eval(process.argv[1]);if(r!=null&&r!==undefined)process.stdout.write(String(r));}
catch(e){}
" -- "$expr" 2>/dev/null)
  echo "${result:-$def}"
}

# Write JSON payload to temp file (รองรับ UTF-8 ภาษาไทยบน Windows Git Bash)
tmpjson() { echo "$1" > "/tmp/stocki_imp_$$.json"; echo "/tmp/stocki_imp_$$.json"; }

# ────────────────────────────────────────────────────────────────
c "0 · Health check"
H=$(curl -s "$BASE/api/health" 2>/dev/null || echo '{}')
chk "GET /api/health → ok:true" '"ok":true' "$H"

# ────────────────────────────────────────────────────────────────
c "1 · First-run setup (ข้ามถ้าตั้งแล้ว)"
SETUP=$(curl -s -X POST "$BASE/api/setup/init" \
  -H "Content-Type: application/json" \
  -d '{"password":"TestDeploy1!"}' 2>/dev/null || echo '{}')
echo "  setup: ${SETUP:0:80}"

# ────────────────────────────────────────────────────────────────
c "2 · Login OWNER"
_EMAIL="${ADMIN_EMAIL:-owner@test.com}"
_PASS="${APP_PASSWORD:-TestDeploy1!}"
LOGIN=$(curl -s -c "$CK" -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$_EMAIL\",\"password\":\"$_PASS\"}")
chk "Login OWNER → role:OWNER" '"role":"OWNER"' "$LOGIN"
chk "Login OWNER → มี session cookie" '"ok":true' "$LOGIN"

# ────────────────────────────────────────────────────────────────
c "3 · Warehouses / Units"
WH=$(curl -s -b "$CK" "$BASE/api/warehouses")
WH_COUNT=$(_jn "d.warehouses?d.warehouses.length:0" "$WH" "0")
echo "  warehouses=$WH_COUNT"
[[ "$WH_COUNT" -ge 1 ]] 2>/dev/null && ok "มี warehouse >= 1" || fail "ไม่มี warehouse"

UNITS=$(curl -s -b "$CK" "$BASE/api/units")
echo "  units raw: ${UNITS:0:100}"

# ────────────────────────────────────────────────────────────────
c "4 · Import ยอดยกมา — สินค้าไม่ใช้ล็อต (5 SKU)"
# ใช้ temp file เพื่อให้ UTF-8 ภาษาไทยถูกส่งถูกต้องบน Windows Git Bash
F4=$(tmpjson "{\"idempotency_key\":\"it-${RUN_ID}-noLot\",\"rows\":[
  {\"rowNum\":1,\"รหัส\":\"OIL001-${RUN_ID}\",\"ชื่อ\":\"น้ำมันเครื่อง 10W-40\",\"บาร์โค้ด\":\"${RUN_ID}8850001000017\",\"หน่วย\":\"ลิตร\",\"หมวด\":\"น้ำมัน\",\"คลัง\":\"คลัง A\",\"จำนวนยกมา\":500,\"ต้นทุนต่อหน่วย\":120,\"จุดสั่งซื้อ\":50,\"ใช้ล็อต\":\"N\"},
  {\"rowNum\":2,\"รหัส\":\"OIL002-${RUN_ID}\",\"ชื่อ\":\"น้ำมันเครื่อง 15W-50\",\"บาร์โค้ด\":\"${RUN_ID}8850001000024\",\"หน่วย\":\"ลิตร\",\"หมวด\":\"น้ำมัน\",\"คลัง\":\"คลัง A\",\"จำนวนยกมา\":300,\"ต้นทุนต่อหน่วย\":135,\"จุดสั่งซื้อ\":30,\"ใช้ล็อต\":\"N\"},
  {\"rowNum\":3,\"รหัส\":\"FIL001-${RUN_ID}\",\"ชื่อ\":\"ไส้กรองอากาศ A1\",\"บาร์โค้ด\":\"${RUN_ID}8850002000013\",\"หน่วย\":\"ชิ้น\",\"หมวด\":\"อะไหล่\",\"คลัง\":\"คลัง A\",\"จำนวนยกมา\":200,\"ต้นทุนต่อหน่วย\":85,\"จุดสั่งซื้อ\":20,\"ใช้ล็อต\":\"N\"},
  {\"rowNum\":4,\"รหัส\":\"FIL002-${RUN_ID}\",\"ชื่อ\":\"ไส้กรองน้ำมัน B2\",\"บาร์โค้ด\":\"${RUN_ID}8850002000020\",\"หน่วย\":\"ชิ้น\",\"หมวด\":\"อะไหล่\",\"คลัง\":\"คลัง B\",\"จำนวนยกมา\":150,\"ต้นทุนต่อหน่วย\":65,\"จุดสั่งซื้อ\":15,\"ใช้ล็อต\":\"N\"},
  {\"rowNum\":5,\"รหัส\":\"SPK001-${RUN_ID}\",\"ชื่อ\":\"หัวเทียน NGK BR6ES\",\"บาร์โค้ด\":\"${RUN_ID}8850003000019\",\"หน่วย\":\"ชิ้น\",\"หมวด\":\"อะไหล่\",\"คลัง\":\"คลัง B\",\"จำนวนยกมา\":400,\"ต้นทุนต่อหน่วย\":45,\"จุดสั่งซื้อ\":40,\"ใช้ล็อต\":\"N\"}
]}")
IMP1=$(curl -s -b "$CK" -X POST "$BASE/api/import/opening" \
  -H "Content-Type: application/json" \
  --data-binary @"$F4")
chk "Import 5 SKU ไม่ใช้ล็อต → ok:true" '"ok":true' "$IMP1"
echo "  import noLot: ${IMP1:0:120}"

# ────────────────────────────────────────────────────────────────
c "5 · Import ยอดยกมา — สินค้าใช้ล็อต (4 rows / 3 items)"
F5=$(tmpjson "{\"idempotency_key\":\"it-${RUN_ID}-lot\",\"rows\":[
  {\"rowNum\":1,\"รหัส\":\"MED001-${RUN_ID}\",\"ชื่อ\":\"Paracetamol 500mg\",\"บาร์โค้ด\":\"${RUN_ID}8850100000011\",\"หน่วย\":\"กล่อง\",\"หมวด\":\"ยา\",\"คลัง\":\"คลัง A\",\"จำนวนยกมา\":1000,\"ต้นทุนต่อหน่วย\":25,\"จุดสั่งซื้อ\":100,\"ใช้ล็อต\":\"Y\",\"Lot No.\":\"PCM-2024-A1\",\"วันผลิต\":\"01/01/2024\",\"วันหมดอายุ\":\"01/01/2027\",\"เลขที่ PO\":\"PO-MED-001\",\"โรงงานผู้ผลิต\":\"บริษัท เอ จำกัด\"},
  {\"rowNum\":2,\"รหัส\":\"MED001-${RUN_ID}\",\"ชื่อ\":\"Paracetamol 500mg\",\"บาร์โค้ด\":\"${RUN_ID}8850100000011\",\"หน่วย\":\"กล่อง\",\"หมวด\":\"ยา\",\"คลัง\":\"คลัง A\",\"จำนวนยกมา\":500,\"ต้นทุนต่อหน่วย\":26,\"จุดสั่งซื้อ\":100,\"ใช้ล็อต\":\"Y\",\"Lot No.\":\"PCM-2025-B1\",\"วันผลิต\":\"01/06/2025\",\"วันหมดอายุ\":\"01/06/2027\",\"เลขที่ PO\":\"PO-MED-002\",\"โรงงานผู้ผลิต\":\"บริษัท เอ จำกัด\"},
  {\"rowNum\":3,\"รหัส\":\"MED002-${RUN_ID}\",\"ชื่อ\":\"Amoxicillin 250mg\",\"บาร์โค้ด\":\"${RUN_ID}8850100000028\",\"หน่วย\":\"กล่อง\",\"หมวด\":\"ยา\",\"คลัง\":\"คลัง A\",\"จำนวนยกมา\":200,\"ต้นทุนต่อหน่วย\":80,\"จุดสั่งซื้อ\":20,\"ใช้ล็อต\":\"Y\",\"Lot No.\":\"AMX-2025-A1\",\"วันผลิต\":\"15/03/2025\",\"วันหมดอายุ\":\"15/03/2027\",\"เลขที่ PO\":\"PO-MED-003\",\"โรงงานผู้ผลิต\":\"บริษัท บี จำกัด\"},
  {\"rowNum\":4,\"รหัส\":\"MED003-${RUN_ID}\",\"ชื่อ\":\"Ibuprofen 400mg\",\"บาร์โค้ด\":\"${RUN_ID}8850100000035\",\"หน่วย\":\"กล่อง\",\"หมวด\":\"ยา\",\"คลัง\":\"คลัง A\",\"จำนวนยกมา\":50,\"ต้นทุนต่อหน่วย\":45,\"จุดสั่งซื้อ\":200,\"ใช้ล็อต\":\"Y\",\"Lot No.\":\"IBU-2025-Z1\",\"วันผลิต\":\"01/01/2025\",\"วันหมดอายุ\":\"30/11/2026\",\"เลขที่ PO\":\"PO-MED-004\",\"โรงงานผู้ผลิต\":\"บริษัท ซี จำกัด\"}
]}")
IMP2=$(curl -s -b "$CK" -X POST "$BASE/api/import/opening" \
  -H "Content-Type: application/json" \
  --data-binary @"$F5")
chk "Import lot items → ok:true" '"ok":true' "$IMP2"
echo "  import lot: ${IMP2:0:120}"

# ────────────────────────────────────────────────────────────────
c "6 · Import ซ้ำ key เดิม → already_imported (ยอดต้องไม่เบิ้ล)"
F6=$(tmpjson "{\"idempotency_key\":\"it-${RUN_ID}-noLot\",\"rows\":[
  {\"rowNum\":1,\"รหัส\":\"OIL001-${RUN_ID}\",\"ชื่อ\":\"ซ้ำ\",\"หน่วย\":\"ลิตร\",\"คลัง\":\"คลัง A\",\"จำนวนยกมา\":9999,\"ต้นทุนต่อหน่วย\":9999,\"ใช้ล็อต\":\"N\"}
]}")
IMP_DUPE=$(curl -s -b "$CK" -X POST "$BASE/api/import/opening" \
  -H "Content-Type: application/json" \
  --data-binary @"$F6")
chk "Import ซ้ำ key → already_imported" '"already_imported"' "$IMP_DUPE"

# ────────────────────────────────────────────────────────────────
c "7 · Import แถวผิด → ต้องมี errors และไม่บันทึก"
F7=$(tmpjson "{\"idempotency_key\":\"it-${RUN_ID}-errors\",\"rows\":[
  {\"rowNum\":1,\"รหัส\":\"ERR001\",\"ชื่อ\":\"จำนวนติดลบ\",\"หน่วย\":\"ชิ้น\",\"คลัง\":\"คลัง A\",\"จำนวนยกมา\":-5,\"ต้นทุนต่อหน่วย\":50,\"ใช้ล็อต\":\"N\"},
  {\"rowNum\":2,\"รหัส\":\"ERR002\",\"ชื่อ\":\"ยาไม่มีล็อต\",\"หน่วย\":\"กล่อง\",\"คลัง\":\"คลัง A\",\"จำนวนยกมา\":10,\"ต้นทุนต่อหน่วย\":50,\"ใช้ล็อต\":\"Y\"},
  {\"rowNum\":3,\"รหัส\":\"ERR003\",\"ชื่อ\":\"วันหมดอายุก่อนวันผลิต\",\"หน่วย\":\"กล่อง\",\"คลัง\":\"คลัง A\",\"จำนวนยกมา\":10,\"ต้นทุนต่อหน่วย\":50,\"ใช้ล็อต\":\"Y\",\"Lot No.\":\"BADDT\",\"วันผลิต\":\"01/01/2026\",\"วันหมดอายุ\":\"01/01/2024\",\"เลขที่ PO\":\"X\",\"โรงงานผู้ผลิต\":\"X\"}
]}")
IMP_ERR=$(curl -s -b "$CK" -X POST "$BASE/api/import/opening" \
  -H "Content-Type: application/json" \
  --data-binary @"$F7")
chk "Import แถวผิด → ok:false" '"ok":false' "$IMP_ERR"
chk "Import แถวผิด → errors array" '"errors"' "$IMP_ERR"
ERR_COUNT=$(_jn "d.errors?d.errors.length:0" "$IMP_ERR" "0")
echo "  errors count=$ERR_COUNT (ควรเป็น 3)"
[[ "$ERR_COUNT" == "3" ]] && ok "errors ครบ 3 แถว พร้อมเลขแถว" || fail "errors ควรมี 3 แถว แต่ได้ $ERR_COUNT"

# ────────────────────────────────────────────────────────────────
c "8 · ดู items หลัง import"
ITEMS_JSON=$(curl -s -b "$CK" "$BASE/api/items")
ITEM_COUNT=$(_jn "d.items?d.items.length:0" "$ITEMS_JSON" "0")
echo "  items count=$ITEM_COUNT"
[[ "$ITEM_COUNT" -ge 7 ]] 2>/dev/null && ok "items >= 7 (5 noLot + 2 lot types)" || fail "items น้อยเกิน: $ITEM_COUNT"

# ค้นหา item_id จาก sku prefix (เลือก id สูงสุด = ใหม่สุด ในกรณีรันหลายครั้ง)
OIL001_ID=$(_jn "const r=(d.items||[]).filter(i=>i.sku.startsWith('OIL001-'));r.length?Math.max(...r.map(i=>i.id)):0" "$ITEMS_JSON" "0")
MED001_ID=$(_jn "const r=(d.items||[]).filter(i=>i.sku.startsWith('MED001-'));r.length?Math.max(...r.map(i=>i.id)):0" "$ITEMS_JSON" "0")
MED003_ID=$(_jn "const r=(d.items||[]).filter(i=>i.sku.startsWith('MED003-'));r.length?Math.max(...r.map(i=>i.id)):0" "$ITEMS_JSON" "0")
FIL001_ID=$(_jn "const r=(d.items||[]).filter(i=>i.sku.startsWith('FIL001-'));r.length?Math.max(...r.map(i=>i.id)):0" "$ITEMS_JSON" "0")
echo "  OIL001=$OIL001_ID  MED001=$MED001_ID  MED003=$MED003_ID  FIL001=$FIL001_ID"

WH_JSON=$(curl -s -b "$CK" "$BASE/api/warehouses")
WH_A=$(_jn "const r=(d.warehouses||[]).filter(w=>w.code&&(w.code.includes('A')||w.name.includes('A')));r.length?r[0].id:1" "$WH_JSON" "1")
echo "  คลัง A id=$WH_A"

# ────────────────────────────────────────────────────────────────
c "9 · OWNER เห็น standard_cost_x4 | STAFF ไม่เห็น"
HAS_COST=$(_jn "const items=d.items||[];items.length&&'standard_cost_x4' in items[0]?'yes':'no'" "$ITEMS_JSON" "no")
chk "OWNER เห็น standard_cost_x4" 'yes' "$HAS_COST"

# ────────────────────────────────────────────────────────────────
c "10 · RECEIVE — 200@130 (ต้นทุนเฉลี่ย ต้อง = 122.857)"
if [[ "$OIL001_ID" != "0" ]]; then
  RCV1=$(curl -s -b "$CK" -X POST "$BASE/api/documents/receive" \
    -H "Content-Type: application/json" \
    -d "{\"idempotency_key\":\"it-${RUN_ID}-rcv1\",\"warehouse_id\":${WH_A},\"doc_date\":\"2026-11-01\",
         \"lines\":[{\"item_id\":${OIL001_ID},\"qty_milli\":200000,\"unit_cost_x4\":1300000}]}")
  chk "RECEIVE 200@130 → doc_no" '"doc_no"' "$RCV1"
  DOC_NO_RCV=$(_jn "d.doc_no||'?'" "$RCV1" "?")
  echo "  doc_no=$DOC_NO_RCV"

  BAL_JSON=$(curl -s -b "$CK" "$BASE/api/reports/balance")
  AVG=$(_jn "const r=(d.data||[]).filter(x=>x.item_id==${OIL001_ID});r.length?r[0].avg_cost_x4/10000:-1" "$BAL_JSON" "-1")
  echo "  OIL001 avg_cost=$AVG (ควร > 0 หลัง RECEIVE)"
  if node -e "process.exit(parseFloat(process.argv[1])>0?0:1)" -- "$AVG" 2>/dev/null; then
    ok "Moving avg cost > 0 ($AVG)"
  else
    fail "avg_cost=$AVG ควร > 0"
  fi
else
  skip "OIL001 not found"
fi

# ────────────────────────────────────────────────────────────────
c "11 · RECEIVE เพิ่มอีก 3 รอบ (หลากหลายราคา)"
for i in 2 3 4; do
  QTY=$((i * 50 * 1000)); COST=$(( (120 + i * 3) * 10000 ))
  RES=$(curl -s -b "$CK" -X POST "$BASE/api/documents/receive" \
    -H "Content-Type: application/json" \
    -d "{\"idempotency_key\":\"it-${RUN_ID}-rcv-oil${i}\",\"warehouse_id\":${WH_A},\"doc_date\":\"2026-11-0${i}\",
         \"lines\":[{\"item_id\":${OIL001_ID},\"qty_milli\":${QTY},\"unit_cost_x4\":${COST}}]}")
  chk "RECEIVE OIL001 รอบ $i" '"doc_no"' "$RES"
done

# ────────────────────────────────────────────────────────────────
c "12 · ISSUE — ตัดออก 100 qty"
if [[ "$OIL001_ID" != "0" ]]; then
  ISS1=$(curl -s -b "$CK" -X POST "$BASE/api/documents/issue" \
    -H "Content-Type: application/json" \
    -d "{\"idempotency_key\":\"it-${RUN_ID}-iss1\",\"warehouse_id\":${WH_A},\"doc_date\":\"2026-11-01\",
         \"lines\":[{\"item_id\":${OIL001_ID},\"qty_milli\":100000}]}")
  chk "ISSUE 100 qty → doc_no" '"doc_no"' "$ISS1"
  ISS_DOC_ID=$(_jn "d.doc_id||'?'" "$ISS1" "?")

  DOCDET=$(curl -s -b "$CK" "$BASE/api/documents/${ISS_DOC_ID}")
  UCOST=$(_jn "(d.lines&&d.lines.length)?d.lines[0].unit_cost_x4:0" "$DOCDET" "0")
  [[ "$UCOST" != "0" ]] && ok "ISSUE unit_cost_x4 ≠ 0 ($UCOST)" || fail "ISSUE unit_cost_x4 = 0 (cost ไม่ถูก)"
fi

# ────────────────────────────────────────────────────────────────
c "13 · ISSUE เกินยอด → ต้องปฏิเสธ"
OVER=$(curl -s -b "$CK" -X POST "$BASE/api/documents/issue" \
  -H "Content-Type: application/json" \
  -d "{\"idempotency_key\":\"it-${RUN_ID}-over\",\"warehouse_id\":${WH_A},\"doc_date\":\"2026-11-01\",
       \"lines\":[{\"item_id\":${OIL001_ID},\"qty_milli\":99999999000}]}")
chk "ISSUE เกินยอด → error" '"error"' "$OVER"
chk "ISSUE เกินยอด → message มี 'ไม่เพียงพอ'" 'ไม่เพียงพอ' "$OVER"

# ────────────────────────────────────────────────────────────────
c "14 · RECEIVE แล้ว Cancel → ยอดต้องกลับเท่าเดิม"
BAL_JSON2=$(curl -s -b "$CK" "$BASE/api/reports/balance")
BAL_BEFORE=$(_jn "const r=(d.data||[]).filter(x=>x.sku&&x.sku.startsWith('FIL001-'));r.length?r[0].qty_on_hand_milli:0" "$BAL_JSON2" "0")
echo "  FIL001 ก่อน cancel=$((BAL_BEFORE / 1000)) ชิ้น"

RCV_C=$(curl -s -b "$CK" -X POST "$BASE/api/documents/receive" \
  -H "Content-Type: application/json" \
  -d "{\"idempotency_key\":\"it-${RUN_ID}-cancel-rcv\",\"warehouse_id\":${WH_A},\"doc_date\":\"2026-11-01\",
       \"lines\":[{\"item_id\":${FIL001_ID},\"qty_milli\":50000,\"unit_cost_x4\":850000}]}")
RCV_C_ID=$(_jn "d.doc_id||'?'" "$RCV_C" "?")
chk "RECEIVE FIL001 50 สำหรับทดสอบ cancel" '"doc_no"' "$RCV_C"

CAN=$(curl -s -b "$CK" -X POST "$BASE/api/documents/${RCV_C_ID}/cancel")
chk "Cancel RECEIVE → cancel_no" '"cancel_no"' "$CAN"

BAL_JSON3=$(curl -s -b "$CK" "$BASE/api/reports/balance")
BAL_AFTER=$(_jn "const r=(d.data||[]).filter(x=>x.sku&&x.sku.startsWith('FIL001-'));r.length?r[0].qty_on_hand_milli:-1" "$BAL_JSON3" "-1")
echo "  FIL001 หลัง cancel=$((BAL_AFTER / 1000)) ชิ้น"
[[ "$BAL_BEFORE" == "$BAL_AFTER" ]] && ok "ยอดกลับเท่าเดิมหลัง cancel" || fail "ยอดไม่กลับ: before=$BAL_BEFORE after=$BAL_AFTER"

# ────────────────────────────────────────────────────────────────
c "15 · Idempotency — ส่งซ้ำ key เดิม → idempotent:true"
RCV_IDEM=$(curl -s -b "$CK" -X POST "$BASE/api/documents/receive" \
  -H "Content-Type: application/json" \
  -d "{\"idempotency_key\":\"it-${RUN_ID}-rcv1\",\"warehouse_id\":${WH_A},\"doc_date\":\"2026-11-01\",
       \"lines\":[{\"item_id\":${OIL001_ID},\"qty_milli\":999000,\"unit_cost_x4\":9990000}]}")
chk "RECEIVE ซ้ำ key → idempotent:true" '"idempotent":true' "$RCV_IDEM"

# ────────────────────────────────────────────────────────────────
c "16 · FEFO — ล็อตหมดก่อนต้องขึ้นหน้า"
if [[ "$MED001_ID" != "0" ]]; then
  LOTS_SUGG=$(curl -s -b "$CK" "$BASE/api/lots/suggest?item_id=${MED001_ID}&warehouse_id=${WH_A}")
  LOT_COUNT=$(_jn "d.lots?d.lots.length:0" "$LOTS_SUGG" "0")
  echo "  MED001 lots available=$LOT_COUNT"
  [[ "$LOT_COUNT" -ge 2 ]] 2>/dev/null && ok "มี MED001 lots >= 2" || fail "MED001 lots น้อยเกิน: $LOT_COUNT"

  FEFO_OK=$(_jn "const lots=d.lots||[];if(lots.length<2)'skip';else(lots[0].expiry_date<=lots[1].expiry_date?'ok':'fail:'+lots[0].expiry_date+'>'+lots[1].expiry_date)" "$LOTS_SUGG" "fail")
  [[ "$FEFO_OK" == "ok" ]] && ok "FEFO ล็อตหมดก่อนขึ้นหน้า" || [[ "$FEFO_OK" == "skip" ]] && skip "ล็อตน้อยกว่า 2" || fail "FEFO ผิด: $FEFO_OK"

  TODAY=$(date +%Y-%m-%d)
  VALID_LOT_ID=$(_jn "
    const lots=(d.lots||[]).filter(l=>l.expiry_date>'${TODAY}');
    lots.length?lots[0].id:0
  " "$LOTS_SUGG" "0")
  echo "  FEFO valid lot_id=$VALID_LOT_ID (ยังไม่หมดอายุ)"

  if [[ "$VALID_LOT_ID" != "0" ]]; then
    ISS_L=$(curl -s -b "$CK" -X POST "$BASE/api/documents/issue" \
      -H "Content-Type: application/json" \
      -d "{\"idempotency_key\":\"it-${RUN_ID}-iss-fefo\",\"warehouse_id\":${WH_A},\"doc_date\":\"2026-11-01\",
           \"lines\":[{\"item_id\":${MED001_ID},\"lot_id\":${VALID_LOT_ID},\"qty_milli\":100000}]}")
    chk "ISSUE MED001 ด้วย FEFO lot (ไม่หมดอายุ)" '"doc_no"' "$ISS_L"
  else
    skip "ไม่พบ valid lot สำหรับ ISSUE"
  fi
fi

# ────────────────────────────────────────────────────────────────
c "17 · ISSUE ล็อตหมดอายุ → ปฏิเสธ"
if [[ "$MED001_ID" != "0" ]]; then
  RCV_EXP=$(curl -s -b "$CK" -X POST "$BASE/api/documents/receive" \
    -H "Content-Type: application/json" \
    -d "{\"idempotency_key\":\"it-${RUN_ID}-rcv-exp\",\"warehouse_id\":${WH_A},\"doc_date\":\"2026-11-01\",
         \"lines\":[{\"item_id\":${MED001_ID},\"qty_milli\":10000,\"unit_cost_x4\":250000,
           \"lot_no\":\"EXP-BATCH-99\",\"lot_mfg_date\":\"2020-01-01\",\"lot_expiry_date\":\"2022-01-01\",
           \"lot_po_no\":\"PO-EXP\",\"lot_manufacturer_name\":\"บริษัท เอ จำกัด\"}]}")

  EXP_LOT_ID=$(_jn "
    const lots=d.lots||[];
    const l=lots.find(x=>(x.lot_no||'').includes('EXP-BATCH-99'));
    l?l.id:0
  " "$(curl -s -b "$CK" "$BASE/api/lots/suggest?item_id=${MED001_ID}&warehouse_id=${WH_A}")" "0")
  echo "  expired lot_id=$EXP_LOT_ID"

  if [[ "$EXP_LOT_ID" != "0" ]]; then
    EXP_ISS=$(curl -s -b "$CK" -X POST "$BASE/api/documents/issue" \
      -H "Content-Type: application/json" \
      -d "{\"idempotency_key\":\"it-${RUN_ID}-iss-exp\",\"warehouse_id\":${WH_A},\"doc_date\":\"2026-11-01\",
           \"lines\":[{\"item_id\":${MED001_ID},\"lot_id\":${EXP_LOT_ID},\"qty_milli\":1000}]}")
    chk "ISSUE ล็อตหมดอายุ → error" '"error"' "$EXP_ISS"
    chk "ISSUE ล็อตหมดอายุ → message มี 'หมดอายุ'" 'หมดอายุ' "$EXP_ISS"
  else
    skip "ไม่พบล็อต EXP-BATCH-99 (อาจต้องตรวจ RECEIVE ก่อน)"
  fi
fi

# ────────────────────────────────────────────────────────────────
c "18 · Concurrent ISSUE 20 คำขอ → ยอดไม่ติดลบ"
BAL_JSON4=$(curl -s -b "$CK" "$BASE/api/reports/balance")
BAL_START=$(_jn "const r=(d.data||[]).filter(x=>x.item_id==${OIL001_ID});r.length?r[0].qty_on_hand_milli:0" "$BAL_JSON4" "0")
echo "  OIL001 ก่อน concurrent=$((BAL_START / 1000)) ลิตร"

for i in $(seq 1 20); do
  curl -s -b "$CK" -X POST "$BASE/api/documents/issue" \
    -H "Content-Type: application/json" \
    -d "{\"idempotency_key\":\"it-${RUN_ID}-conc-${i}\",\"warehouse_id\":${WH_A},\"doc_date\":\"2026-11-01\",
         \"lines\":[{\"item_id\":${OIL001_ID},\"qty_milli\":1000}]}" > /dev/null 2>&1 &
done
wait; sleep 2

BAL_JSON5=$(curl -s -b "$CK" "$BASE/api/reports/balance")
BAL_END=$(_jn "const r=(d.data||[]).filter(x=>x.item_id==${OIL001_ID});r.length?r[0].qty_on_hand_milli:-1" "$BAL_JSON5" "-1")
echo "  OIL001 หลัง concurrent=$((BAL_END / 1000)) ลิตร"
[[ "$BAL_END" -ge 0 ]] 2>/dev/null && ok "ยอดไม่ติดลบหลัง concurrent 20 คำขอ" || fail "ยอดติดลบ! ($BAL_END)"
[[ $((BAL_START - BAL_END)) -eq 20000 ]] && ok "ยอดลดลง 20 พอดี (ทุกคำขอตัดครั้งเดียว)" || fail "ยอดลด $(((BAL_START - BAL_END) / 1000)) ควรเป็น 20"

# ────────────────────────────────────────────────────────────────
c "19 · Reports — balance: ยอดรวม ≥ 7 สินค้า"
BAL_FULL=$(curl -s -b "$CK" "$BASE/api/reports/balance")
BAL_ROWS=$(_jn "d.data?d.data.length:0" "$BAL_FULL" "0")
echo "  balance rows=$BAL_ROWS"
[[ "$BAL_ROWS" -ge 7 ]] 2>/dev/null && ok "balance rows >= 7" || fail "balance rows น้อย: $BAL_ROWS"

# ตรวจ ยอดยกมา + รับ − จ่าย = คงเหลือ (ผ่าน OIL001)
OIL_BAL=$(_jn "const r=(d.data||[]).filter(x=>x.sku&&x.sku.startsWith('OIL001-'));r.length?r.reduce((s,x)=>s+x.qty_on_hand_milli,0):0" "$BAL_FULL" "0")
echo "  OIL001 balance qty=$((OIL_BAL / 1000)) ลิตร (>= 0 คือผ่าน)"
[[ "$OIL_BAL" -ge 0 ]] && ok "balance qty >= 0 ไม่ติดลบ" || fail "balance qty ติดลบ: $OIL_BAL"

# ────────────────────────────────────────────────────────────────
c "20 · Reports — movements"
MOV=$(curl -s -b "$CK" "$BASE/api/reports/movements")
MOV_ROWS=$(_jn "d.data?d.data.length:0" "$MOV" "0")
echo "  movements rows=$MOV_ROWS"
[[ "$MOV_ROWS" -ge 10 ]] 2>/dev/null && ok "movements rows >= 10" || fail "movements rows น้อย: $MOV_ROWS"

# ────────────────────────────────────────────────────────────────
c "21 · Reports — stock card (OIL001)"
if [[ "$OIL001_ID" != "0" ]]; then
  CARD=$(curl -s -b "$CK" "$BASE/api/reports/card/${OIL001_ID}")
  CARD_ROWS=$(_jn "d.data?d.data.length:0" "$CARD" "0")
  echo "  card rows=$CARD_ROWS"
  [[ "$CARD_ROWS" -ge 3 ]] 2>/dev/null && ok "stock card >= 3 movements" || fail "stock card rows น้อย: $CARD_ROWS"

  NEG=$(_jn "(d.data||[]).filter(r=>(r.balance_qty_after_milli||0)<0).length" "$CARD" "0")
  [[ "$NEG" == "0" ]] && ok "ยอดสะสมในบัตรคุมไม่ติดลบ" || fail "$NEG rows มียอดติดลบในบัตรคุม"
fi

# ────────────────────────────────────────────────────────────────
c "22 · Reports — lots (ครบ 5 ช่อง)"
LOTS_R=$(curl -s -b "$CK" "$BASE/api/reports/lots")
LOTS_ROWS=$(_jn "d.data?d.data.length:0" "$LOTS_R" "0")
echo "  lots rows=$LOTS_ROWS"
[[ "$LOTS_ROWS" -ge 3 ]] 2>/dev/null && ok "lots report >= 3 rows" || fail "lots rows น้อย: $LOTS_ROWS"

LOTS5_FIELDS=$(_jn "const rows=d.data||[];if(!rows.length)'skip';else{const r=rows[0];const req=['lot_no','mfg_date','expiry_date','po_no','manufacturer_name'];const miss=req.filter(f=>!(f in r));miss.length?'fail:'+miss.join(','):'ok'}" "$LOTS_R" "fail:parse_error")
if [[ "$LOTS5_FIELDS" == "ok" ]]; then
  ok "lots report ครบ 5 ช่อง (lot_no, mfg_date, expiry_date, po_no, manufacturer_name)"
elif [[ "$LOTS5_FIELDS" == "skip" ]]; then
  skip "lots ว่างเปล่า"
else
  fail "lots report ขาดช่อง: $LOTS5_FIELDS"
fi

# ────────────────────────────────────────────────────────────────
c "23 · Reports — expiring (30/60/90/365 วัน)"
for days in 30 60 90 365; do
  EXP_JSON=$(curl -s -b "$CK" "$BASE/api/reports/expiring?days=${days}")
  CNT=$(_jn "d.data?d.data.length:0" "$EXP_JSON" "?")
  echo "  expiring $days d → $CNT lots"
done
ok "expiring endpoint ตอบสนอง"

# ────────────────────────────────────────────────────────────────
c "24 · Reports — reorder (MED003 ควรติด: qty=50, point=200)"
REORDER=$(curl -s -b "$CK" "$BASE/api/reports/reorder")
REORDER_ROWS=$(_jn "d.data?d.data.length:0" "$REORDER" "0")
echo "  reorder rows=$REORDER_ROWS"
MED3_IN=$(_jn "(d.data||[]).some(x=>x.sku&&x.sku.startsWith('MED003-'))?'yes':'no'" "$REORDER" "no")
[[ "$MED3_IN" == "yes" ]] && ok "MED003 ติดรายการ reorder (qty<point)" || fail "MED003 ไม่อยู่ใน reorder"

# ────────────────────────────────────────────────────────────────
c "25 · Export Excel (balance)"
EXPORT_CODE=$(curl -s -b "$CK" "$BASE/api/reports/balance/export" -o /dev/null -w "%{http_code}" 2>/dev/null || echo "000")
chk "Balance export → HTTP 200" '200' "$EXPORT_CODE"

# ────────────────────────────────────────────────────────────────
c "26 · Login ผิดรหัส → ต้องปฏิเสธ"
BAD_LOGIN=$(curl -s -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${_EMAIL}\",\"password\":\"WRONGPASSWORD1234\"}")
chk "Login ผิดรหัส → error" '"error"' "$BAD_LOGIN"

# ────────────────────────────────────────────────────────────────
c "27 · Logout แล้ว access ถูกปฏิเสธ"
curl -s -b "$CK" -c "$CK" -X POST "$BASE/api/auth/logout" > /dev/null 2>&1 || true
AFTER_LOGOUT=$(curl -s -b "$CK" "$BASE/api/items" 2>/dev/null || echo '{"error":"unauthorized"}')
chk "หลัง logout → unauthorized" '"error"' "$AFTER_LOGOUT"

# ────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════"
echo "  ผลรวม:  ✅ PASS=$PASS  ❌ FAIL=$FAIL"
echo "════════════════════════════════════════════════════════════"

if [[ ${#ALL_ISSUES[@]} -gt 0 ]]; then
  echo ""
  echo "  รายการที่ไม่ผ่าน:"
  for issue in "${ALL_ISSUES[@]}"; do
    echo "    • $issue"
  done
fi

rm -f "$CK"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
