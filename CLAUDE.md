# Stocki — คำสั่งประจำโปรเจกต์สำหรับ Claude Code

Stocki คือโปรแกรมสต็อกบนเว็บ แจกฟรีแบบลูกค้าติดตั้งเองบน Cloudflare (1 บัญชี Cloudflare = 1 บริษัท)
ใช้ได้ทั้งคลังร้านค้าปลีกและคลังวัตถุดิบ **ทำเฉพาะงานสต็อก ไม่ใช่ WMS**

- หน้าจอ ข้อความ และเอกสารผู้ใช้: **ภาษาไทย**
- ชื่อตัวแปร ตาราง commit และโค้ด: **ภาษาอังกฤษ**

---

## 1. ขอบเขตรอบแรก v0.1 (D1–D5)

ทำแค่ 4 อย่าง: **นำเข้าสต็อกจาก Excel → รับเข้า → ตัดออก → รายงานสรุป**

**ห้ามทำใน v0.1** (ถ้าคิดว่าจำเป็น ให้ถามก่อน): ตำแหน่งจัดเก็บระดับโซน/ชั้น/ช่อง, ใบหยิบ, ใบขอซื้อ/ใบสั่งซื้อ,
โอนระหว่างคลัง, ปรับยอด, นับสต็อก, Serial, จองสต็อก, QC, อนุมัติหลายขั้น, BOM/ผลิต, Offline, พิมพ์ฉลาก,
เชื่อม POS/marketplace, หลายบริษัทในฐานเดียว

## 2. Stack

| ส่วน | ใช้ |
|------|-----|
| Frontend | React + Vite + TypeScript + Tailwind + Zustand |
| API | Hono บน Cloudflare Workers (static assets เสิร์ฟ frontend จาก Worker เดียวกัน) |
| ฐานข้อมูล | Cloudflare D1 + Drizzle ORM + migrations ในโฟลเดอร์ `migrations/` |
| Excel | SheetJS อ่านไฟล์ **ในเบราว์เซอร์** แล้วส่ง JSON เข้า API ทีละไม่เกิน 500 แถว (เลี่ยงข้อจำกัด CPU ของ Worker) |
| ทดสอบ | Vitest + `@cloudflare/vitest-pool-workers` (API/logic), Playwright (หน้าจอ) |
| ติดตั้ง | `wrangler.jsonc` ที่ปุ่ม Deploy to Cloudflare ใช้ได้, รัน D1 migrations อัตโนมัติหลัง deploy |

โครงโฟลเดอร์:

```
stocki/
  src/
    api/        # Hono routes, middleware, validation (zod)
    domain/     # stock engine, costing, lot rules — pure functions, ไม่แตะ HTTP
    db/         # drizzle schema + queries
    web/        # React app
  migrations/
  tests/        # vitest
  e2e/          # playwright
  wrangler.jsonc
  CLAUDE.md
  CHANGELOG.md
```

## 3. กฎของเครื่องตัดสต็อก (ห้ามละเมิด)

1. **ทุกการเปลี่ยนยอดผ่าน `postDocument()` ฟังก์ชันเดียว** ห้าม UPDATE `stock_balances` จากที่อื่น
2. `stock_movements` คือความจริง `stock_balances` เป็นแค่ผลรวมเพื่อความเร็ว ต้องมี test ยืนยัน ผลรวม movements = balances เสมอ
3. เขียน movements + balances + สถานะเอกสาร ใน **`db.batch()` ครั้งเดียว** (D1 ไม่มี interactive transaction)
4. ตรวจยอดพอจ่ายด้วยเงื่อนไขใน SQL (`UPDATE … WHERE qty_on_hand >= ?`) แล้วตรวจจำนวนแถวที่ถูกแก้ ห้ามอ่านยอดมาเช็กใน JS แล้วค่อยเขียน
5. ทุกคำขอเขียนต้องมี `Idempotency-Key` ส่งซ้ำแล้วต้องตัดสต็อกครั้งเดียว
6. ห้ามยอดติดลบ
7. ต้นทุน: **ถัวเฉลี่ยเคลื่อนที่** คำนวณใหม่ทุกครั้งที่รับเข้า
8. เอกสารที่บันทึกแล้วแก้ไม่ได้ ยกเลิกด้วย **movement กลับรายการ** ไม่ลบของเดิม
9. **ห้ามใช้ทศนิยมแบบ float เก็บเงินหรือจำนวน**: เก็บเป็น INTEGER ที่คูณสเกล
   - จำนวน (qty) × 1,000 (รองรับ 0.001 กก.)
   - เงิน/ต้นทุน × 10,000
