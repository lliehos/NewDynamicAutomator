#Requires -Version 5.1
<#
.SYNOPSIS
    Build the deployable MSI that trusts the Webautomator server root certificate on a client machine.

.DESCRIPTION
    Produces one file - WebautomatorRootCA-<version>.msi - that SCCM, Intune, GPO Software Installation,
    PDQ Deploy or any RMM can push to every client:

        msiexec /i WebautomatorRootCA-<version>.msi /qn /norestart /l*v C:\Windows\Temp\WebautomatorRootCA.log

    What the MSI does, in order:
      1. copies <host>-root.cer to %ProgramFiles%\Webautomator Root CA,
      2. adds that certificate to the machine Trusted Root store (certutil -addstore -f root),
      3. sets HKLM\SOFTWARE\Policies\Mozilla\Firefox\Certificates\ImportEnterpriseRoots = 1 so
         Firefox reads the Windows store too (Chrome and Edge already do),
      4. on uninstall removes the root again by thumbprint and deletes the policy value,
      5. rolls the root back if the install fails after step 2.

    The certificate file is validated before build time: it must be self-signed and carry
    CA=True, so a server certificate can never be packaged here by mistake.

.PARAMETER CerPath
    The exported root certificate, e.g. C:\certs\webautomator\automator.krtax.ir-root.cer

.PARAMETER OutDir
    Where the MSI (and its .sha256) are written. Default: dist\installer

.PARAMETER Version
    MSI version, a.b.c. Default: 1.0.0

.PARAMETER Manufacturer
    Vendor shown in Add/Remove Programs. Default: Webautomator

.PARAMETER WixPath
    wix.exe to use. Default: PATH, then %USERPROFILE%\.dotnet\tools\wix.exe

.PARAMETER SkipVerify
    Skip the post-build checks (MSI table inspection and payload extraction).

.EXAMPLE
    .\Build-RootCaMsi.ps1 -CerPath C:\certs\webautomator\automator.krtax.ir-root.cer

.EXAMPLE
    .\Build-RootCaMsi.ps1 -CerPath .\automator.krtax.ir-root.cer -OutDir C:\Deploy -Version 1.0.1

.NOTES
    Building needs the free WiX v5 toolset, once per machine:

        dotnet tool install --global wix --version 5.0.2

    (v6 and v7 ask for the Open Source Maintenance Fee EULA; v5 does not.)
    The build is x64 because a 32-bit package would redirect the Firefox policy write into
    WOW6432Node, where 64-bit Firefox would never see it.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$CerPath,
    [string]$OutDir = "dist\installer",
    [string]$Version = "1.0.0",
    [string]$Manufacturer = "Webautomator",
    [string]$WixPath,
    [switch]$SkipVerify
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$Text) { Write-Host ""; Write-Host ("== " + $Text) -ForegroundColor Cyan }
function Write-Info([string]$Text) { Write-Host ("   " + $Text) -ForegroundColor Gray }
function Write-Ok([string]$Text) { Write-Host ("   " + $Text) -ForegroundColor Green }
function Write-WarnLine([string]$Text) { Write-Host ("   " + $Text) -ForegroundColor Yellow }

function Get-MsiRows {
    param([string]$MsiPath, [string]$Query, [string[]]$Columns)
    $installer = New-Object -ComObject WindowsInstaller.Installer
    $db = $installer.GetType().InvokeMember("OpenDatabase", "InvokeMethod", $null, $installer, @($MsiPath, 0))
    $view = $db.GetType().InvokeMember("OpenView", "InvokeMethod", $null, $db, @($Query))
    $view.GetType().InvokeMember("Execute", "InvokeMethod", $null, $view, $null)
    $rows = @()
    while ($true) {
        $rec = $view.GetType().InvokeMember("Fetch", "InvokeMethod", $null, $view, $null)
        if ($null -eq $rec) { break }
        $row = [ordered]@{}
        for ($i = 1; $i -le $Columns.Count; $i++) {
            $row[$Columns[$i - 1]] = [string]$rec.GetType().InvokeMember("StringData", "GetProperty", $null, $rec, @($i))
        }
        $rows += [pscustomobject]$row
    }
    return $rows
}

