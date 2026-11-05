#!/usr/bin/env bash
# =============================================================================
# Stocki — Seed ข้อมูลตัวอย่าง ร้านเมล็ดพันธุ์และถั่วเพื่อสุขภาพ
#
# วิธีใช้:
#   ADMIN_EMAIL=you@example.com APP_PASSWORD='Pass123!' \
#     BASE=https://stocki.admarsmedia.workers.dev bash scripts/seed_remote.sh
#
# Idempotent: ใช้ key ขึ้นต้น seed-nuts-v1- รันซ้ำไม่เบิ้ล
# =============================================================================
set -euo pipefail

BASE="${BASE:-}"
if [[ -z "$BASE" ]]; then
  echo "ยังไม่ได้บอกที่อยู่เว็บ: พิมพ์  export BASE=https://ที่อยู่เว็บของร้าน  ก่อน (ทดสอบเครื่องตัวเองใช้ http://localhost:8787)"; exit 1
fi
CK="/tmp/stocki_seed_$$.txt"
PASS=0; FAIL=0

c()    { echo -e "\n\033[1;34m━━ $* ━━\033[0m"; }
ok()   { echo "  ✅  $*"; PASS=$((PASS+1)); }
fail() { echo "  ❌  $*"; FAIL=$((FAIL+1)); }
info() { echo "  ℹ️   $*"; }

chk() {
  local label="$1" want="$2" got="$3"
  if [[ "$got" == *"$want"* ]]; then ok "$label"
  elif [[ "$got" == *"already_imported"* ]]; then ok "$label (already seeded)"
  else fail "$label — ${got:0:120}"; fi
}

cleanup() { rm -f "$CK" /tmp/stocki_seed_*.json 2>/dev/null || true; }
trap cleanup EXIT

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

tmpjson() { printf '%s' "$1" > "/tmp/stocki_seed_$$.json"; echo "/tmp/stocki_seed_$$.json"; }

# ────────────────────────────────────────────────────────────────
c "เข้าสู่ระบบ"
_EMAIL="${ADMIN_EMAIL:-owner@test.com}"
_PASS="${APP_PASSWORD:-TestDeploy1!}"
LOGIN=$(curl -s -c "$CK" -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$_EMAIL\",\"password\":\"$_PASS\"}")
chk "Login" '"role":"OWNER"' "$LOGIN"

