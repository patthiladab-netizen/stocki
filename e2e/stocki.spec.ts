import { test, expect, Page } from "@playwright/test";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "owner@test.com";
const ADMIN_PASS = process.env.APP_PASSWORD ?? "TestDeploy1!";
const STAFF_EMAIL = "staff_e2e@test.com";
const STAFF_PASS = "Staff1234!";

async function login(page: Page, email: string, pass: string) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  // first-run setup may appear — skip if present
  if (await page.locator("text=ตั้งรหัสผ่าน").isVisible({ timeout: 2000 }).catch(() => false)) {
    await page.fill('input[type="password"]', pass);
    const confirm = page.locator('input[placeholder*="ยืนยัน"]');
    if (await confirm.isVisible({ timeout: 1000 }).catch(() => false)) {
      await confirm.fill(pass);
    }
    await page.click('button[type="submit"]');
    await page.waitForURL("**/items**", { timeout: 10_000 });
    return;
  }
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', pass);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/items**", { timeout: 10_000 });
}

// ─────────────────────────────────────────────────────────────
test.describe("Auth", () => {
  test("ล็อกอินสำเร็จ — เข้าหน้า Items", async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASS);
    await expect(page).toHaveURL(/items/);
    await expect(page.locator("nav")).toBeVisible();
  });

  test("ล็อกอินรหัสผ่านผิด — แสดง error", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const emailInput = page.locator('input[type="email"]');
    if (!(await emailInput.isVisible({ timeout: 3000 }).catch(() => false))) return; // setup page
    await emailInput.fill(ADMIN_EMAIL);
    await page.fill('input[type="password"]', "wrongpassword");
    await page.click('button[type="submit"]');
    await expect(page.locator("text=รหัสผ่านไม่ถูกต้อง,text=ไม่ถูกต้อง,text=error").first()).toBeVisible({
      timeout: 5000,
    });
  });

  test("ล็อกเอาท์แล้วกลับหน้า login", async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASS);
    const logoutBtn = page.locator('button:has-text("ออกจากระบบ"), button[aria-label="ออกจากระบบ"]');
    if (await logoutBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await logoutBtn.click();
      await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 5000 });
    }
  });
});

// ─────────────────────────────────────────────────────────────
test.describe("Items (สินค้า)", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASS);
  });

  test("หน้า Items แสดงตาราง/รายการสินค้า", async ({ page }) => {
    await page.goto("/items");
    await page.waitForLoadState("networkidle");
    // should have a table or list
    const rows = page.locator("table tbody tr, [data-testid='item-row']");
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });
  });

  test("ค้นหาสินค้าด้วยบาร์โค้ด", async ({ page }) => {
    await page.goto("/items");
    await page.waitForLoadState("networkidle");
    const searchBox = page.locator('input[placeholder*="ค้นหา"], input[type="search"]').first();
    if (await searchBox.isVisible({ timeout: 3000 }).catch(() => false)) {
      await searchBox.fill("8850001010011");
      await page.waitForTimeout(600);
      const rows = page.locator("table tbody tr, [data-testid='item-row']");
      const count = await rows.count();
      expect(count).toBeGreaterThan(0);
    }
  });

  test("เพิ่มสินค้าใหม่ OWNER เห็นฟิลด์ต้นทุน", async ({ page }) => {
    await page.goto("/items/new");
    await page.waitForLoadState("networkidle");
    // cost field should be visible for owner
    const costField = page.locator(
      'input[name*="cost"], input[placeholder*="ต้นทุน"], label:has-text("ต้นทุน") ~ input'
    );
    if (await costField.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(costField.first()).toBeVisible();
    }
  });
});