function Get-MsiTableRows {
    param([string]$MsiPath, [string]$Table, [string[]]$Columns, [string]$WorkDir)
    # CustomAction is a reserved word in MSI SQL, so the table cannot be read with a SELECT at all
    # (OpenView fails on every quoting variant). Exporting it to an .idt file is the documented way.
    $installer = New-Object -ComObject WindowsInstaller.Installer
    $db = $installer.GetType().InvokeMember("OpenDatabase", "InvokeMethod", $null, $installer, @($MsiPath, 0))
    $db.GetType().InvokeMember("Export", "InvokeMethod", $null, $db, @($Table, $WorkDir, ($Table + ".idt")))
    $idt = Join-Path $WorkDir ($Table + ".idt")
    if (-not (Test-Path -LiteralPath $idt)) { throw ("Could not export the " + $Table + " table.") }
    $rows = @()
    $lines = @(Get-Content -LiteralPath $idt)
    if ($lines.Count -lt 3) { return $rows }
    # Columns can be in any order, so map them by name from the .idt header instead of by position.
    $header = @($lines[0] -split "`t")
    $index = @{}
    for ($c = 0; $c -lt $header.Count; $c++) { $index[$header[$c]] = $c }
    # Line 2 is the export marker (it starts with the table name), line 3 the column types; rows follow.
    $first = 2
    for ($i = 1; $i -lt [Math]::Min(4, $lines.Count); $i++) {
        $probe = @($lines[$i] -split "`t")
        if ($probe[0] -eq $Table) { $first = $i + 1; break }
    }
    for ($i = $first; $i -lt $lines.Count; $i++) {
        $line = $lines[$i]
        if ([string]::IsNullOrWhiteSpace($line) -or $line -eq $Table) { continue }
        $cells = $line -split "`t"
        $row = [ordered]@{}
        foreach ($col in $Columns) {
            if (-not $index.ContainsKey($col)) { throw ("The " + $Table + " table has no " + $col + " column.") }
            $c = $index[$col]
            $row[$col] = $(if ($c -lt $cells.Count) { $cells[$c] } else { "" })
        }
        $rows += [pscustomobject]$row
    }
    return $rows
}

# ---------------------------------------------------------------------------------------------

Write-Host ""
Write-Host "===================================================" -ForegroundColor DarkCyan
Write-Host " Webautomator root CA - MSI builder" -ForegroundColor White
Write-Host "===================================================" -ForegroundColor DarkCyan

Write-Step "Validating the certificate"
if (-not (Test-Path -LiteralPath $CerPath)) { throw ("Certificate not found: " + $CerPath) }
$cerFile = (Resolve-Path -LiteralPath $CerPath).Path
$cer = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($cerFile)

$isCa = $false
$bc = $cer.Extensions | Where-Object { $_.Oid.Value -eq "2.5.29.19" }
if ($bc) {
    try { $isCa = ([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]$bc).CertificateAuthority } catch { $isCa = $false }
}
Write-Info ("Subject    : " + $cer.Subject)
Write-Info ("Issuer     : " + $cer.Issuer)
Write-Info ("Thumbprint : " + $cer.Thumbprint)
Write-Info ("Valid to   : " + ("{0:yyyy-MM-dd}" -f $cer.NotAfter))

if ($cer.Subject -ne $cer.Issuer) { throw "This certificate is not self-signed, so it is not a root CA. Point -CerPath at the exported <host>-root.cer." }
if (-not $isCa) { throw "This certificate has no CA=True basic constraint, so it cannot be a root CA." }
if ($cer.NotAfter -lt (Get-Date).AddDays(30)) { Write-WarnLine ("This root expires on " + ("{0:yyyy-MM-dd}" -f $cer.NotAfter) + " - build again after it is renewed.") }
Write-Ok "Self-signed root CA - good to package."

Write-Step "Locating the WiX toolset"
$wix = $null
if ($WixPath) {
    if (-not (Test-Path -LiteralPath $WixPath)) { throw ("wix.exe not found at " + $WixPath) }
    $wix = $WixPath
} else {
    $cmd = Get-Command wix -ErrorAction SilentlyContinue
    if ($cmd) { $wix = $cmd.Source }
    elseif (Test-Path "$env:USERPROFILE\.dotnet\tools\wix.exe") { $wix = "$env:USERPROFILE\.dotnet\tools\wix.exe" }
}
if (-not $wix) {
    Write-WarnLine "wix.exe was not found."
    Write-Info "Install the free v5 toolset once, then re-run this script:"
    Write-Info "    dotnet tool install --global wix --version 5.0.2"
    exit 2
}
$wixVersion = (& $wix --version 2>&1 | Select-Object -First 1)
Write-Ok ("Using " + $wix + "  (" + $wixVersion + ")")