10. วันเวลาเก็บเป็น UTC (ISO 8601) แสดงผลเป็นเวลาไทย; วันที่เอกสาร (`movement_date`) แยกจาก `created_at`

## 4. ล็อตและวันหมดอายุ

- สินค้าแต่ละตัวมีสวิตช์ `track_lot` (ค่าเริ่มต้นปิด)
- เปิดแล้ว ทุกครั้งที่รับเข้าหรือนำเข้ายอดยกมา **บังคับกรอก 5 ช่อง**:
  `lot_no`, `mfg_date`, `expiry_date`, `po_no`, `manufacturer_name` (โรงงานผู้ผลิต)
- `expiry_date` ต้องมาหลัง `mfg_date`
- ล็อตเดียวกัน = สินค้าเดียวกัน + `lot_no` เดียวกัน (unique)
- ตัดออก: ต้องเลือกล็อต ระบบเสนอล็อตที่หมดอายุก่อน (FEFO) และ **ห้ามจ่ายล็อตที่หมดอายุแล้ว**
- สินค้าที่ปิด `track_lot` รับ-จ่ายได้โดยไม่ต้องกรอกข้อมูลล็อต

## 5. ตารางของ v0.1

| ตาราง | ฟิลด์หลัก |
|-------|----------|
| company | id, name, tax_id, branch_code, costing_method ('MOVING_AVG') |
| warehouses | id, code, name, branch_code, is_active |
| units | id, code, name_th, decimal_places |
| categories | id, code, name |
| items | id, sku, name_th, barcode, category_id, unit_id, track_lot, reorder_point_milli, standard_cost_x4, status |
| lots | id, item_id, lot_no, mfg_date, expiry_date, po_no, manufacturer_name, created_at |
| documents | id, doc_type ('OPENING','RECEIVE','ISSUE','CANCEL'), doc_no, doc_date, warehouse_id, status ('DRAFT','POSTED','CANCELLED'), ref_text, note, created_by, posted_by, posted_at, idempotency_key (unique) |
| document_lines | id, document_id, item_id, lot_id, qty_milli, unit_cost_x4 |
| stock_movements | id, document_id, line_id, item_id, lot_id, warehouse_id, movement_date, direction (+1/−1), qty_milli, unit_cost_x4, balance_qty_after_milli, avg_cost_after_x4 |
| stock_balances | item_id, lot_id (NULL ได้), warehouse_id, qty_on_hand_milli, avg_cost_x4, updated_at — PK (item_id, lot_id, warehouse_id) |
| users | id, email, password_hash, role ('OWNER','STAFF'), is_active, failed_logins, locked_until |
| sessions | id, user_id, expires_at |
| audit_logs | id, table_name, record_id, action, old_json, new_json, user_id, at |
| doc_sequences | doc_type, yymm, last_no — เลขเอกสารแบบ `RCV-2611-0001` |

Index ขั้นต่ำ: `items(barcode)`, `items(sku)`, `stock_movements(item_id, warehouse_id, movement_date)`, `lots(item_id, expiry_date)`

## 6. นำเข้า Excel

- ปุ่มดาวน์โหลดไฟล์แม่แบบ คอลัมน์: รหัส, ชื่อ, บาร์โค้ด, หน่วย, หมวด, คลัง, จำนวนยกมา, ต้นทุนต่อหน่วย, จุดสั่งซื้อ,
  ใช้ล็อต (Y/N), Lot No., วันผลิต, วันหมดอายุ, เลขที่ PO, โรงงานผู้ผลิต
