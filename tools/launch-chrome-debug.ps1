$ErrorActionPreference = 'Continue'
# Kill chrome using our test profile (best-effort)
Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'morobot-chrome-test' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1

$chrome = @(
  'C:\Program Files\Google\Chrome\Application\chrome.exe',
  'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe'
) | Where-Object { Test-Path $_ } | Select-Object -First 1

$base = Join-Path $env:LOCALAPPDATA 'morobot.soras.ir'
$roles = @('extension-recorder','extension-player','extension-selector','extension-smart-recorder')
$exts = foreach ($r in $roles) {
  $p = Join-Path $base $r
  if (Test-Path (Join-Path $p 'manifest.json')) { $p }
}
$profile = Join-Path $env:LOCALAPPDATA 'Temp\morobot-chrome-test'
$extArg = ($exts -join ',')
$port = 9222

Start-Process -FilePath $chrome -ArgumentList @(
  "--user-data-dir=$profile",
  "--remote-debugging-port=$port",
  "--disable-extensions-except=$extArg",
  "--load-extension=$extArg",
  '--new-window',
  'https://localhost:7201/Panel/Account/Login'
)
Write-Host "Chrome debug port $port"
Start-Sleep -Seconds 3
try {
  $tabs = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json" -TimeoutSec 5
  $tabs | Select-Object -First 5 title, url, id | Format-List
} catch {
  Write-Host "CDP list failed: $($_.Exception.Message)"
}
