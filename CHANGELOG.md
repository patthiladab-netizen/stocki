# Changelog

All notable changes to Stocki will be documented in this file.

## [Unreleased]

### Fixed
- `scripts/test_remote.sh`: บาร์โค้ดทดสอบไม่ซ้ำกันในแต่ละรอบ (เดิมรันซ้ำแล้วชนกฎบาร์โค้ดห้ามซ้ำ ทำให้ import ล้ม 3 ข้อ)
- `test_remote.sh` / `seed_remote.sh`: ต้องระบุ `BASE` ไม่เช่นนั้นแจ้งเตือนภาษาไทย แทนการยิงไป localhost เงียบ ๆ


## [0.1.0-users1] - 2026-11-04

### Added
- หน้า "ผู้ใช้งาน" (OWNER): เพิ่มบัญชีพนักงาน เปลี่ยนบทบาท ตั้งรหัสผ่านใหม่ ปิด/เปิดใช้งาน — API `/api/users` บันทึก audit_logs ทุกครั้ง
- กันลดสิทธิ์/ปิดบัญชีตัวเอง และกันลบ OWNER คนสุดท้าย; บัญชีที่ถูกปิดล็อกอินไม่ได้และ session เดิมหมดอายุทันที

### Fixed
- ตัดออกที่ถูกปฏิเสธไม่ทำให้เลขเอกสารกระโดดอีก (คืนเลขที่ยังไม่ได้ใช้)


### Fixed
- test ล็อตหมดอายุใน edge-cases ผูกกับนาฬิกาจริง ทำให้ล้มหลังวันที่ 3 พ.ย.


## [0.1.0-bugfix15] - 2026-11-03

### Added
- ปุ่ม "ยกเลิกเอกสาร" (OWNER) ในหน้ารายละเอียดเอกสาร สร้างเอกสารกลับรายการ
- แท็บรายงาน "บัตรคุมสินค้า" ค้นสินค้า ดูเข้า-ออก-คงเหลือ ส่งออก Excel (ต้นทุนเฉพาะ OWNER)

### Fixed
- ข้อความยอดไม่พอเป็นภาษาไทยอ่านง่าย (รหัส ชื่อ ล็อต จำนวนหน่วยจริง) และหน้าตัดออกกันใส่เกินยอด
- มือถือ: ปุ่มบันทึกไม่ถูกแถบเมนูล่างบัง
- เอกสารยอดยกมาใช้วันที่ตามเวลาไทย
- ช่องวันที่แสดงคำใบ้ วว/ดด/ปปปป (พ.ศ.) และตารางแสดงวันที่แบบไทย
- `/api/lots/suggest` ไม่ส่งต้นทุนให้ STAFF

## [0.1.0-bugfix14] - 2026-11-03

### Fixed
- **ตัดออกสินค้าที่ไม่ใช้ล็อตล้มเหลวทุกครั้ง** ("ข้อมูลไม่ถูกต้อง"): หน้าตัดออกส่ง `lot_id: null` แต่ API รับแค่ตัวเลข — API แปลง null เป็น 0 (ไม่มีล็อต) และหน้าเว็บส่ง 0; เพิ่ม test

## [0.1.0-ux1] - 2026-11-02

### Fixed
- **Security**: รายงานรับ-จ่าย (`/api/reports/movements`, `/movements/export`) ใช้ bind parameter แทนการต่อวันที่ลง SQL ตรง ๆ และตรวจรูปแบบวันที่
- ข้อความ error เป็นภาษาไทยทุกหน้า (ไม่แสดงรหัสอย่าง `barcode_duplicate`)
- หน้ารับสินค้า: เลข "0" ลอยใต้ช่องจำนวน; ช่องต้นทุนรับทศนิยมได้ 4 ตำแหน่ง
- รายงาน: คอลัมน์ No. เป็นเลขลำดับ, จัดรูปแบบเงิน/จำนวน, Excel ตรงกับหน้าจอ

