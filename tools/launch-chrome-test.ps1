$ErrorActionPreference = 'Continue'
$chromeCandidates = @(
  'C:\Program Files\Google\Chrome\Application\chrome.exe',
  'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
  (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
)
$chrome = $chromeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $chrome) { throw 'Chrome not found' }

$root = if (Test-Path 'C:\Projects\MorobotV3\extension-recorder\manifest.json') {
  'C:\Projects\MorobotV3'
} else {
  'C:\Projects\DynamicAutomatorV3'
}

# Prefer synced install paths; fall back to repo source
$base = Join-Path $env:LOCALAPPDATA 'morobot.soras.ir'
$roles = @('extension-recorder','extension-player','extension-selector','extension-smart-recorder')
$exts = @()
foreach ($r in $roles) {
  $install = Join-Path $base $r
  $src = Join-Path $root $r
  if (Test-Path (Join-Path $install 'manifest.json')) { $exts += $install }
  elseif (Test-Path (Join-Path $src 'manifest.json')) { $exts += $src }
}
if (-not $exts.Count) { throw 'No extension folders found' }

$profile = Join-Path $env:LOCALAPPDATA 'Temp\morobot-chrome-test'
New-Item -ItemType Directory -Force -Path $profile | Out-Null
$extArg = ($exts -join ',')

Write-Host "Chrome: $chrome"
Write-Host "Extensions: $extArg"
Write-Host "Profile: $profile"

# Wake sync endpoint (ignore cert errors)
try {
  [Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
  $null = Invoke-WebRequest -Uri 'https://localhost:7201/extension/install-path' -UseBasicParsing -TimeoutSec 10
  Write-Host 'install-path OK'
} catch {
  Write-Host "install-path: $($_.Exception.Message)"
}

$args = @(
  "--user-data-dir=$profile",
  "--disable-extensions-except=$extArg",
  "--load-extension=$extArg",
  '--new-window',
  'https://localhost:7201/Panel/Account/Login'
)
Start-Process -FilePath $chrome -ArgumentList $args
Write-Host 'Chrome launched'
Get-Process chrome -ErrorAction SilentlyContinue | Select-Object -First 3 Id,ProcessName
