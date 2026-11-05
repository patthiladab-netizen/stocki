import { parseThaiDate } from "./dateParser";

export type ImportRow = {
  rowNum: number;
  sku: string;
  name_th: string;
  barcode?: string;
  unit_code: string;
  category_code?: string;
  warehouse_code: string;
  qty: number;          // จำนวน (หน่วยปกติ)
  unit_cost: number;    // ต้นทุนต่อหน่วย (หน่วยปกติ)
  reorder_point?: number;
  track_lot: boolean;
  lot_no?: string;
  mfg_date?: string;
  expiry_date?: string;
  po_no?: string;
  manufacturer_name?: string;
};

export type ImportRowError = {
  rowNum: number;
  errors: string[];
};

export type ValidateResult = {
  valid: ImportRow[];
  errors: ImportRowError[];
};

/** Normalize a row object so column headers with/without (Y/N), spaces, full-width chars match */
function normalizeRow(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    // strip parenthetical suffixes e.g. " (Y/N)" and trim
    const normalized = k.replace(/\s*\([^)]*\)\s*$/, "").trim();
    out[k] = v;          // keep original key too
    if (normalized !== k) out[normalized] = v; // add normalized alias
  }
  return out;
}

export function validateImportRows(
  rawRows: Record<string, unknown>[],
  knownUnitCodes: Set<string>,
  knownWarehouseCodes: Set<string>,
  existingBarcodes: Map<string, string> = new Map(),
): ValidateResult {
  const valid: ImportRow[] = [];
  const errors: ImportRowError[] = [];
  const seenSkuLotWarehouse = new Set<string>();
  const barcodeFirstSeen = new Map<string, { rowNum: number; sku: string }>();

  for (let i = 0; i < rawRows.length; i++) {
    const rowNum = i + 2; // แถวที่ 1 คือ header
    const raw = normalizeRow(rawRows[i]);
    const rowErrors: string[] = [];

    const sku = String(raw["รหัส"] ?? "").trim();
    const name_th = String(raw["ชื่อ"] ?? "").trim();
    const barcode = String(raw["บาร์โค้ด"] ?? "").trim() || undefined;
    const unit_code = String(raw["หน่วย"] ?? "").trim();
    const category_code = String(raw["หมวด"] ?? "").trim() || undefined;
    const warehouse_code = String(raw["คลัง"] ?? "").trim();
    const qtyRaw = Number(raw["จำนวนยกมา"]);
    const unit_cost_raw = Number(raw["ต้นทุนต่อหน่วย"] ?? 0);
    const reorder_raw = raw["จุดสั่งซื้อ"] !== undefined ? Number(raw["จุดสั่งซื้อ"]) : undefined;
    const track_lot_raw = String(raw["ใช้ล็อต (Y/N)"] ?? raw["ใช้ล็อต"] ?? "N").trim().toUpperCase();
    const track_lot = ["Y", "YES", "TRUE", "1", "ใช่", "ใช้"].includes(track_lot_raw);
    const lot_no = String(raw["Lot No."] ?? "").trim() || undefined;
    const mfg_raw = raw["วันผลิต"];
    const exp_raw = raw["วันหมดอายุ"];
    const po_no = String(raw["เลขที่ PO"] ?? "").trim() || undefined;
    const manufacturer_name = String(raw["โรงงานผู้ผลิต"] ?? "").trim() || undefined;

    if (!sku) rowErrors.push("ไม่มีรหัสสินค้า");
    if (!name_th) rowErrors.push("ไม่มีชื่อสินค้า");
    if (!unit_code) rowErrors.push("ไม่มีหน่วย");
    else if (!knownUnitCodes.has(unit_code)) rowErrors.push(`หน่วยไม่รู้จัก: ${unit_code}`);
    if (!warehouse_code) rowErrors.push("ไม่มีรหัสคลัง");
    else if (!knownWarehouseCodes.has(warehouse_code)) rowErrors.push(`คลังไม่รู้จัก: ${warehouse_code}`);
    if (isNaN(qtyRaw)) rowErrors.push("จำนวนยกมาไม่ใช่ตัวเลข");
    else if (qtyRaw < 0) rowErrors.push("จำนวนยกมาติดลบไม่ได้");
    if (isNaN(unit_cost_raw) || unit_cost_raw < 0) rowErrors.push("ต้นทุนต่อหน่วยไม่ถูกต้อง");

    let mfg_date: string | null = null;
    let expiry_date: string | null = null;

    if (track_lot) {
      if (!lot_no) rowErrors.push("สินค้าใช้ล็อตต้องระบุ Lot No.");
      if (!po_no) rowErrors.push("สินค้าใช้ล็อตต้องระบุเลขที่ PO");
      if (!manufacturer_name) rowErrors.push("สินค้าใช้ล็อตต้องระบุโรงงานผู้ผลิต");

      mfg_date = mfg_raw ? parseThaiDate(mfg_raw as string | number) : null;
      expiry_date = exp_raw ? parseThaiDate(exp_raw as string | number) : null;

      if (!mfg_date) rowErrors.push("วันผลิตไม่ถูกต้อง");
      if (!expiry_date) rowErrors.push("วันหมดอายุไม่ถูกต้อง");
      if (mfg_date && expiry_date && expiry_date <= mfg_date) {
        rowErrors.push("วันหมดอายุต้องมาหลังวันผลิต");
      }
    }

    // ตรวจ duplicate sku+lot_no+warehouse ในไฟล์เดียวกัน
    const dupKey = `${sku}|${lot_no ?? ""}|${warehouse_code}`;
    if (seenSkuLotWarehouse.has(dupKey)) {
      rowErrors.push("รหัสสินค้า+ล็อต+คลังซ้ำกันในไฟล์");
    } else {
      seenSkuLotWarehouse.add(dupKey);
    }

    if (barcode && sku) {
      const ownerSku = existingBarcodes.get(barcode);
      if (ownerSku && ownerSku !== sku) {
        rowErrors.push(`บาร์โค้ด ${barcode} ซ้ำกับสินค้า ${ownerSku}`);
      }
      const first = barcodeFirstSeen.get(barcode);
      if (!first) barcodeFirstSeen.set(barcode, { rowNum, sku });
      else if (first.sku !== sku) rowErrors.push(`บาร์โค้ด ${barcode} ซ้ำกับแถว ${first.rowNum} (SKU ${first.sku})`);
    }

    if (rowErrors.length > 0) {
      errors.push({ rowNum, errors: rowErrors });
    } else {
      valid.push({
        rowNum,
        sku,
        name_th,
        barcode,
        unit_code,
        category_code,
        warehouse_code,
        qty: qtyRaw,
        unit_cost: unit_cost_raw,
        reorder_point: reorder_raw,
        track_lot,
        lot_no,
        mfg_date: mfg_date ?? undefined,
        expiry_date: expiry_date ?? undefined,
        po_no,
        manufacturer_name,
      });
    }
  }

  return { valid, errors };
}