### Added
- มือถือ: เมนูแถบล่าง + เมนูโปรไฟล์, หน้าสินค้าแบบการ์ด, ตรึงคอลัมน์ชื่อในรายงาน, ปุ่มสูง ≥ 44px ไม่ตัดคำ
- หน้าสินค้ามีคอลัมน์คงเหลือ; ช่องจำนวนแสดงหน่วย; ปุ่ม "ล้างรายการ" / "ยกเลิกใบรับ" / "ยกเลิกใบตัด"
- หน้า "ดราฟ" (แก้ไข ลบ บันทึกจริง) และ "ล้างข้อมูลทั้งหมด" (OWNER, พิมพ์ยืนยัน, ส่งออก Excel สำรองก่อนลบ)

## [0.1.0-bugfix13] - 2026-11-02

### Fixed
- **นำเข้า Excel**: บาร์โค้ดซ้ำกับสินค้าในระบบ หรือซ้ำกันเองในไฟล์ (คนละ SKU) ถูกปฏิเสธเป็น error รายแถว (422) และหน้าเว็บแสดงรายการแถวผิดแล้ว
- **ตัดออกพร้อมกัน**: เดิมบางกรณี movement ถูกบันทึกแต่ยอดไม่ถูกตัด — migration 0006 เพิ่ม trigger กันยอดติดลบที่ฐานข้อมูล ทั้ง batch ถูกยกเลิกถ้ายอดจะติดลบ; รับเข้าคำนวณยอด/ต้นทุนเฉลี่ยจากแถวปัจจุบันใน SQL
- **reset-data**: เดิมล้มเหลวทุกครั้งเพราะ audit action ไม่ผ่าน CHECK
- ทุก error จาก API มี `message` ภาษาไทย

### Added
- **เอกสารลงวันที่ล่วงหน้าเป็นดราฟ**: ไม่กระทบสต็อก แก้ไข/ลบได้ บันทึกจริงได้เมื่อถึงวันที่ (ตรวจที่ server ตามเวลาไทย) — `PUT/DELETE /api/documents/:id`, `POST /api/documents/:id/post`

## [0.1.0-bugfix12] - 2026-11-02

### Fixed
- **migration 0005**: ล้างบาร์โค้ดซ้ำ (เก็บไว้ที่สินค้า id ต่ำสุด) และบาร์โค้ดว่างเป็น NULL ก่อนสร้าง UNIQUE index — เดิม migration ล้มบน remote ที่มีข้อมูลซ้ำอยู่แล้ว ทำให้ไม่มี index กันซ้ำที่ฐานข้อมูล
- **items API**: บาร์โค้ดว่าง/ช่องว่างแปลงเป็น NULL ป้องกัน UNIQUE ชนกันที่ค่า ""

## [0.1.0-bugfix11] - 2026-11-02

### Fixed
- **import-service.ts**: เช็กบาร์โค้ดซ้ำกับ sku อื่นก่อน upsert item — ข้ามแถวพร้อมแสดงเหตุผล `"บาร์โค้ด X ซ้ำกับสินค้า Y"`
- **import-service.ts**: ส่ง `imported` count กลับพร้อม response
- **Import.tsx**: เปลี่ยน `TEMPLATE_COLUMNS` ให้ใช้ `"ใช้ล็อต (Y/N)"` ตรงกับ header ในไฟล์ Excel — ช่อง preview แสดงค่าแล้ว
- **Import.tsx**: sort skipped rows ตาม rowNum ก่อนแสดง
- **Import.tsx**: เมื่อข้ามทุกแถว ขึ้น "ไม่มีแถวใหม่ — ข้ามทั้งหมด N แถว" แทน "นำเข้าสำเร็จ"; แสดง reason ของแต่ละแถวที่ถูกข้าม

## [0.1.0-bugfix10] - 2026-11-02

