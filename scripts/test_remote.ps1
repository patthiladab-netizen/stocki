# วิธีใช้:  .\scripts\test_remote.ps1  (รันใน PowerShell จากโฟลเดอร์โปรเจกต์)
param(
  [string]$Base = "https://stocki.admarsmedia.workers.dev"
)

$ErrorActionPreference = "Continue"
$RunId = (Get-Date -UFormat "%s").Substring((Get-Date -UFormat "%s").Length - 5)
$Session = [System.IO.Path]::GetTempFileName() + ".txt"
$Pass = 0; $Fail = 0
$AllIssues = @()

function ok   { param($msg) Write-Host "  `u{2705}  $msg" -ForegroundColor Green;  $script:Pass++ }
function fail { param($msg) Write-Host "  `u{274C}  $msg" -ForegroundColor Red;    $script:Fail++; $script:AllIssues += $msg }

function Invoke-Api {
  param([string]$Method="GET",[string]$Path,[string]$Body="",[switch]$NoAuth,[string]$IdempotencyKey="")
  $uri = "$Base$Path"
  $headers = @{ "Content-Type" = "application/json" }
  if ($IdempotencyKey) { $headers["Idempotency-Key"] = $IdempotencyKey }
  if (-not $NoAuth -and (Test-Path $Session)) {
    $cookie = Get-Content $Session -Raw
    if ($cookie) { $headers["Cookie"] = $cookie.Trim() }
  }
  try {
    if ($Body) {
      $r = Invoke-WebRequest -Uri $uri -Method $Method -Headers $headers -Body $Body -UseBasicParsing -SkipHttpErrorCheck
    } else {
      $r = Invoke-WebRequest -Uri $uri -Method $Method -Headers $headers -UseBasicParsing -SkipHttpErrorCheck
    }
    # บันทึก Set-Cookie ถ้ามี
    if ($r.Headers["Set-Cookie"]) {
      $r.Headers["Set-Cookie"] | ForEach-Object {
        $c = $_ -replace ";.*",""
        Add-Content $Session $c
      }
    }
    return @{ Status = [int]$r.StatusCode; Body = $r.Content }
  } catch {
    return @{ Status = 0; Body = $_.Exception.Message }
  }
}

$AdminEmail = $env:ADMIN_EMAIL
if (-not $AdminEmail) {
  # อ่านจาก .dev.vars ถ้ามี
  if (Test-Path ".dev.vars") {
    $AdminEmail = (Get-Content ".dev.vars" | Where-Object { $_ -match "^ADMIN_EMAIL=" }) -replace "^ADMIN_EMAIL=",""
  }
}
if (-not $AdminEmail) { $AdminEmail = Read-Host "กรอก ADMIN_EMAIL" }
$Password = $env:APP_PASSWORD
if (-not $Password) { $Password = Read-Host "กรอก password" -AsSecureString | ForEach-Object { [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($_)) } }

Write-Host "`n======  Stocki Remote Test  ======" -ForegroundColor Cyan
Write-Host "BASE = $Base`n"

# ━━ 0 · Health ━━
Write-Host "[0;34m━━ 0 · Health check ━━[0m"
$r = Invoke-Api -Path "/api/health" -NoAuth
$j = $r.Body | ConvertFrom-Json -ErrorAction SilentlyContinue
if ($j.ok -eq $true) { ok "GET /api/health → ok:true" } else { fail "health ผิด: $($r.Body)" }

# ━━ 1 · Setup ━━
Write-Host "[0;34m━━ 1 · First-run setup ━━[0m"
$setupBody = '{"password":"' + $Password + '"}'
$r = Invoke-Api -Method POST -Path "/api/setup" -Body $setupBody -NoAuth
$j = $r.Body | ConvertFrom-Json -ErrorAction SilentlyContinue
if ($r.Status -in 200,409 -or $j.ok -eq $true -or $j.error -eq "already_configured") { ok "setup OK (status=$($r.Status))" } else { fail "setup ผิด: $($r.Body)" }

# ━━ 2 · Login ━━
Write-Host "[0;34m━━ 2 · Login OWNER ━━[0m"
Remove-Item $Session -ErrorAction SilentlyContinue; New-Item $Session -Force | Out-Null
$loginBody = '{"email":"' + $AdminEmail + '","password":"' + $Password + '"}'
$r = Invoke-Api -Method POST -Path "/api/auth/login" -Body $loginBody -NoAuth
$j = $r.Body | ConvertFrom-Json -ErrorAction SilentlyContinue
if ($j.ok -eq $true) { ok "Login สำเร็จ role=$($j.role)" } else { fail "Login ล้มเหลว: $($r.Body)" }

# บันทึก session cookie
if ($r.Status -eq 200) {
  # cookie ถูกเก็บใน $Session แล้วจาก Set-Cookie
}