- สินค้าที่ใช้ล็อตมีได้หลายแถว (1 แถวต่อ 1 ล็อต)
- ขั้นตอน: อ่านไฟล์ → ตรวจทุกแถว → **แสดงตัวอย่างและรายการแถวผิดพร้อมเลขแถว** → ผู้ใช้ยืนยัน → บันทึกเป็นเอกสาร `OPENING`
- นำเข้าไฟล์เดิมซ้ำ = อัปเดตข้อมูลสินค้า **ไม่สร้างยอดยกมาซ้ำ** (ยอดยกมามีได้ครั้งเดียวต่อสินค้า+ล็อต+คลัง)
- รองรับวันที่ทั้งรูปแบบ วว/ดด/ปปปป (พ.ศ. และ ค.ศ.) และวันที่แบบตัวเลขของ Excel

## 7. ความปลอดภัยขั้นต่ำ (ทุกวัน ไม่ใช่แค่ D5)

- ห้ามมีค่าลับในโค้ดหรือ git ใช้ `wrangler secret` และ `.dev.vars` (อยู่ใน `.gitignore`)
- Secrets ที่แอปต้องใช้: `ADMIN_EMAIL`, `APP_SECRET`
- รหัสผ่าน hash ด้วย PBKDF2-SHA256 ผ่าน WebCrypto (≥ 100,000 รอบ + salt สุ่ม)
- ตรวจ input ทุก API ด้วย zod, ใช้ query แบบ parameter เท่านั้น
- บทบาท STAFF ห้ามเห็นต้นทุน/มูลค่า ทั้งใน API และไฟล์ส่งออก (ตรวจที่ API ไม่ใช่แค่ซ่อนในหน้าจอ)
- Cookie session: `HttpOnly; Secure; SameSite=Lax`
- ทุกการแก้ข้อมูลหลักเขียน `audit_logs`

## 8. คำสั่งที่ต้องมีใน package.json

```
npm run dev            # wrangler dev + vite
npm run typecheck
npm run lint
npm test               # vitest
npm run e2e            # playwright
npm run db:reset       # ล้าง D1 local
npm run db:migrate     # local
npm run db:migrate:remote
npm run secrets:scan   # gitleaks
npm run deploy         # build + wrangler deploy + migrations remote
```

## 9. วิธีทำงานแต่ละวัน

1. ผู้ใช้สั่ง "ทำ D<n>" → อ่านหัวข้อ D<n> ในข้อ 10
2. เขียน test ของงานนั้นก่อน (ให้เห็นว่า fail) แล้วค่อยเขียนโค้ดจนผ่าน
3. ผ่าน **Definition of Done** ทุกข้อ:
   - [ ] `npm run typecheck` และ `npm run lint` ไม่มี error
   - [ ] `npm test` ผ่านทั้งหมด และงานใหม่มี test ของตัวเอง
   - [ ] migration รันบน D1 เปล่าได้ (`npm run db:reset && npm run db:migrate`)
   - [ ] `npm run secrets:scan` ผ่าน
   - [ ] อัปเดต `CHANGELOG.md` ใน commit เดียวกัน
4. Commit แบบ Conventional Commits ระบุวัน เช่น `feat(D3): excel import with lot validation`
5. Push ไป branch `d<n>-<สั้นๆ>` แล้วเปิด PR เข้า `main`
6. ติ๊ก `[x]` ในข้อ 10 ของไฟล์นี้ และสรุปผลเป็นภาษาไทยให้ผู้ใช้: ทำอะไร, ผลของคำสั่งตรวจ (ตัวเลขจริงที่รันได้), สิ่งที่ค้าง
7. ห้ามรายงานว่าเสร็จโดยไม่ได้รันคำสั่งตรวจจริง ถ้าตรวจไม่ผ่าน ให้เขียนหมายเหตุใต้งานแล้วแจ้งผู้ใช้