### Fixed
- **Bug 5 — บาร์โค้ดซ้ำได้**: เพิ่มตรวจ duplicate barcode ใน POST/PUT `/api/items` ก่อนบันทึก (ตอบ 409 พร้อม `barcode_duplicate`); เพิ่ม migration `0005_barcode_unique.sql` สร้าง partial unique index `WHERE barcode IS NOT NULL`; อัปเดต Drizzle schema ใช้ `uniqueIndex`
- **Bug 6 — วันที่ล่วงหน้าเกิน**: RECEIVE/ISSUE ปฏิเสธ `doc_date` ที่เกินวันพรุ่งนี้ (ตอบ 422 `invalid_date`) — buffer 1 วันสำหรับ timezone
- **Bug 7a — ปิด/เปิดสินค้า**: เพิ่ม `PATCH /api/items/:id/status` (OWNER เท่านั้น) บันทึก audit_log ทุกครั้ง
- **Bug 7b — ปุ่มในหน้าสินค้า**: Items.tsx แสดงปุ่ม "ปิดใช้งาน"/"เปิดใช้งาน" ต่อท้ายปุ่มแก้ไข; สินค้า INACTIVE แสดงแบบจางพร้อม badge; OWNER เห็นสินค้าทุกสถานะ STAFF เห็นเฉพาะ ACTIVE
- **Bug 7c — รีเซ็ตข้อมูลทดสอบ**: เพิ่ม `POST /api/admin/reset-data` (OWNER, ต้องส่ง `confirm:"RESET"`) ล้างข้อมูล transaction ทั้งหมดยกเว้น users/sessions

## [0.1.0-bugfix9] - 2026-11-02

### Fixed
- **Import.tsx (bug1)**: ตัด idempotency key จาก `import-{64hex}` (71 chars) เป็น `imp-{32hex}` (36 chars) — ป้องกัน D1 error "LIKE or GLOB pattern too complex"
- **Import.tsx (bug2)**: เช็ก `res.ok` ก่อนอ่าน JSON body — แสดง error ทุกครั้งที่ server ตอบ 4xx/5xx แทนที่จะขึ้น "นำเข้าสำเร็จ" ผิดๆ; เพิ่ม `catch` ป้องกัน res.json() throw
- **importValidator.ts (bug3)**: เพิ่ม `normalizeRow()` ตัดส่วนท้าย `(Y/N)` ออกก่อนเทียบ key — ทำให้คอลัมน์ `ใช้ล็อต (Y/N)` ในไฟล์ Excel อ่านได้แม้ header format ต่างกัน
- **reports-service.ts (bug4)**: แก้ reorder query `LEFT JOIN stock_balances sb ON sb.item_id=i.id AND sb.lot_id IS NULL` → ลบ `AND sb.lot_id IS NULL` ออก — หลัง migration 0003 ค่า sentinel เป็น 0 ไม่ใช่ NULL ทำให้ SUM qty = 0 ผิดทุกรายการ

## [0.1.0-test2] - 2026-11-02

### Changed
- **scripts/seed_remote.sh**: เปลี่ยนธีมข้อมูลตัวอย่างเป็นร้านเมล็ดพันธุ์และถั่วเพื่อสุขภาพ — สินค้า 20 รายการ (เมล็ดฟักทอง, เมล็ดทานตะวัน, งาขาว/ดำ, แฟลกซ์, เมล็ดเจีย+กัญชง+ดอกคำฝอย ใช้ล็อต, มะม่วงหิมพานต์, อัลมอนด์, วอลนัท, พีแคน, ถั่วลิสง, พิสตาชิโอ, แมคาเดเมีย, บราซิลนัท, ควินัว) พร้อม RECEIVE 6 ใบ ISSUE 5 ใบ — key ขึ้นต้น `seed-nuts-v1-`

## [0.1.0-test1] - 2026-11-02