# ────────────────────────────────────────────────────────────────
c "นำเข้ายอดยกมา — ถั่วและเมล็ด (ไม่ใช้ล็อต)"
F1=$(tmpjson "{\"idempotency_key\":\"seed-nuts-v1-nolot\",\"rows\":[
  {\"rowNum\":1,\"รหัส\":\"PUMP-001\",\"ชื่อ\":\"เมล็ดฟักทอง อบกรอบ\",\"บาร์โค้ด\":\"8850001100001\",\"หน่วย\":\"กก.\",\"หมวด\":\"เมล็ด\",\"คลัง\":\"คลัง A\",\"จำนวนยกมา\":150,\"ต้นทุนต่อหน่วย\":180,\"จุดสั่งซื้อ\":20,\"ใช้ล็อต\":\"N\"},
  {\"rowNum\":2,\"รหัส\":\"SUNF-001\",\"ชื่อ\":\"เมล็ดทานตะวัน อบเกลือ\",\"บาร์โค้ด\":\"8850001100002\",\"หน่วย\":\"กก.\",\"หมวด\":\"เมล็ด\",\"คลัง\":\"คลัง A\",\"จำนวนยกมา\":200,\"ต้นทุนต่อหน่วย\":120,\"จุดสั่งซื้อ\":30,\"ใช้ล็อต\":\"N\"},
  {\"rowNum\":3,\"รหัส\":\"SESM-001\",\"ชื่อ\":\"เมล็ดงาขาว\",\"บาร์โค้ด\":\"8850001100003\",\"หน่วย\":\"กก.\",\"หมวด\":\"เมล็ด\",\"คลัง\":\"คลัง A\",\"จำนวนยกมา\":100,\"ต้นทุนต่อหน่วย\":90,\"จุดสั่งซื้อ\":15,\"ใช้ล็อต\":\"N\"},
  {\"rowNum\":4,\"รหัส\":\"SESB-001\",\"ชื่อ\":\"เมล็ดงาดำ\",\"บาร์โค้ด\":\"8850001100004\",\"หน่วย\":\"กก.\",\"หมวด\":\"เมล็ด\",\"คลัง\":\"คลัง A\",\"จำนวนยกมา\":80,\"ต้นทุนต่อหน่วย\":110,\"จุดสั่งซื้อ\":10,\"ใช้ล็อต\":\"N\"},
  {\"rowNum\":5,\"รหัส\":\"FLUX-001\",\"ชื่อ\":\"เมล็ดแฟลกซ์\",\"บาร์โค้ด\":\"8850001100005\",\"หน่วย\":\"กก.\",\"หมวด\":\"เมล็ด\",\"คลัง\":\"คลัง A\",\"จำนวนยกมา\":60,\"ต้นทุนต่อหน่วย\":350,\"จุดสั่งซื้อ\":10,\"ใช้ล็อต\":\"N\"},
  {\"rowNum\":6,\"รหัส\":\"CASH-001\",\"ชื่อ\":\"มะม่วงหิมพานต์ดิบ\",\"บาร์โค้ด\":\"8850001200001\",\"หน่วย\":\"กก.\",\"หมวด\":\"ถั่ว\",\"คลัง\":\"คลัง A\",\"จำนวนยกมา\":120,\"ต้นทุนต่อหน่วย\":420,\"จุดสั่งซื้อ\":15,\"ใช้ล็อต\":\"N\"},
  {\"rowNum\":7,\"รหัส\":\"CASHR-001\",\"ชื่อ\":\"มะม่วงหิมพานต์อบ\",\"บาร์โค้ด\":\"8850001200002\",\"หน่วย\":\"กก.\",\"หมวด\":\"ถั่ว\",\"คลัง\":\"คลัง A\",\"จำนวนยกมา\":90,\"ต้นทุนต่อหน่วย\":480,\"จุดสั่งซื้อ\":10,\"ใช้ล็อต\":\"N\"},
  {\"rowNum\":8,\"รหัส\":\"ALMD-001\",\"ชื่อ\":\"อัลมอนด์ดิบ\",\"บาร์โค้ด\":\"8850001200003\",\"หน่วย\":\"กก.\",\"หมวด\":\"ถั่ว\",\"คลัง\":\"คลัง B\",\"จำนวนยกมา\":75,\"ต้นทุนต่อหน่วย\":550,\"จุดสั่งซื้อ\":10,\"ใช้ล็อต\":\"N\"},
  {\"rowNum\":9,\"รหัส\":\"WLNT-001\",\"ชื่อ\":\"วอลนัทแกะเปลือก\",\"บาร์โค้ด\":\"8850001200004\",\"หน่วย\":\"กก.\",\"หมวด\":\"ถั่ว\",\"คลัง\":\"คลัง B\",\"จำนวนยกมา\":50,\"ต้นทุนต่อหน่วย\":680,\"จุดสั่งซื้อ\":8,\"ใช้ล็อต\":\"N\"},
  {\"rowNum\":10,\"รหัส\":\"PCAN-001\",\"ชื่อ\":\"พีแคน\",\"บาร์โค้ด\":\"8850001200005\",\"หน่วย\":\"กก.\",\"หมวด\":\"ถั่ว\",\"คลัง\":\"คลัง B\",\"จำนวนยกมา\":40,\"ต้นทุนต่อหน่วย\":750,\"จุดสั่งซื้อ\":5,\"ใช้ล็อต\":\"N\"},
  {\"rowNum\":11,\"รหัส\":\"PNUT-001\",\"ชื่อ\":\"ถั่วลิสงอบ\",\"บาร์โค้ด\":\"8850001200006\",\"หน่วย\":\"กก.\",\"หมวด\":\"ถั่ว\",\"คลัง\":\"คลัง A\",\"จำนวนยกมา\":300,\"ต้นทุนต่อหน่วย\":75,\"จุดสั่งซื้อ\":50,\"ใช้ล็อต\":\"N\"},
  {\"rowNum\":12,\"รหัส\":\"PISC-001\",\"ชื่อ\":\"พิสตาชิโอ\",\"บาร์โค้ด\":\"8850001200007\",\"หน่วย\":\"กก.\",\"หมวด\":\"ถั่ว\",\"คลัง\":\"คลัง B\",\"จำนวนยกมา\":35,\"ต้นทุนต่อหน่วย\":890,\"จุดสั่งซื้อ\":5,\"ใช้ล็อต\":\"N\"},
  {\"rowNum\":13,\"รหัส\":\"MACA-001\",\"ชื่อ\":\"แมคาเดเมีย\",\"บาร์โค้ด\":\"8850001200008\",\"หน่วย\":\"กก.\",\"หมวด\":\"ถั่ว\",\"คลัง\":\"คลัง B\",\"จำนวนยกมา\":25,\"ต้นทุนต่อหน่วย\":1100,\"จุดสั่งซื้อ\":5,\"ใช้ล็อต\":\"N\"},
  {\"rowNum\":14,\"รหัส\":\"BRAZ-001\",\"ชื่อ\":\"บราซิลนัท\",\"บาร์โค้ด\":\"8850001200009\",\"หน่วย\":\"กก.\",\"หมวด\":\"ถั่ว\",\"คลัง\":\"คลัง B\",\"จำนวนยกมา\":20,\"ต้นทุนต่อหน่วย\":950,\"จุดสั่งซื้อ\":3,\"ใช้ล็อต\":\"N\"},
  {\"rowNum\":15,\"รหัส\":\"QUIN-001\",\"ชื่อ\":\"ควินัวขาว\",\"บาร์โค้ด\":\"8850001300001\",\"หน่วย\":\"กก.\",\"หมวด\":\"ธัญพืช\",\"คลัง\":\"คลัง A\",\"จำนวนยกมา\":110,\"ต้นทุนต่อหน่วย\":280,\"จุดสั่งซื้อ\":20,\"ใช้ล็อต\":\"N\"}
]}")
IMP1=$(curl -s -b "$CK" -X POST "$BASE/api/import/opening" \
  -H "Content-Type: application/json" --data-binary @"$F1")
chk "Import 15 รายการ (ถั่ว/เมล็ด/ธัญพืช ไม่ใช้ล็อต)" '"ok":true' "$IMP1"

# ────────────────────────────────────────────────────────────────
c "นำเข้ายอดยกมา — เมล็ดเจียและแฮมป์ (ใช้ล็อต — มีวันหมดอายุ)"
F2=$(tmpjson "{\"idempotency_key\":\"seed-nuts-v1-lot1\",\"rows\":[
  {\"rowNum\":1,\"รหัส\":\"CHIA-001\",\"ชื่อ\":\"เมล็ดเจีย ออร์แกนิก\",\"บาร์โค้ด\":\"8850001100006\",\"หน่วย\":\"กก.\",\"หมวด\":\"เมล็ด\",\"คลัง\":\"คลัง A\",
   \"จำนวนยกมา\":80,\"ต้นทุนต่อหน่วย\":320,\"จุดสั่งซื้อ\":10,\"ใช้ล็อต\":\"Y\",
   \"Lot No.\":\"CHIA-2025-A1\",\"วันผลิต\":\"01/01/2025\",\"วันหมดอายุ\":\"01/01/2027\",\"เลขที่ PO\":\"PO-CHIA-001\",\"โรงงานผู้ผลิต\":\"Nature Seeds Co., Ltd.\"},
  {\"rowNum\":2,\"รหัส\":\"CHIA-001\",\"ชื่อ\":\"เมล็ดเจีย ออร์แกนิก\",\"บาร์โค้ด\":\"8850001100006\",\"หน่วย\":\"กก.\",\"หมวด\":\"เมล็ด\",\"คลัง\":\"คลัง A\",
   \"จำนวนยกมา\":50,\"ต้นทุนต่อหน่วย\":330,\"จุดสั่งซื้อ\":10,\"ใช้ล็อต\":\"Y\",
   \"Lot No.\":\"CHIA-2025-B1\",\"วันผลิต\":\"01/06/2025\",\"วันหมดอายุ\":\"01/06/2027\",\"เลขที่ PO\":\"PO-CHIA-002\",\"โรงงานผู้ผลิต\":\"Nature Seeds Co., Ltd.\"},
  {\"rowNum\":3,\"รหัส\":\"HEMP-001\",\"ชื่อ\":\"เมล็ดกัญชง\",\"บาร์โค้ด\":\"8850001100007\",\"หน่วย\":\"กก.\",\"หมวด\":\"เมล็ด\",\"คลัง\":\"คลัง A\",
   \"จำนวนยกมา\":45,\"ต้นทุนต่อหน่วย\":490,\"จุดสั่งซื้อ\":5,\"ใช้ล็อต\":\"Y\",
   \"Lot No.\":\"HEMP-2025-A1\",\"วันผลิต\":\"15/03/2025\",\"วันหมดอายุ\":\"15/03/2027\",\"เลขที่ PO\":\"PO-HEMP-001\",\"โรงงานผู้ผลิต\":\"Green Farm Thailand\"},
  {\"rowNum\":4,\"รหัส\":\"SAFA-001\",\"ชื่อ\":\"เมล็ดดอกคำฝอย\",\"บาร์โค้ด\":\"8850001100008\",\"หน่วย\":\"กก.\",\"หมวด\":\"เมล็ด\",\"คลัง\":\"คลัง B\",
   \"จำนวนยกมา\":30,\"ต้นทุนต่อหน่วย\":260,\"จุดสั่งซื้อ\":5,\"ใช้ล็อต\":\"Y\",
   \"Lot No.\":\"SAFA-2025-A1\",\"วันผลิต\":\"01/04/2025\",\"วันหมดอายุ\":\"01/04/2027\",\"เลขที่ PO\":\"PO-SAFA-001\",\"โรงงานผู้ผลิต\":\"Herb Valley Co.\"},
  {\"rowNum\":5,\"รหัส\":\"PUMP-LOT\",\"ชื่อ\":\"เมล็ดฟักทอง ออร์แกนิก (ล็อต)\",\"บาร์โค้ด\":\"8850001100009\",\"หน่วย\":\"กก.\",\"หมวด\":\"เมล็ด\",\"คลัง\":\"คลัง B\",
   \"จำนวนยกมา\":3,\"ต้นทุนต่อหน่วย\":195,\"จุดสั่งซื้อ\":10,\"ใช้ล็อต\":\"Y\",
   \"Lot No.\":\"PMPORG-2024-X1\",\"วันผลิต\":\"01/01/2024\",\"วันหมดอายุ\":\"30/11/2026\",\"เลขที่ PO\":\"PO-PUMP-ORG-001\",\"โรงงานผู้ผลิต\":\"Organic Seeds Thailand\"}
]}")
IMP2=$(curl -s -b "$CK" -X POST "$BASE/api/import/opening" \
  -H "Content-Type: application/json" --data-binary @"$F2")
chk "Import 5 รายการ (เมล็ดใช้ล็อต)" '"ok":true' "$IMP2"

# ────────────────────────────────────────────────────────────────
c "ดึง item IDs และ warehouse ID"
ITEMS_JSON=$(curl -s -b "$CK" "$BASE/api/items")
WH_JSON=$(curl -s -b "$CK" "$BASE/api/warehouses")

PUMP_ID=$(_jn "const r=(d.items||[]).filter(i=>i.sku==='PUMP-001');r.length?r[0].id:0" "$ITEMS_JSON" "0")
SUNF_ID=$(_jn "const r=(d.items||[]).filter(i=>i.sku==='SUNF-001');r.length?r[0].id:0" "$ITEMS_JSON" "0")
CASH_ID=$(_jn "const r=(d.items||[]).filter(i=>i.sku==='CASH-001');r.length?r[0].id:0" "$ITEMS_JSON" "0")
CASHR_ID=$(_jn "const r=(d.items||[]).filter(i=>i.sku==='CASHR-001');r.length?r[0].id:0" "$ITEMS_JSON" "0")
ALMD_ID=$(_jn "const r=(d.items||[]).filter(i=>i.sku==='ALMD-001');r.length?r[0].id:0" "$ITEMS_JSON" "0")
WLNT_ID=$(_jn "const r=(d.items||[]).filter(i=>i.sku==='WLNT-001');r.length?r[0].id:0" "$ITEMS_JSON" "0")
PNUT_ID=$(_jn "const r=(d.items||[]).filter(i=>i.sku==='PNUT-001');r.length?r[0].id:0" "$ITEMS_JSON" "0")
QUIN_ID=$(_jn "const r=(d.items||[]).filter(i=>i.sku==='QUIN-001');r.length?r[0].id:0" "$ITEMS_JSON" "0")
SESM_ID=$(_jn "const r=(d.items||[]).filter(i=>i.sku==='SESM-001');r.length?r[0].id:0" "$ITEMS_JSON" "0")
CHIA_ID=$(_jn "const r=(d.items||[]).filter(i=>i.sku==='CHIA-001');r.length?r[0].id:0" "$ITEMS_JSON" "0")

WH_A=$(_jn "const r=(d.warehouses||[]).filter(w=>w.name.includes('A')||w.code.includes('A'));r.length?r[0].id:1" "$WH_JSON" "1")
WH_B=$(_jn "const r=(d.warehouses||[]).filter(w=>w.name.includes('B')||w.code.includes('B'));r.length?r[0].id:2" "$WH_JSON" "2")

info "PUMP=$PUMP_ID SUNF=$SUNF_ID CASH=$CASH_ID ALMD=$ALMD_ID WLNT=$WLNT_ID PNUT=$PNUT_ID CHIA=$CHIA_ID"
info "คลัง A=$WH_A  คลัง B=$WH_B"

# ────────────────────────────────────────────────────────────────
c "รับสินค้า (RECEIVE) — สต็อกมาใหม่"

if [[ "$PUMP_ID" != "0" ]]; then
  R=$(curl -s -b "$CK" -X POST "$BASE/api/documents/receive" \
    -H "Content-Type: application/json" \
    -d "{\"idempotency_key\":\"seed-nuts-v1-rcv-pump\",\"warehouse_id\":${WH_A},\"doc_date\":\"2026-10-01\",
         \"lines\":[{\"item_id\":${PUMP_ID},\"qty_milli\":200000,\"unit_cost_x4\":1850000}]}")
  chk "รับ เมล็ดฟักทอง 200 กก. @185 บ." '"doc_no"' "$R"
fi

if [[ "$SUNF_ID" != "0" ]]; then
  R=$(curl -s -b "$CK" -X POST "$BASE/api/documents/receive" \
    -H "Content-Type: application/json" \
    -d "{\"idempotency_key\":\"seed-nuts-v1-rcv-sunf\",\"warehouse_id\":${WH_A},\"doc_date\":\"2026-10-02\",
         \"lines\":[
           {\"item_id\":${SUNF_ID},\"qty_milli\":300000,\"unit_cost_x4\":1250000},
           {\"item_id\":${SESM_ID},\"qty_milli\":150000,\"unit_cost_x4\":950000}
         ]}")
  chk "รับ เมล็ดทานตะวัน+งา" '"doc_no"' "$R"
fi

if [[ "$CASH_ID" != "0" ]]; then
  R=$(curl -s -b "$CK" -X POST "$BASE/api/documents/receive" \
    -H "Content-Type: application/json" \
    -d "{\"idempotency_key\":\"seed-nuts-v1-rcv-cash\",\"warehouse_id\":${WH_A},\"doc_date\":\"2026-10-05\",
         \"lines\":[
           {\"item_id\":${CASH_ID},\"qty_milli\":80000,\"unit_cost_x4\":4300000},
           {\"item_id\":${CASHR_ID},\"qty_milli\":60000,\"unit_cost_x4\":4900000}
         ]}")
  chk "รับ มะม่วงหิมพานต์ดิบ+อบ" '"doc_no"' "$R"
fi

if [[ "$ALMD_ID" != "0" ]]; then
  R=$(curl -s -b "$CK" -X POST "$BASE/api/documents/receive" \
    -H "Content-Type: application/json" \
    -d "{\"idempotency_key\":\"seed-nuts-v1-rcv-almd\",\"warehouse_id\":${WH_B},\"doc_date\":\"2026-10-08\",
         \"lines\":[
           {\"item_id\":${ALMD_ID},\"qty_milli\":100000,\"unit_cost_x4\":5600000},
           {\"item_id\":${WLNT_ID},\"qty_milli\":50000,\"unit_cost_x4\":6900000}
         ]}")
  chk "รับ อัลมอนด์+วอลนัท" '"doc_no"' "$R"
fi

if [[ "$PNUT_ID" != "0" ]]; then
  R=$(curl -s -b "$CK" -X POST "$BASE/api/documents/receive" \
    -H "Content-Type: application/json" \
    -d "{\"idempotency_key\":\"seed-nuts-v1-rcv-pnut\",\"warehouse_id\":${WH_A},\"doc_date\":\"2026-10-10\",
         \"lines\":[
           {\"item_id\":${PNUT_ID},\"qty_milli\":500000,\"unit_cost_x4\":780000},
           {\"item_id\":${QUIN_ID},\"qty_milli\":100000,\"unit_cost_x4\":2900000}
         ]}")
  chk "รับ ถั่วลิสง+ควินัว" '"doc_no"' "$R"
fi

# ────────────────────────────────────────────────────────────────
c "รับ เมล็ดเจีย (ล็อตใหม่)"
if [[ "$CHIA_ID" != "0" ]]; then
  LOTS_JSON=$(curl -s -b "$CK" "$BASE/api/lots/suggest?item_id=${CHIA_ID}&warehouse_id=${WH_A}")
  LOT_ID=$(_jn "const lots=(d.lots||[]).filter(l=>l.expiry_date>'2026-01-01');lots.length?lots[0].id:0" "$LOTS_JSON" "0")
  info "CHIA lot_id=$LOT_ID"
  if [[ "$LOT_ID" != "0" ]]; then
    R=$(curl -s -b "$CK" -X POST "$BASE/api/documents/receive" \
      -H "Content-Type: application/json" \
      -d "{\"idempotency_key\":\"seed-nuts-v1-rcv-chia\",\"warehouse_id\":${WH_A},\"doc_date\":\"2026-10-15\",
           \"lines\":[{\"item_id\":${CHIA_ID},\"lot_id\":${LOT_ID},\"qty_milli\":60000,\"unit_cost_x4\":3350000}]}")
    chk "รับ เมล็ดเจีย (ล็อต)" '"doc_no"' "$R"
  else
    info "ข้ามรับเจีย (ไม่พบล็อต)"
  fi
fi

# ────────────────────────────────────────────────────────────────
c "ตัดออก (ISSUE) — ขายปลีก"

if [[ "$PUMP_ID" != "0" ]]; then
  R=$(curl -s -b "$CK" -X POST "$BASE/api/documents/issue" \
    -H "Content-Type: application/json" \
    -d "{\"idempotency_key\":\"seed-nuts-v1-iss-pump1\",\"warehouse_id\":${WH_A},\"doc_date\":\"2026-10-12\",
         \"ref_text\":\"ขายส่ง ร้านแม่กลองเฮลท์\",
         \"lines\":[{\"item_id\":${PUMP_ID},\"qty_milli\":50000}]}")
  chk "จ่าย เมล็ดฟักทอง 50 กก." '"doc_no"' "$R"
fi

if [[ "$SUNF_ID" != "0" ]]; then
  R=$(curl -s -b "$CK" -X POST "$BASE/api/documents/issue" \
    -H "Content-Type: application/json" \
    -d "{\"idempotency_key\":\"seed-nuts-v1-iss-sunf1\",\"warehouse_id\":${WH_A},\"doc_date\":\"2026-10-15\",
         \"ref_text\":\"ขายส่ง ซุปเปอร์มาร์เก็ต\",
         \"lines\":[
           {\"item_id\":${SUNF_ID},\"qty_milli\":80000},
           {\"item_id\":${SESM_ID},\"qty_milli\":30000}
         ]}")
  chk "จ่าย เมล็ดทานตะวัน+งา" '"doc_no"' "$R"
fi

if [[ "$CASH_ID" != "0" ]]; then
  R=$(curl -s -b "$CK" -X POST "$BASE/api/documents/issue" \
    -H "Content-Type: application/json" \
    -d "{\"idempotency_key\":\"seed-nuts-v1-iss-cash1\",\"warehouse_id\":${WH_A},\"doc_date\":\"2026-10-20\",
         \"ref_text\":\"ขายส่ง คาเฟ่ออร์แกนิก\",
         \"lines\":[
           {\"item_id\":${CASH_ID},\"qty_milli\":25000},
           {\"item_id\":${CASHR_ID},\"qty_milli\":20000}
         ]}")
  chk "จ่าย มะม่วงหิมพานต์" '"doc_no"' "$R"
fi

if [[ "$ALMD_ID" != "0" ]]; then
  R=$(curl -s -b "$CK" -X POST "$BASE/api/documents/issue" \
    -H "Content-Type: application/json" \
    -d "{\"idempotency_key\":\"seed-nuts-v1-iss-almd1\",\"warehouse_id\":${WH_B},\"doc_date\":\"2026-10-22\",
         \"ref_text\":\"ขายส่ง ร้านเบเกอรี่\",
         \"lines\":[
           {\"item_id\":${ALMD_ID},\"qty_milli\":30000},
           {\"item_id\":${WLNT_ID},\"qty_milli\":15000}
         ]}")
  chk "จ่าย อัลมอนด์+วอลนัท" '"doc_no"' "$R"
fi

if [[ "$PNUT_ID" != "0" ]]; then
  R=$(curl -s -b "$CK" -X POST "$BASE/api/documents/issue" \
    -H "Content-Type: application/json" \
    -d "{\"idempotency_key\":\"seed-nuts-v1-iss-pnut1\",\"warehouse_id\":${WH_A},\"doc_date\":\"2026-10-25\",
         \"ref_text\":\"ขายส่ง โรงเรียน\",
         \"lines\":[
           {\"item_id\":${PNUT_ID},\"qty_milli\":150000},
           {\"item_id\":${QUIN_ID},\"qty_milli\":25000}
         ]}")
  chk "จ่าย ถั่วลิสง+ควินัว" '"doc_no"' "$R"
fi

# ────────────────────────────────────────────────────────────────
c "รับสินค้าเพิ่มเติม (รอบ 2 — ราคาขึ้น)"
if [[ "$PUMP_ID" != "0" ]]; then
  R=$(curl -s -b "$CK" -X POST "$BASE/api/documents/receive" \
    -H "Content-Type: application/json" \
    -d "{\"idempotency_key\":\"seed-nuts-v1-rcv-pump2\",\"warehouse_id\":${WH_A},\"doc_date\":\"2026-11-01\",
         \"lines\":[{\"item_id\":${PUMP_ID},\"qty_milli\":100000,\"unit_cost_x4\":1950000}]}")
  chk "รับ เมล็ดฟักทองรอบ 2 (ราคาขึ้น 185→195)" '"doc_no"' "$R"
fi

# ────────────────────────────────────────────────────────────────
BAL_JSON=$(curl -s -b "$CK" "$BASE/api/reports/balance")
BAL_ROWS=$(_jn "d.data?d.data.length:0" "$BAL_JSON" "0")
echo ""
echo "════════════════════════════════════════════════════════════"
echo "  ✅ PASS=$PASS  ❌ FAIL=$FAIL"
echo "  ยอดคงเหลือในระบบทั้งหมด: $BAL_ROWS รายการ"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "  สินค้าในระบบ:"
echo "  • เมล็ด   : เมล็ดฟักทอง, เมล็ดทานตะวัน, งาขาว, งาดำ, แฟลกซ์"
echo "            เมล็ดเจีย (ล็อต), เมล็ดกัญชง (ล็อต), เมล็ดดอกคำฝอย (ล็อต)"
echo "  • ถั่ว    : มะม่วงหิมพานต์, อัลมอนด์, วอลนัท, พีแคน, ถั่วลิสง"
echo "            พิสตาชิโอ, แมคาเดเมีย, บราซิลนัท"
echo "  • ธัญพืช  : ควินัวขาว"
echo ""
echo "  เปิดเว็บที่: $BASE"

rm -f "$CK"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