$wxs = Join-Path $PSScriptRoot "WebautomatorRootCA.wxs"
if (-not (Test-Path -LiteralPath $wxs)) { throw ("Source not found: " + $wxs) }

$staging = Join-Path $env:TEMP ("webautomator-msi-" + [Guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Force -Path $staging | Out-Null
try {
    # The certificate is referenced where it lives: a copy inside %TEMP% was rejected by the WiX
    # binder ("not a valid source file"), and the payload stays out of the staging area anyway.
    Copy-Item -LiteralPath $wxs -Destination $staging -Force

    if (-not [System.IO.Path]::IsPathRooted($OutDir)) { $OutDir = Join-Path (Get-Location).Path $OutDir }
    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
    $msiName = "WebautomatorRootCA-" + $Version + ".msi"
    $msiPath = Join-Path (Resolve-Path -LiteralPath $OutDir).Path $msiName

    Write-Step "Building the MSI"
    Write-Info ("Output: " + $msiPath)
    # Leftovers from earlier builds in the same folder would otherwise be mistaken for part of the package.
    Get-ChildItem -Path (Resolve-Path -LiteralPath $OutDir).Path -Filter ("WebautomatorRootCA-" + $Version + ".wixpdb") -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
    $buildArgs = @(
        "build",
        "-arch", "x64",
        "-d", ("CerFullPath=" + $cerFile),
        "-d", ("CerFileName=" + (Split-Path -Leaf $cerFile)),
        "-d", ("RootThumbprint=" + $cer.Thumbprint),
        "-d", ("ProductVersion=" + $Version),
        "-d", ("Manufacturer=" + $Manufacturer),
        (Join-Path $staging "WebautomatorRootCA.wxs"),
        "-o", $msiPath,
        # The .wixpdb is only useful for debugging, so it stays in the staging folder and is cleaned up.
        "-pdb", (Join-Path $staging ($msiName + ".wixpdb"))
    )
    $buildOutput = & $wix @buildArgs 2>&1
    $buildCode = $LASTEXITCODE
    $buildOutput | ForEach-Object { Write-Info $_ }
    if ($buildCode -ne 0 -or -not (Test-Path -LiteralPath $msiPath)) {
        throw ("wix build failed (exit " + $buildCode + ").")
    }
    $msi = Get-Item -LiteralPath $msiPath
    Write-Ok ("Built " + $msi.Name + "  (" + [Math]::Round($msi.Length / 1KB, 1) + " KB)")

    if (-not $SkipVerify) {
        Write-Step "Verifying the package"

        $actions = @(Get-MsiTableRows -MsiPath $msiPath -Table "CustomAction" -Columns @("Action", "Type", "Source", "Target") -WorkDir $staging | Where-Object { $_.Action -like "*RootCert*" })
        $sequence = @(Get-MsiRows -MsiPath $msiPath -Query "SELECT Action, Sequence FROM InstallExecuteSequence" -Columns @("Action", "Sequence") | Where-Object { $_.Action -like "*RootCert*" })
        $registry = @(Get-MsiRows -MsiPath $msiPath -Query 'SELECT Root, `Key`, Name, Value FROM Registry' -Columns @("Root", "Key", "Name", "Value") | Where-Object { $_.Name -eq "ImportEnterpriseRoots" })
        $files = @(Get-MsiTableRows -MsiPath $msiPath -Table "File" -Columns @("File", "FileName", "FileSize") -WorkDir $staging)
        $props = @(Get-MsiRows -MsiPath $msiPath -Query "SELECT Property, Value FROM Property" -Columns @("Property", "Value"))

        foreach ($a in $actions) { Write-Ok ("custom action : " + $a.Action + " (type " + $a.Type + ")") }
        foreach ($s in $sequence) { Write-Ok ("scheduled     : " + $s.Action + " (seq " + $s.Sequence + ")") }
        foreach ($r in $registry) { Write-Ok ("registry      : HKLM\" + $r.Key + "!" + $r.Name + " = " + $r.Value) }
        foreach ($f in @($files | Where-Object { $_.FileSize -match "^\d+$" })) { Write-Ok ("payload file  : " + $f.FileName + "  (" + $f.FileSize + " bytes)") }
        $nameProp = $props | Where-Object { $_.Property -eq "ProductName" }
        $verProp = $props | Where-Object { $_.Property -eq "ProductVersion" }
        if ($nameProp) { Write-Ok ("product       : " + $nameProp.Value + " " + $(if ($verProp) { $verProp.Value } else { "" })) }

        if ($actions.Count -lt 3) { throw ("Expected 3 root-certificate custom actions, found " + $actions.Count + ".") }
        if ($sequence.Count -lt 3) { throw ("Expected 3 scheduled actions, found " + $sequence.Count + ".") }
        if ($files.Count -lt 1) { throw "The certificate payload is missing from the package." }
        $cerRow = @($files | Where-Object { $_.FileName -like ("*" + (Split-Path -Leaf $cerFile)) -and $_.FileSize -match "^\d+$" })
        if ($cerRow.Count -eq 0) { throw ("The package contains no " + (Split-Path -Leaf $cerFile) + ".") }
        if ([int]$cerRow[0].FileSize -ne (Get-Item -LiteralPath $cerFile).Length) { throw "The packaged certificate does not match the file on disk." }

        $addAction = $actions | Where-Object { $_.Action -eq "AddRootCert" }
        if (-not $addAction) { throw "The install action AddRootCert is missing." }
        if ($addAction.Target -notlike "*certutil*" -or $addAction.Target -notlike "*-addstore*f root*") { throw ("AddRootCert does not run certutil -addstore root: " + $addAction.Target) }
        Write-Ok ("install runs  : " + $addAction.Target)

        # Administrative extraction (no admin rights needed) proves the payload really lands in the MSI.
        $extract = Join-Path $staging "extract"
        New-Item -ItemType Directory -Force -Path $extract | Out-Null
        $p = Start-Process -FilePath "msiexec.exe" -ArgumentList @("/a", ('"' + $msiPath + '"'), "/qn", ('TARGETDIR="' + $extract + '"')) -Wait -PassThru
        if ($p.ExitCode -ne 0) { throw ("msiexec /a returned " + $p.ExitCode + " - the package did not open cleanly.") }
        $found = @(Get-ChildItem -Path $extract -Recurse -Filter (Split-Path -Leaf $cerFile) -File -ErrorAction SilentlyContinue)
        if ($found.Count -eq 0) { throw "Administrative install extracted no certificate." }
        Write-Ok ("administration install extracts: " + $found[0].FullName)
    }

    $hash = (Get-FileHash -LiteralPath $msiPath -Algorithm SHA256).Hash
    [System.IO.File]::WriteAllText($msiPath + ".sha256", ($hash + "  " + $msiName + "`r`n"), [System.Text.UTF8Encoding]::new($false))
    Write-Ok ("SHA256        : " + $hash)

    Write-Host ""
    Write-Host "---------------------------------------------------" -ForegroundColor DarkCyan
    Write-Host " Deploy it with:" -ForegroundColor White
    Write-Host ""
    Write-Host "   SCCM / Intune / PDQ / any RMM (as SYSTEM or admin):" -ForegroundColor Gray
    Write-Host ("     msiexec /i `"" + $msiPath + "`" /qn /norestart /l*v %TEMP%\WebautomatorRootCA.log") -ForegroundColor White
    Write-Host ""
    Write-Host "   GPO (Computer Configuration > Policies > Windows Settings > Scripts > Startup):" -ForegroundColor Gray
    Write-Host "     msiexec /i \\fileserver\share\WebautomatorRootCA.msi /qn /norestart /l*v C:\Windows\Temp\WebautomatorRootCA.log" -ForegroundColor White
    Write-Host "     (or deploy it as a GPO Software Installation package - no script needed)" -ForegroundColor Gray
    Write-Host ""
    Write-Host "   Uninstall:" -ForegroundColor Gray
    Write-Host "     msiexec /x WebautomatorRootCA.msi /qn /norestart" -ForegroundColor White
    Write-Host ""
    Write-Host " Test on one client first (elevated prompt), then read the log for exit code 0:" -ForegroundColor Gray
    Write-Host "     msiexec /i WebautomatorRootCA.msi /l*v WebautomatorRootCA.log" -ForegroundColor White
    Write-Host "---------------------------------------------------" -ForegroundColor DarkCyan
    Write-Host ""
    exit 0
} finally {
    Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
}