### Added
- **scripts/seed_remote.sh**: Seed script idempotent (key `seed-v1-*`) — สร้างสินค้า 20 รายการ (น้ำมันเครื่อง, ไส้กรอง, หัวเทียน, แบตเตอรี่, ยาง, เบรก, ยา/เวชภัณฑ์ใช้ล็อต) พร้อม RECEIVE 7 ใบ และ ISSUE 5 ใบ
- **playwright.config.ts**: Playwright config กำหนด baseURL, Chromium ที่ `/opt/pw-browsers/chromium`, testDir `e2e/`
- **e2e/stocki.spec.ts**: E2E tests ครอบคลุม: Auth (login/logout/wrong-pass), Items (ค้นบาร์โค้ด), Import (ปุ่มดาวน์โหลดแม่แบบ), Receive (barcode scan+Enter), Issue, Reports (OWNER เห็นมูลค่า), Access Control (STAFF ไม่เห็นมูลค่า)
- **tests/edge-cases.test.ts**: 25 unit tests ครอบคลุม: postDocument (ยอด=0, avg cost ไม่เปลี่ยนตอน issue), moving average (2 batch), validateIssueLines (multi-line partial fail, lot หมดอายุ), isExpired (strict <), idempotency response, validateImportRows (expiry=mfg, whitespace lot_no, ขาดข้อมูล, qty=0, qty<0, cost<0, หน่วยไม่รู้จัก, ล็อตซ้ำ), parseThaiDate (พ.ศ., ค.ศ., Excel serial, null)

## [0.1.0-bugfix8] - 2026-11-02

### Fixed
- **scripts/test_remote.sh**: แทน python3 ด้วย `_jn()` helper ที่ใช้ node — รันได้บน Windows Git Bash ที่ไม่มี python3
- **scripts/test_remote.sh**: เปลี่ยน single-quoted JSON เป็น double-quoted + `--data-binary @tmpfile` สำหรับ payload ภาษาไทย — `$RUN_ID` expand ถูกต้อง และ UTF-8 ไม่เพี้ยนบน Windows

## [0.1.0-bugfix7] - 2026-11-02

### Added
- **reset password**: API `POST /api/auth/reset-password` (ยืนยันด้วย APP_SECRET จาก Cloudflare secrets)
- **หน้า ResetPassword**: เข้าถึงได้จากปุ่ม "ลืมรหัสผ่าน?" ในหน้า Login

## [0.1.0-bugfix6] - 2026-11-01

### Fixed
- **import-service**: แก้ idempotency check ใช้ `LIKE ?%` แทน exact match เพราะ documents เก็บ key แบบ `${key}:${warehouseCode}` — ทำให้การ import ซ้ำด้วย key เดิมทำงานถูกต้อง
- **import-service**: ย้ายการสร้าง `doc_no` (OPN-YYMM-XXXX) เข้าไปใน per-warehouse loop — แก้ UNIQUE constraint error เมื่อ import มีหลายคลัง
- **scripts/test_remote.sh**: เพิ่ม integration test script ครอบคลุม 27 หัวข้อ (PASS=42 assertions): health, setup, login, warehouses, import, items, RECEIVE, ISSUE, cancel, idempotency, FEFO, concurrent, reports, export, access control

## [0.1.0-bugfix5] - 2026-11-01

### Fixed
- **migration 0004_fix_duplicate_balances.sql**: แก้ UNIQUE constraint ที่ทำให้ migration 0003 ล้มเหลวบน remote DB
  remote DB มี duplicate rows ใน stock_balances (หลาย lot_id=NULL ต่อ item+warehouse เดิม)
  เกิดจาก ON CONFLICT ไม่ทำงานกับ NULL ใน composite PK ก่อนจะ fix ด้วย sentinel
  migration 0004 ใช้ `GROUP BY + SUM qty + weighted avg cost` รวม duplicate ก่อน rename
  พร้อม `DROP TABLE IF EXISTS stock_balances_new/stock_movements_new` ล้าง table กลางที่ค้างจาก 0003

## [0.1.0-bugfix4] - 2026-11-01

### Fixed
- **documents-service / import-service (stock_movements)**: คืนค่า `lu.lot_id` (sentinel 0) ใน INSERT stock_movements
  หลังจาก migration 0003 ทำให้ lot_id เป็น NOT NULL DEFAULT 0 ไม่มี FK → ใส่ 0 ได้ถูกต้อง
  FOREIGN KEY constraint บน remote แก้ด้วยการ run `npm run db:migrate:remote` ให้ครบ (bug A)