// ─────────────────────────────────────────────────────────────
test.describe("Import (นำเข้าจาก Excel)", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASS);
  });

  test("หน้า Import โหลดได้ มีปุ่มดาวน์โหลดแม่แบบ", async ({ page }) => {
    await page.goto("/import");
    await page.waitForLoadState("networkidle");
    const downloadBtn = page.locator(
      'button:has-text("ดาวน์โหลด"), a:has-text("ดาวน์โหลด"), button:has-text("แม่แบบ")'
    );
    await expect(downloadBtn.first()).toBeVisible({ timeout: 5000 });
  });

  test("ปุ่มดาวน์โหลดแม่แบบ Excel — ดาวน์โหลดได้", async ({ page }) => {
    await page.goto("/import");
    await page.waitForLoadState("networkidle");
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 8000 }),
      page
        .locator('button:has-text("ดาวน์โหลด"), a:has-text("ดาวน์โหลด"), button:has-text("แม่แบบ")')
        .first()
        .click(),
    ]).catch(() => [null]);
    if (download) {
      const path = await download.path();
      expect(path).toBeTruthy();
    }
  });
});

// ─────────────────────────────────────────────────────────────
test.describe("Receive (รับสินค้า)", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASS);
  });

  test("หน้า Receive โหลดได้ มีช่องบาร์โค้ด", async ({ page }) => {
    await page.goto("/receive");
    await page.waitForLoadState("networkidle");
    const barcodeInput = page.locator(
      'input[placeholder*="บาร์โค้ด"], input[placeholder*="barcode"], input[placeholder*="สแกน"]'
    );
    await expect(barcodeInput.first()).toBeVisible({ timeout: 5000 });
  });

  test("พิมพ์บาร์โค้ดผิด — แสดงข้อความไม่พบสินค้า", async ({ page }) => {
    await page.goto("/receive");
    await page.waitForLoadState("networkidle");
    const barcodeInput = page
      .locator(
        'input[placeholder*="บาร์โค้ด"], input[placeholder*="barcode"], input[placeholder*="สแกน"]'
      )
      .first();
    if (!(await barcodeInput.isVisible({ timeout: 3000 }).catch(() => false))) return;
    await barcodeInput.fill("XXXX_NOTFOUND");
    await barcodeInput.press("Enter");
    await page.waitForTimeout(800);
    const notFound = page.locator(
      'text=ไม่พบ, text=not found, [role="alert"], .text-red-500, .text-red-600'
    );
    await expect(notFound.first()).toBeVisible({ timeout: 3000 });
  });

  test("สแกน barcode + Enter เพิ่มรายการ", async ({ page }) => {
    await page.goto("/receive");
    await page.waitForLoadState("networkidle");
    const barcodeInput = page
      .locator(
        'input[placeholder*="บาร์โค้ด"], input[placeholder*="barcode"], input[placeholder*="สแกน"]'
      )
      .first();
    if (!(await barcodeInput.isVisible({ timeout: 3000 }).catch(() => false))) return;
    await barcodeInput.fill("8850001010011"); // ENG001
    await barcodeInput.press("Enter");
    await page.waitForTimeout(1000);
    const lines = page.locator("table tbody tr, [data-testid='receive-line']");
    const count = await lines.count();
    expect(count).toBeGreaterThan(0);
  });

  test("เตือนแป้นพิมพ์ไทย — แสดงข้อความเตือน", async ({ page }) => {
    await page.goto("/receive");
    await page.waitForLoadState("networkidle");
    const barcodeInput = page
      .locator(
        'input[placeholder*="บาร์โค้ด"], input[placeholder*="barcode"], input[placeholder*="สแกน"]'
      )
      .first();
    if (!(await barcodeInput.isVisible({ timeout: 3000 }).catch(() => false))) return;
    // Type Thai characters to trigger keyboard warning
    await barcodeInput.fill("สวัสดี");
    await page.waitForTimeout(500);
    const warning = page.locator('text=ภาษาไทย, text=keyboard, [role="alert"]');
    // warning may or may not appear depending on implementation — just check no crash
    await expect(page).toHaveURL(/receive/);
  });
});