# ━━ 3 · Warehouses ━━
Write-Host "[0;34m━━ 3 · Warehouses ━━[0m"
$r = Invoke-Api -Path "/api/warehouses"
$j = $r.Body | ConvertFrom-Json -ErrorAction SilentlyContinue
$whCount = ($j.warehouses | Measure-Object).Count
if ($whCount -ge 1) { ok "warehouses=$whCount" } else { fail "ไม่มี warehouse: $($r.Body)" }

# ━━ 4 · Import ━━
Write-Host "[0;34m━━ 4 · Import opening balance ━━[0m"
$importKey = "ps-test-$RunId-noLot"
$importBody = @{
  idempotency_key = $importKey
  rows = @(
    @{ rowNum=1; รหัส="PSTEST-$RunId"; ชื่อ="Test Item $RunId"; หน่วย="EA"; คลัง="คลัง A"; จำนวนยกมา=500; ต้นทุนต่อหน่วย=120 },
    @{ rowNum=2; รหัส="PSTEST2-$RunId"; ชื่อ="Test Item2 $RunId"; หน่วย="EA"; คลัง="คลัง A"; จำนวนยกมา=100; ต้นทุนต่อหน่วย=200 }
  )
} | ConvertTo-Json -Depth 5
$r = Invoke-Api -Method POST -Path "/api/import/opening" -Body $importBody -IdempotencyKey $importKey
$j = $r.Body | ConvertFrom-Json -ErrorAction SilentlyContinue
if ($j.ok -eq $true) { ok "Import สำเร็จ doc_ids=$($j.doc_ids)" } else { fail "Import ล้มเหลว: $($r.Body)" }

# ━━ 5 · Import ซ้ำ (idempotency) ━━
Write-Host "[0;34m━━ 5 · Import ซ้ำ (idempotency) ━━[0m"
$r = Invoke-Api -Method POST -Path "/api/import/opening" -Body $importBody -IdempotencyKey $importKey
$j = $r.Body | ConvertFrom-Json -ErrorAction SilentlyContinue
if ($j.already_imported -eq $true) { ok "Import ซ้ำ → already_imported" } else { fail "Idempotency ผิด: $($r.Body)" }

# ━━ 6 · Items list ━━
Write-Host "[0;34m━━ 6 · Items list ━━[0m"
$r = Invoke-Api -Path "/api/items?q=PSTEST-$RunId"
$j = $r.Body | ConvertFrom-Json -ErrorAction SilentlyContinue
$item = $j.items | Where-Object { $_.sku -eq "PSTEST-$RunId" } | Select-Object -First 1
if ($item) { ok "พบ PSTEST-$RunId id=$($item.id)" } else { fail "ไม่พบ item: $($r.Body)" }
$itemId = $item.id

# ━━ 7 · RECEIVE ━━
Write-Host "[0;34m━━ 7 · RECEIVE 200@130 ━━[0m"
$rcvKey = "ps-rcv1-$RunId"
if ($itemId) {
  $rcvBody = @{
    warehouse_code = "คลัง A"
    doc_date       = (Get-Date -Format "yyyy-MM-dd")
    ref_text       = "Test RCV"
    lines          = @(@{ item_id=$itemId; lot_id=0; qty=200; unit_cost=130 })
  } | ConvertTo-Json -Depth 5
  $r = Invoke-Api -Method POST -Path "/api/documents/receive" -Body $rcvBody -IdempotencyKey $rcvKey
  $j = $r.Body | ConvertFrom-Json -ErrorAction SilentlyContinue
  if ($j.ok -eq $true) { ok "RECEIVE สำเร็จ doc_no=$($j.doc_no)" } else { fail "RECEIVE ล้มเหลว: $($r.Body)" }
} else { fail "ข้ามเพราะไม่มี item_id" }

# ━━ 8 · Balance check ━━
Write-Host "[0;34m━━ 8 · Balance report ━━[0m"
$r = Invoke-Api -Path "/api/reports/balance?warehouse_code=คลัง A"
$j = $r.Body | ConvertFrom-Json -ErrorAction SilentlyContinue
$row = $j.rows | Where-Object { $_.sku -eq "PSTEST-$RunId" } | Select-Object -First 1
if ($row) { ok "Balance PSTEST-$RunId qty=$($row.qty_on_hand) avg_cost=$($row.avg_cost)" } else { fail "ไม่พบ balance row" }

