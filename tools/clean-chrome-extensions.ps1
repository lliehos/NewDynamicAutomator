# Removes the three dead Morobot extension registrations from Chrome.
#
# Why this is needed: the extension folders for recorder/player/selector were merged into
# `extension-global` and the old folders moved away, but Chrome still has the old registrations with
# paths that no longer exist. They show up as broken entries in chrome://extensions and make it hard
# to tell which Morobot card is the real one.
#
# The Smart Recorder entry is removed for the same reason: its registration points at the OLD flat
# path (`morobot.soras.ir\extension-smart-recorder`) while the real folder now lives under
# `default\`. Chrome cannot load it from a path that does not exist, which is why the extension never
# appeared at all. After running this, load it again from the correct path.
#
# IMPORTANT: Chrome must be fully closed before running. Chrome rewrites this file on exit, so edits
# made while it is running are silently discarded - or worse, the profile ends up inconsistent.

$ErrorActionPreference = "Stop"

$chrome = Get-Process -Name "chrome" -ErrorAction SilentlyContinue
if ($chrome) {
    Write-Host "ABORT: Chrome is running ($($chrome.Count) processes)." -ForegroundColor Red
    Write-Host "Close every Chrome window (check the tray too), then run this again." -ForegroundColor Yellow
    exit 1
}

$prefPath = Join-Path $env:LOCALAPPDATA "Google\Chrome\User Data\Default\Secure Preferences"
if (-not (Test-Path $prefPath)) {
    Write-Host "ABORT: not found: $prefPath" -ForegroundColor Red
    exit 1
}

# Back up before touching anything. The file holds the whole extension configuration, not just our
# entries, so a mistake here is not limited to Morobot.
$backup = "$prefPath.morobot-backup-$(Get-Date -Format yyyyMMdd-HHmmss)"
Copy-Item $prefPath $backup -Force
Write-Host "Backup: $backup" -ForegroundColor Green

# The IDs to drop. Each one is paired with the path it is registered under, so the script can prove
# it is removing the entry it thinks it is removing rather than trusting the ID alone.
$targets = @(
    @{ Id = "mandaapocccbdcjomfogllfidfghmlcm"; Path = "morobot.soras.ir\extension-recorder";          Label = "old recorder" },
    @{ Id = "mnboaegmidehphkakbeodfihkdbnihaf"; Path = "morobot.soras.ir\extension-player";            Label = "old player" },
    @{ Id = "pfokmldjndngjlendmchpembbbeoemjf"; Path = "morobot.soras.ir\extension-selector";          Label = "old selector" },
    @{ Id = "pneejnjnpoibhaiedbipkjacbhbggnkf"; Path = "morobot.soras.ir\extension-smart-recorder";    Label = "smart recorder (stale path)" }
)

$json = Get-Content $prefPath -Raw | ConvertFrom-Json
$settings = $json.extensions.settings

$removed = @()
foreach ($t in $targets) {
    $entry = $settings.PSObject.Properties | Where-Object { $_.Name -eq $t.Id }
    if (-not $entry) {
        Write-Host "skip  : $($t.Label) - already absent" -ForegroundColor DarkGray
        continue
    }
    $actual = [string]$entry.Value.path
    # Confirm the path matches before deleting. A mismatched entry means the ID is being reused for
    # something else, and removing it would delete a working extension.
    if ($actual -and $actual -notlike "*$($t.Path)") {
        Write-Host "SKIP  : $($t.Label) - id points elsewhere ($actual)" -ForegroundColor Yellow
        continue
    }
    $settings.PSObject.Properties.Remove($t.Id)
    $removed += $t.Label
    Write-Host "removed: $($t.Label)" -ForegroundColor Green
}

if (-not $removed.Count) {
    Write-Host "Nothing to remove." -ForegroundColor Yellow
    exit 0
}

# Write back as UTF-8 without a BOM. Chrome rejects the file if a BOM is present, which would reset
# the whole profile's extension configuration.
$out = $json | ConvertTo-Json -Depth 100 -Compress
[System.IO.File]::WriteAllText($prefPath, $out, (New-Object System.Text.UTF8Encoding($false)))

Write-Host ""
Write-Host "Done. Removed $($removed.Count) entry(ies)." -ForegroundColor Green
Write-Host "Now start Chrome and load Smart Recorder from:" -ForegroundColor Cyan
Write-Host "  $env:LOCALAPPDATA\morobot.soras.ir\default\extension-smart-recorder" -ForegroundColor Cyan
Write-Host "If anything looks wrong, restore the backup and report it." -ForegroundColor DarkGray