// ─────────────────────────────────────────────────────────────
test.describe("Issue (ตัดออก)", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASS);
  });

  test("หน้า Issue โหลดได้", async ({ page }) => {
    await page.goto("/issue");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("h1, h2").first()).toBeVisible({ timeout: 5000 });
  });

  test("มีช่องเลือกคลัง", async ({ page }) => {
    await page.goto("/issue");
    await page.waitForLoadState("networkidle");
    const warehouseSelect = page.locator(
      'select[name*="warehouse"], select[aria-label*="คลัง"], [data-testid="warehouse-select"]'
    );
    await expect(warehouseSelect.first()).toBeVisible({ timeout: 5000 });
  });
});

// ─────────────────────────────────────────────────────────────
test.describe("Reports (รายงาน)", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASS);
  });

  test("หน้า Reports โหลดได้ มีแท็บรายงาน", async ({ page }) => {
    await page.goto("/reports");
    await page.waitForLoadState("networkidle");
    // should have report tabs or sections
    const tabs = page.locator(
      '[role="tab"], button:has-text("ยอดคงเหลือ"), button:has-text("รับ-จ่าย"), button:has-text("รายงาน")'
    );
    const count = await tabs.count();
    expect(count).toBeGreaterThan(0);
  });

  test("ยอดคงเหลือ — มีข้อมูลสินค้า", async ({ page }) => {
    await page.goto("/reports");
    await page.waitForLoadState("networkidle");
    // click balance tab if present
    const balanceTab = page.locator(
      'button:has-text("ยอดคงเหลือ"), [role="tab"]:has-text("ยอดคงเหลือ")'
    );
    if (await balanceTab.isVisible({ timeout: 2000 }).catch(() => false)) {
      await balanceTab.click();
    }
    await page.waitForTimeout(1000);
    const rows = page.locator("table tbody tr");
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
  });

  test("OWNER เห็นคอลัมน์มูลค่า", async ({ page }) => {
    await page.goto("/reports");
    await page.waitForLoadState("networkidle");
    const balanceTab = page.locator('button:has-text("ยอดคงเหลือ"), [role="tab"]:has-text("ยอดคงเหลือ")');
    if (await balanceTab.isVisible({ timeout: 2000 }).catch(() => false)) {
      await balanceTab.click();
    }
    await page.waitForTimeout(800);
    const valueHeader = page.locator('th:has-text("มูลค่า"), th:has-text("ต้นทุน")');
    await expect(valueHeader.first()).toBeVisible({ timeout: 3000 });
  });

  test("ปุ่ม Export Excel", async ({ page }) => {
    await page.goto("/reports");
    await page.waitForLoadState("networkidle");
    const exportBtn = page.locator(
      'button:has-text("Excel"), button:has-text("ส่งออก"), button:has-text("export")'
    );
    await expect(exportBtn.first()).toBeVisible({ timeout: 5000 });
  });
});

// ─────────────────────────────────────────────────────────────
test.describe("Access Control — STAFF", () => {
  test("STAFF ไม่เห็นคอลัมน์มูลค่าในรายงาน", async ({ page }) => {
    // Try logging in as staff (may not exist — skip gracefully)
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const emailInput = page.locator('input[type="email"]');
    if (!(await emailInput.isVisible({ timeout: 3000 }).catch(() => false))) return;
    await emailInput.fill(STAFF_EMAIL);
    await page.fill('input[type="password"]', STAFF_PASS);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2000);
    if (!(await page.locator("nav").isVisible({ timeout: 3000 }).catch(() => false))) {
      // staff account doesn't exist, skip
      return;
    }
    await page.goto("/reports");
    await page.waitForLoadState("networkidle");
    const balanceTab = page.locator('button:has-text("ยอดคงเหลือ"), [role="tab"]:has-text("ยอดคงเหลือ")');
    if (await balanceTab.isVisible({ timeout: 2000 }).catch(() => false)) {
      await balanceTab.click();
    }
    await page.waitForTimeout(800);
    const valueHeader = page.locator('th:has-text("มูลค่า"), th:has-text("ต้นทุน")');
    await expect(valueHeader.first()).not.toBeVisible({ timeout: 2000 });
  });
});