## 10. Checklist v0.1

- [x] **D1 โครงโปรเจกต์ + ฐานข้อมูล + deploy**
  - ตรวจด้วย: `npm test` ผ่าน, migration รันบน D1 เปล่าได้, `npm run deploy` แล้ว `GET /api/health` ตอบ `{"ok":true}`, ไฟล์ `wrangler.jsonc` ต้องมี `database_id` ของ D1 production อยู่เสมอ (ห้ามลบหรือย้ายไป `.wrangler/wrangler.toml.local` เพราะ Wrangler ไม่อ่านไฟล์นั้น ถ้าไม่มี id นี้ `wrangler deploy` อาจสร้าง D1 ใหม่ที่ว่างเปล่า และคำสั่ง `--remote` จะหาฐานข้อมูลจริงไม่เจอ)
- [x] **D2 ล็อกอิน + หน้าสินค้า**
  - หน้า First-run setup (ตั้งรหัสให้ `ADMIN_EMAIL`), บทบาท OWNER/STAFF, หน้ารายการ/แก้ไขสินค้า ค้นด้วยชื่อหรือบาร์โค้ด, สวิตช์ "ใช้ล็อต/วันหมดอายุ"
  - ตรวจด้วย: test ล็อกอินถูก/ผิด, ล็อกอินผิด 10 ครั้งถูกล็อก 15 นาที, STAFF เรียกข้อมูลต้นทุนได้ 403, ค้นบาร์โค้ดเจอถูกตัว
- [x] **D3 นำเข้าสต็อกจาก Excel** (ตามข้อ 6)
  - ตรวจด้วย: ไฟล์ 1,000 แถวนำเข้าสำเร็จ, แถวผิด (รหัสซ้ำ, จำนวนติดลบ, หน่วยไม่รู้จัก, สินค้าใช้ล็อตแต่ขาดข้อมูลล็อต, วันหมดอายุก่อนวันผลิต) แสดงพร้อมเลขแถวและไม่ถูกบันทึก, นำเข้าไฟล์เดิมซ้ำแล้วยอดไม่เบิ้ล
- [x] **D4 รับเข้า + ตัดออก** (ตามข้อ 3 และ 4)
  - ช่องรายการรับการยิงบาร์โค้ดแบบ keyboard wedge (Enter = เพิ่มรายการ), เตือนเมื่อแป้นพิมพ์เป็นภาษาไทย
  - ตรวจด้วย: รับ 10@100 + 10@120 แล้วต้นทุนเฉลี่ย = 110, จ่ายเกินยอดถูกปฏิเสธ, ยิงจ่ายพร้อมกัน 20 คำขอแล้วยอดไม่ติดลบ, ส่งคำขอซ้ำตัดครั้งเดียว, ยกเลิกแล้วยอดและต้นทุนกลับเท่าเดิม, 3 ล็อตวันหมดอายุต่างกันระบบเสนอล็อตที่หมดก่อน, จ่ายล็อตหมดอายุถูกปฏิเสธ, Playwright สแกน + Enter เพิ่มรายการถูกตัว
- [x] **D5 รายงานสรุป + ทดสอบติดตั้ง**
  - สรุปยอดคงเหลือ/มูลค่า รายสินค้า-หมวด-คลัง, สรุปรับ-จ่ายตามช่วงวันที่, บัตรคุมสินค้ารายตัว, ยอดแยกล็อตพร้อมข้อมูล 5 ช่อง, ใกล้หมดอายุ 30/60/90 วัน, ต่ำกว่าจุดสั่งซื้อ, ส่งออก Excel
  - ตรวจด้วย: ยอดยกมา + รับ − จ่าย = คงเหลือ ทุกสินค้า, Excel ที่ส่งออกตรงกับหน้าจอ, STAFF ไม่เห็นคอลัมน์มูลค่าทั้งหน้าจอและไฟล์, กดปุ่ม Deploy to Cloudflare จากบัญชีใหม่แล้วใช้งานได้
