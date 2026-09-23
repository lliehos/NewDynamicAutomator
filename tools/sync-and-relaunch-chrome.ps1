$ErrorActionPreference = 'Continue'
$listen = netstat -ano | Select-String '7201' | Select-String 'LISTENING'
Write-Host "listen: $listen"

$src = 'C:\Projects\DynamicAutomatorV3\extension-recorder'
$dst = Join-Path $env:LOCALAPPDATA 'morobot.soras.ir\extension-recorder'
New-Item -ItemType Directory -Force -Path $dst | Out-Null
robocopy $src $dst /MIR /NFL /NDL /NJH /NJS /XD .git | Out-Null
Write-Host 'recorder manifest:'
Get-Content (Join-Path $dst 'manifest.json') -TotalCount 6

if (-not $listen) {
  Write-Host 'starting web...'
  $root = if (Test-Path 'C:\Projects\MorobotV3\src\Morobot.Web\Morobot.Web.csproj') {
    'C:\Projects\MorobotV3'
  } else {
    'C:\Projects\DynamicAutomatorV3'
  }
  Start-Process -FilePath 'dotnet' -ArgumentList 'run --project src\Morobot.Web\Morobot.Web.csproj --launch-profile https' -WorkingDirectory $root -WindowStyle Minimized
  Start-Sleep -Seconds 12
  netstat -ano | Select-String '7201' | Select-String 'LISTENING'
} else {
  Write-Host 'web already up'
}

# Re-launch chrome with updated extensions so content scripts reload
$chrome = @(
  'C:\Program Files\Google\Chrome\Application\chrome.exe',
  'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe'
) | Where-Object { Test-Path $_ } | Select-Object -First 1

$base = Join-Path $env:LOCALAPPDATA 'morobot.soras.ir'
$roles = @('extension-recorder','extension-player','extension-selector','extension-smart-recorder')
$exts = @()
foreach ($r in $roles) {
  $p = Join-Path $base $r
  if (Test-Path (Join-Path $p 'manifest.json')) { $exts += $p }
}
$profile = Join-Path $env:LOCALAPPDATA 'Temp\morobot-chrome-test'
$extArg = ($exts -join ',')
# Kill previous test profile chrome if possible - skip (user may have it)
Start-Process -FilePath $chrome -ArgumentList @(
  "--user-data-dir=$profile",
  "--disable-extensions-except=$extArg",
  "--load-extension=$extArg",
  '--new-window',
  'https://localhost:7201/Panel/Home/Processes'
)
Write-Host "Relaunched Chrome with $extArg"
