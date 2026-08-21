# =====================================================================
#  EduPulse Push Worker — SETUP MỘT LẦN (Windows PowerShell 5.1)
#  Chạy:  powershell -ExecutionPolicy Bypass -File .\setup.ps1
#  Yêu cầu: Node.js 18+, tài khoản Cloudflare miễn phí (dash.cloudflare.com/sign-up)
#  Script tự động: login → tạo KV → cài secret → deploy →
#                  điền URL worker vào js/push-config.js → deploy hosting
# =====================================================================
$root = Split-Path -Parent $PSScriptRoot
Set-Location $PSScriptRoot

function Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }

function CheckExit($stepName) {
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[LOI] $stepName that bai (ma $LASTEXITCODE)." -ForegroundColor Red
    exit 1
  }
}

# 0. Kiem tra vapid-private.txt
if (-not (Test-Path 'vapid-private.txt')) {
  Write-Host 'THIEU vapid-private.txt - chay: node generate-vapid.mjs' -ForegroundColor Red
  exit 1
}

# 1. Dang nhap (bo qua neu da dang nhap)
$who = npx wrangler@latest whoami 2>&1
if ($LASTEXITCODE -ne 0 -or $who -match 'Not logged in') {
  Step 'Dang nhap Cloudflare (mo trinh duyet - lan dau can xac nhan Allow)'
  npx wrangler@latest login 2>&1 | Out-Null
  CheckExit 'Login Cloudflare'
} else {
  Write-Host 'Da dang nhap Cloudflare - bo qua login.' -ForegroundColor Green
}

# 2. KV namespace: dung ID co san trong wrangler.toml, neu khong thi tao moi
Step 'Tao/lay KV namespace PUSH_SUBS'
$tomlRaw = Get-Content 'wrangler.toml' -Raw
$kvId = $null
if ($tomlRaw -match 'id = "([a-f0-9]{32})"') {
  $kvId = $Matches[1]
  Write-Host "Da co KV ID trong wrangler.toml: $kvId" -ForegroundColor Green
} else {
  $kvOutput = npx wrangler@latest kv namespace create PUSH_SUBS 2>&1
  if ($LASTEXITCODE -eq 0) {
    $kvId = ($kvOutput | Select-String -Pattern '([a-f0-9]{32})' | ForEach-Object { $_.Matches[0].Groups[1].Value } | Select-Object -First 1)
  } else {
    # Co the da ton tai (chay lai) -> tim trong danh sach
    $listOutput = npx wrangler@latest kv namespace list 2>&1
    $kvId = ($listOutput | Select-String -Pattern '([a-f0-9]{32})[^a-f0-9]{0,50}PUSH_SUBS' | ForEach-Object { $_.Matches[0].Groups[1].Value } | Select-Object -First 1)
  }
  if (-not $kvId) {
    Write-Host 'Khong tim duoc KV ID. Ket qua:' -ForegroundColor Red
    Write-Host $kvOutput
    Write-Host $listOutput
    exit 1
  }
  $toml = $tomlRaw -replace 'id = "REPLACE_WITH_KV_ID"', ('id = "' + $kvId + '"')
  Set-Content 'wrangler.toml' $toml -Encoding UTF8
  Write-Host "KV ID: $kvId" -ForegroundColor Green
}

Step 'Cai secret VAPID_PRIVATE (khoa bi mat)'
# Lua y: khong dung pipe cua PowerShell 5.1 (hay lam hong key do encoding).
# Dung `cmd /c type` de truyen dung tung byte file.
cmd /c "type vapid-private.txt | npx wrangler@latest secret put VAPID_PRIVATE" 2>&1 | Out-Null
CheckExit 'Cai secret VAPID_PRIVATE'

Step 'Deploy worker len Cloudflare'
$deployOutput = npx wrangler@latest deploy 2>&1
CheckExit 'Deploy worker'
Write-Host $deployOutput

# Lay URL worker tu nhieu dinh dang output cua wrangler (v3/v4 khac nhau)
$workerUrl = $null
if ($deployOutput | Select-String -Pattern 'https://[a-z0-9-]+\.workers\.dev') {
  $workerUrl = ($deployOutput | Select-String -Pattern 'https://[a-z0-9-]+\.workers\.dev' | ForEach-Object { $_.Matches[0].Value } | Select-Object -First 1)
}
if (-not $workerUrl -and ($deployOutput | Select-String -Pattern 'workers\.dev')) {
  # Output co chuoi workers.dev nhung regex co the khong khop -> thay ca dong co URL
  $workerUrl = ($deployOutput | Select-String -Pattern 'https?://\S*workers\.dev' | ForEach-Object { $_.Matches[0].Value.TrimEnd(')') } | Select-Object -First 1)
}
if (-not $workerUrl) {
  # Fallback 1: lay tu wrangler deployments list
  try {
    $depOutput = npx wrangler@latest deployments list 2>&1
    if ($depOutput | Select-String -Pattern 'https://[a-z0-9-]+\.workers\.dev') {
      $workerUrl = ($depOutput | Select-String -Pattern 'https://[a-z0-9-]+\.workers\.dev' | ForEach-Object { $_.Matches[0].Value } | Select-Object -First 1)
    }
  } catch { }
}
if (-not $workerUrl) {
  # Fallback 2: gio nguyen URL da co trong js/push-config.js (neu da deploy truoc do)
  $cfgPath = Join-Path $root 'js\push-config.js'
  if (Test-Path $cfgPath) {
    $cfgRaw = Get-Content $cfgPath -Raw -Encoding UTF8
    if ($cfgRaw -match "window\.EDUPULSE_PUSH_WORKER_URL = '([^']+)';" -and $Matches[1]) {
      $workerUrl = $Matches[1]
      Write-Host 'Worker da deploy truoc do - giu nguyen URL cu.' -ForegroundColor Yellow
    }
  }
}
if (-not $workerUrl) {
  Write-Host 'Khong doc duoc URL worker. Thu xem output deploy o tren.' -ForegroundColor Red
  exit 1
}
Write-Host "Worker URL: $workerUrl" -ForegroundColor Green

Step 'Dien URL worker vao js/push-config.js'
$cfgPath = Join-Path $root 'js\push-config.js'
$cfg = Get-Content $cfgPath -Raw -Encoding UTF8
$cfg = $cfg -replace "window\.EDUPULSE_PUSH_WORKER_URL = '[^']*';", "window.EDUPULSE_PUSH_WORKER_URL = '$workerUrl';"
[System.IO.File]::WriteAllText($cfgPath, $cfg, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Da ghi: EDUPULSE_PUSH_WORKER_URL = $workerUrl"

Step 'Deploy hosting (dua cau hinh moi len web)'
Set-Location $root
npx firebase-tools deploy --only hosting 2>&1 | Out-Null
CheckExit 'Deploy hosting'

Write-Host "`n==============================================================" -ForegroundColor Green
Write-Host 'XONG! Tat ca da san sang.' -ForegroundColor Green
Write-Host '- Mo app (hoac tai lai neu dang mo) -> tab Tai khoan' -ForegroundColor Green
Write-Host '- Bat "Nhac on hang ngay" -> se nhan 1 thong bao thu ngay.' -ForegroundColor Green
Write-Host '- Sau do moi ngay 18:00 nhan "Con N ngay toi ky thi".' -ForegroundColor Green
Write-Host '==============================================================' -ForegroundColor Green