- **importValidator**: รองรับหัวคอลัมน์ `ใช้ล็อต (Y/N)` เพิ่มเติมจาก `ใช้ล็อต` (bug B)
- **import-service**: คืน `skipped[]` พร้อม rowNum และเหตุผลเมื่อข้ามยอดยกมาที่มีสต็อกอยู่แล้ว (bug C)
- **Import.tsx**: แสดงรายการแถวที่ถูกข้ามใน success message แทนที่จะขึ้น "สำเร็จ" เฉยๆ (bug C)
- **documents-service (ISSUE)**: error message เปลี่ยนจาก `"validation_failed"` เป็น errors จริง เช่น `"ยอดไม่เพียงพอ"`

## [0.1.0-bugfix3] - 2026-11-01

### Fixed
- **stock_balances / stock_movements**: เปลี่ยน `lot_id NULL` → sentinel `0` (migration 0003)
  แก้ปัญหา SQLite ที่ไม่ enforce uniqueness บน composite PRIMARY KEY ที่มี NULL component
  ทำให้ `ON CONFLICT` ทำงานถูกต้องสำหรับสินค้าที่ไม่ใช้ล็อต (bugs 1+2)
- **import-service**: เช็ค `existingBalance` บนทุก movement (ไม่ใช่แค่ OPENING)
  ป้องกันยอดยกมาทับยอดที่มี RECEIVE อยู่แล้ว (bug 3)
- **documents-service (ISSUE)**: ดึง `unit_cost_x4` จาก `avg_cost` ใน snapshot
  แทนที่จะใช้ 0 ที่ frontend ส่งมา — ใบตัดออกแสดงต้นทุนถูกต้อง (bug 4)
- **reports-service (movements)**: เปลี่ยน INNER JOIN เป็น LEFT JOIN บน `document_lines`
  แสดงรายการรับ-จ่ายครบถ้วนแม้ movement จะไม่มี line_id (bug 5)
- อัปเดต type `PostLine.lot_id` เป็น `number` (ไม่ใช่ `number | null`)

## [0.1.0-bugfix2] - 2026-11-01

### Fixed
- `import-service.ts`: auto-create หน่วย/คลัง ใช้ `r["หน่วย"]` และ `r["คลัง"]` แทน `r.unit_code`/`r.warehouse_code` (rows จาก Excel ใช้ key ภาษาไทย)
- `documents-service.ts`: direction `-1` อยู่ผิดตำแหน่งใน VALUES (ตำแหน่ง 5 แทนที่จะเป็น 6) ทำให้ CHECK constraint fail เมื่อตัดออก
- `Reports.tsx`: `transformRow` แปลง `_milli`/`_x4` เสมอ ไม่ใช่แค่ตอน export ทำให้ตัวเลขในหน้าจอถูกต้อง

## [0.1.0-d5] - 2026-10-31

### Added (D5 — รายงานสรุป + ทดสอบติดตั้ง)
- `src/domain/reportEngine.ts` — pure functions: filterCostFields, buildBalanceRows, buildMovementSummary, buildExpiringRows, buildReorderRows, buildExcelColumns
- `src/api/reports-service.ts` — GET /api/reports/balance, /movements, /card/:id, /lots, /expiring, /reorder, /balance/export
- `src/web/pages/Reports.tsx` — แสดงรายงาน 6 ประเภท, Export Excel (SheetJS client-side), STAFF ไม่เห็นคอลัมน์มูลค่า
- STAFF filter ตรวจที่ API layer ทั้ง JSON response และ Excel export
- 9 tests ใหม่: filterCostFields (OWNER/STAFF), buildBalanceRows, buildMovementSummary, buildExpiringRows, buildReorderRows, buildExcelColumns

## [0.1.0-d4] - 2026-10-31