# ━━ 9 · ISSUE ━━
Write-Host "[0;34m━━ 9 · ISSUE 50 ━━[0m"
$issueKey = "ps-iss1-$RunId"
if ($itemId) {
  $issueBody = @{
    warehouse_code = "คลัง A"
    doc_date       = (Get-Date -Format "yyyy-MM-dd")
    ref_text       = "Test ISS"
    lines          = @(@{ item_id=$itemId; lot_id=0; qty=50; unit_cost=0 })
  } | ConvertTo-Json -Depth 5
  $r = Invoke-Api -Method POST -Path "/api/documents/issue" -Body $issueBody -IdempotencyKey $issueKey
  $j = $r.Body | ConvertFrom-Json -ErrorAction SilentlyContinue
  if ($j.ok -eq $true) { ok "ISSUE สำเร็จ doc_no=$($j.doc_no)" } else { fail "ISSUE ล้มเหลว: $($r.Body)" }
} else { fail "ข้ามเพราะไม่มี item_id" }

# ━━ 10 · ISSUE เกินยอด ━━
Write-Host "[0;34m━━ 10 · ISSUE เกินยอด → ต้องปฏิเสธ ━━[0m"
$issueKey2 = "ps-iss-overflow-$RunId"
if ($itemId) {
  $overBody = @{
    warehouse_code = "คลัง A"
    doc_date       = (Get-Date -Format "yyyy-MM-dd")
    ref_text       = "overflow"
    lines          = @(@{ item_id=$itemId; lot_id=0; qty=99999; unit_cost=0 })
  } | ConvertTo-Json -Depth 5
  $r = Invoke-Api -Method POST -Path "/api/documents/issue" -Body $overBody -IdempotencyKey $issueKey2
  if ($r.Status -eq 422) { ok "ISSUE เกินยอด → 422 ถูกต้อง" } else { fail "ISSUE เกินยอด ไม่ถูกปฏิเสธ status=$($r.Status)" }
} else { fail "ข้าม" }

# ━━ 11 · Reports ━━
Write-Host "[0;34m━━ 11 · Reports (movements, stock card, expiring, reorder) ━━[0m"
$r = Invoke-Api -Path "/api/reports/movements?warehouse_code=คลัง A"
$j = $r.Body | ConvertFrom-Json -ErrorAction SilentlyContinue
if ($j.rows -or $j.movements) { ok "movements report ตอบสนอง" } else { fail "movements report ผิด: $($r.Body.Substring(0,[Math]::Min(200,$r.Body.Length)))" }

$r = Invoke-Api -Path "/api/reports/expiring?days=90"
$j = $r.Body | ConvertFrom-Json -ErrorAction SilentlyContinue
if ($r.Status -eq 200) { ok "expiring report ตอบสนอง" } else { fail "expiring ผิด: $($r.Status)" }

$r = Invoke-Api -Path "/api/reports/reorder"
$j = $r.Body | ConvertFrom-Json -ErrorAction SilentlyContinue
if ($r.Status -eq 200) { ok "reorder report ตอบสนอง" } else { fail "reorder ผิด: $($r.Status)" }

$r = Invoke-Api -Path "/api/reports/balance/export"
if ($r.Status -eq 200) { ok "Excel export → HTTP 200" } else { fail "export ผิด: $($r.Status)" }

# ━━ 12 · Login ผิด ━━
Write-Host "[0;34m━━ 12 · Login ผิดรหัส ━━[0m"
$badBody = '{"email":"' + $AdminEmail + '","password":"wrongpassword_xyz"}'
$r = Invoke-Api -Method POST -Path "/api/auth/login" -Body $badBody -NoAuth
$j = $r.Body | ConvertFrom-Json -ErrorAction SilentlyContinue
if ($r.Status -eq 401) { ok "Login ผิดรหัส → 401" } else { fail "Login ผิด ไม่ได้ 401 status=$($r.Status)" }

# ━━ 13 · Logout ━━
Write-Host "[0;34m━━ 13 · Logout ━━[0m"
$r = Invoke-Api -Method POST -Path "/api/auth/logout"
if ($r.Status -in 200,204) { ok "Logout สำเร็จ" } else { fail "Logout ผิด: $($r.Status)" }

$r = Invoke-Api -Path "/api/items"
if ($r.Status -eq 401) { ok "หลัง logout → 401 unauthorized" } else { fail "หลัง logout ยังเข้าได้ status=$($r.Status)" }

# ━━ สรุป ━━
Write-Host "`n════════════════════════════════════════"
Write-Host "  ผลรวม:  " -NoNewline
Write-Host "PASS=$Pass" -ForegroundColor Green -NoNewline
Write-Host "  " -NoNewline
if ($Fail -gt 0) {
  Write-Host "FAIL=$Fail" -ForegroundColor Red
  Write-Host "`nปัญหาที่พบ:" -ForegroundColor Yellow
  $AllIssues | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
} else {
  Write-Host "FAIL=$Fail" -ForegroundColor Green
  Write-Host "  ✅ ทุก test ผ่าน!" -ForegroundColor Green
}
Write-Host "════════════════════════════════════════`n"

Remove-Item $Session -ErrorAction SilentlyContinue