### Added (D4 — รับเข้า + ตัดออก)
- `src/domain/documentEngine.ts` — pure functions: `isExpired`, `computeFEFOOrder`, `validateIssueLines`, `buildIdempotencyResponse`, `buildDocNo`
- `src/api/documents-service.ts` — POST /api/documents/receive, POST /api/documents/issue, POST /api/documents/:id/cancel, GET /api/documents, GET /api/documents/:id, GET /api/lots/suggest (FEFO)
- GET /api/warehouses, POST /api/lots (upsert) เพิ่มใน index.ts
- `src/web/pages/Receive.tsx` — หน้ารับสินค้า รองรับ keyboard wedge barcode, เตือนแป้นพิมพ์ไทย, รองรับ lot
- `src/web/pages/Issue.tsx` — หน้าตัดออก FEFO lot selector, เตือนแป้นพิมพ์ไทย
- เพิ่ม nav Receive/Issue ใน main.tsx
- `tests/documents.test.ts` — 14 test cases ครอบคลุม: moving average, validateIssueLines, FEFO order, expired lot, idempotency, concurrent safety

### Security
- ตัดออก: ใช้ SQL `WHERE qty_on_hand_milli >= ?` ป้องกัน race condition (ยอดไม่ติดลบเมื่อมีคำขอพร้อมกัน)
- Cancel: สร้าง movement กลับรายการ ไม่ลบของเดิม

## [0.1.0-d3] - 2026-10-31

### Added (D3 — นำเข้าสต็อกจาก Excel)
- POST /api/import/opening — รับ batch ≤500 แถว, idempotency-key, จัดกลุ่มตามคลัง
- validateImportRows() — ตรวจทุกกรณี: หน่วยไม่รู้จัก, จำนวนติดลบ, ซ้ำในไฟล์, ล็อตขาดข้อมูล, วันหมดอายุก่อนวันผลิต
- parseThaiDate() — รองรับ วว/ดด/ปปปป (พ.ศ./ค.ศ.) และ Excel serial number
- computePostDocumentUpdates() — คำนวณ balance ใหม่ด้วย moving average cost (pure function ไม่ depend D1)
- หน้า Import.tsx — ดาวน์โหลดแม่แบบ, อ่านไฟล์ด้วย SheetJS, ตัวอย่าง 20 แถว, รายการแถวผิด, ยืนยันนำเข้า
- 14 tests: validateImportRows (9 กรณี), parseThaiDate (5 กรณี)

## [0.1.0-d2] - 2026-10-31

### Added (D2 — ล็อกอิน + หน้าสินค้า)
- POST /api/auth/login — PBKDF2-SHA256 ≥100,000 รอบ, ล็อก 15 นาทีหลังผิด 10 ครั้ง
- POST /api/auth/logout, GET /api/auth/me
- GET/POST/PUT /api/items — ค้นด้วยชื่อหรือบาร์โค้ด, audit_logs ทุกครั้ง
- STAFF เรียกข้อมูลต้นทุน → 403 (ตรวจที่ API)
- Cookie: HttpOnly; Secure; SameSite=Lax
- GET /api/setup/status + POST /api/setup/init (first-run)
- Frontend: หน้า Setup, Login, Items (React + Zustand + Tailwind)

## [0.1.0-d1] - 2026-10-31

### Added (D1 — โครงโปรเจกต์ + ฐานข้อมูล)
- โครงโฟลเดอร์ครบ: src/api, src/domain, src/db, src/web, migrations, tests, e2e
- package.json พร้อม scripts ทุกอัน (dev, typecheck, lint, test, e2e, db:reset, db:migrate, db:migrate:remote, secrets:scan, deploy)
- wrangler.jsonc — ไม่มี database_id ตายตัว (placeholder 00000000)
- Drizzle schema ครบ 14 ตาราง (src/db/schema.ts)
- migration/0000_init.sql — รันบน D1 local สำเร็จ
- GET /api/health → {"ok":true}
- Vitest tests: health shape + schema integrity (movements sum = balances, ห้ามยอดติดลบ)
- .gitignore รวม .dev.vars, node_modules, .wrangler
- React + Vite + Tailwind frontend skeleton
