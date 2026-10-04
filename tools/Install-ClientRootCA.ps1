#Requires -Version 5.1
<#
.SYNOPSIS
    Trust the Morobot server's internal root CA on THIS client machine.

.DESCRIPTION
    Why this file exists.

    A server certificate is only "valid" on a machine whose Trusted Root store contains the CA that
    issued it. Chrome/Edge read the Windows store. The Morobot extension's handshake is a background
    fetch of GET /extension/fingerprint, and a background fetch is NOT covered by the browser's
    "Proceed" interstitial - so on a client without the root the page loads with a warning, the probe
    fails silently, and the panel reports "the extension is not installed". Reinstalling the
    extension can never help: the extension was never the problem.

    This script installs the root once and then proves the result end to end (TLS handshake + chain
    build + a real request to /extension/fingerprint that does not bypass certificate validation).

    How to use (the intended, double-click path):
      1. Put this file, Run-InstallRootCA.cmd and the exported <host>-root.cer in one folder
         (copy them from the server's C:\certs\morobot, or from a share).
      2. Double-click Run-InstallRootCA.cmd and accept the UAC prompt.
      3. Fully close and reopen the browser.

    No admin rights?  Run:  Run-InstallRootCA.cmd -Scope User
    The root then lands in the current Windows profile only, which Chrome/Edge still honour.
    Firefox keeps its own store, so for Firefox the machine scope (and -SetFirefoxEnterpriseRoots)
    is what makes it work.

.PARAMETER CerPath
    The exported root certificate (.cer). Default: the single *.cer that sits next to this script.

.PARAMETER Url
    Download the root from this URL instead of reading a local file. Requires -Thumbprint, which
    pins the download: the file is accepted only when its thumbprint matches, so a wrong or swapped
    file on the way cannot be trusted by accident.

.PARAMETER Thumbprint
    Expected SHA-1 thumbprint of the root. Required with -Url; optional with -CerPath (a mismatch
    aborts either way).

.PARAMETER Scope
    Machine (default; needs admin, trusted for every user) or User (no admin; current profile only).
    Windows shows its own "Security Warning" prompt when a root is added to the user's store, so
    -Scope User needs one click from the person running it. The machine scope runs already elevated
    and shows no extra prompt, which is what unattended deployment (SCCM/Intune/RMM) needs.

.PARAMETER Server
    Hostname to verify after installing. Default: automator.krtax.ir

.PARAMETER Port
    TLS port used for the verification handshake. Default: 443

.PARAMETER ServerBase
    Base URL used for the verification request. Default: https://<Server>

.PARAMETER SubjectMatch
    The root must match this wildcard subject. Default: CN=Internal Root CA

.PARAMETER SetFirefoxEnterpriseRoots
    Machine scope only: also set
    HKLM\SOFTWARE\Policies\Mozilla\Firefox\Certificates\ImportEnterpriseRoots = 1
    so Firefox reads the Windows store instead of only its own.

.PARAMETER Uninstall
    Remove the root from the chosen scope instead of installing it.

.PARAMETER DryRun
    Validate and report everything, but change nothing.

.PARAMETER Force
    Skip the "does this really look like a CA root" sanity checks. Use with care.

.PARAMETER LogPath
    Also write a transcript here. Handy when a management agent (SCCM/Intune/RMM) runs this
    unattended and the console output would otherwise disappear.

.EXAMPLE
    .\Install-ClientRootCA.ps1
    .\Install-ClientRootCA.ps1 -Scope User
    .\Install-ClientRootCA.ps1 -CerPath \\fs01\share\automator.krtax.ir-root.cer
    .\Install-ClientRootCA.ps1 -Url https://automator.krtax.ir/certs/root.cer -Thumbprint 1F2E3D...
    .\Install-ClientRootCA.ps1 -Uninstall
    .\Install-ClientRootCA.ps1 -DryRun -LogPath C:\Windows\Temp\morobot-rootca.log

.OUTPUTS
    Exit codes: 0 = trusted and verified; 2 = admin rights missing; 1 = anything else.

.NOTES
    Run: the launcher Run-InstallRootCA.cmd handles execution policy and elevation. If endpoint
    protection flags the launcher, right-click Install-ClientRootCA.ps1 and use "Run with
    PowerShell" from an elevated window instead - the script itself is what matters.
#>
[CmdletBinding()]
param(
    [string]$CerPath,
    [string]$Url,
    [string]$Thumbprint,
    [ValidateSet("Machine", "User")]
    [string]$Scope = "Machine",
    [string]$Server = "automator.krtax.ir",
    [int]$Port = 443,
    [string]$ServerBase,
    [string]$SubjectMatch = "CN=Internal Root CA",
    [switch]$SetFirefoxEnterpriseRoots,
    [switch]$Uninstall,
    [switch]$DryRun,
    [switch]$Force,
    [string]$LogPath
)

$ErrorActionPreference = "Stop"
$script:DownloadedTemp = $null

$transcriptStarted = $false
if ($LogPath) {
    try {
        $logDir = Split-Path -Parent $LogPath
        if ($logDir -and -not (Test-Path -LiteralPath $logDir)) { New-Item -ItemType Directory -Force -Path $logDir | Out-Null }
        Start-Transcript -Path $LogPath -Force | Out-Null
        $transcriptStarted = $true
    } catch {
        Write-Host ("   Could not start the transcript at " + $LogPath + ": " + $_.Exception.Message) -ForegroundColor Yellow
    }
}

function Write-Step([string]$Text) {
    Write-Host ""
    Write-Host ("== " + $Text) -ForegroundColor Cyan
}
function Write-Info([string]$Text) { Write-Host ("   " + $Text) -ForegroundColor Gray }
function Write-Ok([string]$Text) { Write-Host ("   " + $Text) -ForegroundColor Green }
function Write-WarnLine([string]$Text) { Write-Host ("   " + $Text) -ForegroundColor Yellow }
function Write-Err([string]$Text) { Write-Host ("   " + $Text) -ForegroundColor Red }

function Test-IsAdmin {
    $id = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object System.Security.Principal.WindowsPrincipal($id)
    return $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-NormalizedThumbprint([string]$Value) {
    if (-not $Value) { return "" }
    return ($Value -replace "[^0-9A-Fa-f]", "").ToUpperInvariant()
}

function Get-Store([string]$ScopeName) {
    $location = "CurrentUser"
    if ($ScopeName -eq "Machine") { $location = "LocalMachine" }
    $store = New-Object System.Security.Cryptography.X509Certificates.X509Store("Root", $location)
    return $store
}

function Find-Root([string]$ScopeName, [string]$Thumb) {
    $store = Get-Store $ScopeName
    $found = @()
    try {
        $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)
        foreach ($c in $store.Certificates) {
            if ((Get-NormalizedThumbprint $c.Thumbprint) -eq $Thumb) { $found += $c }
        }
    } finally {
        $store.Close()
    }
    return $found
}

function Resolve-RootFile {
    param([string]$Path, [string]$Uri, [string]$ExpectedThumbprint)
    if ($Path) {
        if (-not (Test-Path -LiteralPath $Path)) { throw ("Certificate file not found: " + $Path) }
        Write-Ok ("Using the certificate file: " + $Path)
        return (Resolve-Path -LiteralPath $Path).Path
    }

    if ($Uri) {
        if (-not $ExpectedThumbprint) {
            throw "-Url requires -Thumbprint so the download is pinned. Pass the root's thumbprint (see the server's setup output)."
        }
        Write-Info ("Downloading " + $Uri)
        $previous = [System.Net.ServicePointManager]::ServerCertificateValidationCallback
        # The transport cannot be verified yet - that is the whole point of this script. The content
        # is what gets verified, by thumbprint, immediately below.
        [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
        try {
            $wc = New-Object System.Net.WebClient
            $bytes = $wc.DownloadData($Uri)
        } finally {
            [System.Net.ServicePointManager]::ServerCertificateValidationCallback = $previous
        }
        $tmp = Join-Path $env:TEMP ("morobot-root-" + [Guid]::NewGuid().ToString("N") + ".cer")
        [System.IO.File]::WriteAllBytes($tmp, $bytes)
        $script:DownloadedTemp = $tmp
        Write-Ok ("Downloaded " + $bytes.Length + " bytes (pinned by thumbprint).")
        return $tmp
    }

    if (-not $PSScriptRoot) { throw "Cannot auto-detect the certificate: pass -CerPath." }
    $candidates = @(Get-ChildItem -LiteralPath $PSScriptRoot -Filter *.cer -File -ErrorAction SilentlyContinue)
    if ($candidates.Count -eq 0) {
        throw ("No .cer file found next to this script (" + $PSScriptRoot + "). Put <host>-root.cer there, or pass -CerPath / -Url.")
    }
    if ($candidates.Count -gt 1) {
        Write-WarnLine ("Several .cer files sit next to this script; using the newest one. Pass -CerPath to be explicit.")
        $candidates = @($candidates | Sort-Object LastWriteTime -Descending)
    }
    Write-Ok ("Using the certificate file: " + $candidates[0].FullName)
    return $candidates[0].FullName
}

function Test-RootCertificate {
    param(
        [System.Security.Cryptography.X509Certificates.X509Certificate2]$Cert,
        [string]$SubjectPattern,
        [string]$ExpectedThumbprint,
        [switch]$SkipSanity
    )

    $problems = @()

    $actualThumb = Get-NormalizedThumbprint $Cert.Thumbprint
    if ($ExpectedThumbprint -and $actualThumb -ne $ExpectedThumbprint) {
        throw ("Thumbprint mismatch: the file is " + $actualThumb + " but " + $ExpectedThumbprint + " was expected. Nothing was installed.")
    }

    if (-not $SkipSanity) {
        if ($Cert.Subject -ne $Cert.Issuer) {
            $problems += "the certificate is not self-signed (subject and issuer differ), so it is not a root CA"
        }
        $bc = $Cert.Extensions | Where-Object { $_.Oid.Value -eq "2.5.29.19" }
        $isCa = $false
        if ($bc) {
            # X509BasicConstraintsExtension is the reliable way to ask; Format() returns
            # "Subject Type=CA" (not "CA=True"), so never parse that text.
            try {
                $isCa = ([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]$bc).CertificateAuthority
            } catch {
                try {
                    $text = $bc.Format($false)
                    if ($text -match "Subject Type\s*=\s*CA") { $isCa = $true }
                } catch { $isCa = $false }
            }
        }
        if (-not $isCa) {
            $problems += "basic constraints do not say CA=True, so this is not a certificate authority"
        }
        if ($SubjectPattern -and ($Cert.Subject -notlike $SubjectPattern)) {
            $problems += ("subject '" + $Cert.Subject + "' does not match the expected '" + $SubjectPattern + "'")
        }
    }

    if ($problems.Count -gt 0) {
        Write-Err "This file does not look like the expected CA root:"
        foreach ($p in $problems) { Write-Err (" - " + $p) }
        throw "Refusing to install. Pass -Force if you are certain (not recommended)."
    }
}

function Get-ServerTrust {
    param([string]$HostName, [int]$TlsPort, [string]$Base)

    $result = [ordered]@{
        Handshake = $false
        ChainOk = $false
        Issuer = ""
        Fingerprint = ""
        Problem = ""
    }

    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $tcp.Connect($HostName, $TlsPort)
        # Accept the handshake first: we want to inspect the certificate and build the chain
        # ourselves, exactly like the browser's verifier would.
        $ssl = New-Object System.Net.Security.SslStream($tcp.GetStream(), $false, ({ $true }))
        $ssl.AuthenticateAsClient($HostName)
        $result.Handshake = $true

        $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($ssl.RemoteCertificate)
        $result.Issuer = $cert.Issuer

        $chain = New-Object System.Security.Cryptography.X509Certificates.X509Chain
        $chain.ChainPolicy.RevocationMode = 'NoCheck'
        $result.ChainOk = $chain.Build($cert)

        $ssl.Dispose()
        $tcp.Close()
    } catch {
        $result.Problem = $_.Exception.Message
    }

    if ($Base) {
        try {
            # Deliberately NOT bypassing validation: this request succeeding is the proof that the
            # operating system now trusts the server - and it is the same call the extension makes.
            $resp = Invoke-WebRequest -Uri ($Base.TrimEnd("/") + "/extension/fingerprint") -UseBasicParsing -TimeoutSec 20
            $doc = $resp.Content | ConvertFrom-Json
            if ($doc -and $doc.fingerprint) { $result.Fingerprint = [string]$doc.fingerprint }
        } catch {
            if (-not $result.Problem) { $result.Problem = $_.Exception.Message }
        }
    }

    return $result
}

# ---------------------------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------------------------

$isAdmin = Test-IsAdmin

Write-Host ""
Write-Host "===================================================" -ForegroundColor DarkCyan
Write-Host " Morobot - client root certificate installer" -ForegroundColor White
Write-Host "===================================================" -ForegroundColor DarkCyan
Write-Info ("Scope      : " + $Scope)
Write-Info ("Server     : " + $Server)
Write-Info ("Elevated   : " + $isAdmin)
if ($DryRun) { Write-WarnLine "Dry run: nothing will be changed." }

if ($Scope -eq "Machine" -and -not $isAdmin -and -not $DryRun) {
    Write-Err "Administrator rights are required for -Scope Machine."
    Write-Info "Either run the launcher and accept the UAC prompt, or use: -Scope User"
    Write-Info "(the user scope still fixes Chrome and Edge for the current Windows profile)."
    exit 2
}

try {
    $rootFile = Resolve-RootFile -Path $CerPath -Uri $Url -ExpectedThumbprint (Get-NormalizedThumbprint $Thumbprint)
    $cert = $null
    try {
        $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($rootFile)
    } finally {
        # A downloaded root is read into memory above; the file has no further use, and leaving a
        # root certificate lying in %TEMP% is exactly the kind of leftover that ends up trusted by
        # someone else later.
        if ($script:DownloadedTemp) {
            Remove-Item -LiteralPath $script:DownloadedTemp -Force -ErrorAction SilentlyContinue
            $script:DownloadedTemp = $null
        }
    }
    Test-RootCertificate -Cert $cert -SubjectPattern $SubjectMatch -ExpectedThumbprint (Get-NormalizedThumbprint $Thumbprint) -SkipSanity:$Force

    Write-Step "Certificate"
    Write-Info ("Subject    : " + $cert.Subject)
    Write-Info ("Issuer     : " + $cert.Issuer)
    Write-Info ("Thumbprint : " + $cert.Thumbprint)
    Write-Info ("Valid to   : " + ("{0:yyyy-MM-dd}" -f $cert.NotAfter))
    $thumb = Get-NormalizedThumbprint $cert.Thumbprint

    $inMachine = @(Find-Root "Machine" $thumb).Count -gt 0
    $inUser = @(Find-Root "User" $thumb).Count -gt 0
    Write-Info ("Already in LocalMachine\Root : " + $inMachine)
    Write-Info ("Already in CurrentUser\Root  : " + $inUser)

    if ($Uninstall) {
        Write-Step ("Removing the root from the '" + $Scope + "' store")
        if ($DryRun) {
            Write-WarnLine "Dry run: the removal was not performed."
        } else {
            $store = Get-Store $Scope
            $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
            try {
                $removed = 0
                foreach ($c in @($store.Certificates)) {
                    if ((Get-NormalizedThumbprint $c.Thumbprint) -eq $thumb) { $store.Remove($c); $removed++ }
                }
            } finally {
                $store.Close()
            }
            Write-Ok ("Removed " + $removed + " certificate(s).")
            if ($Scope -eq "Machine" -and $inUser) { Write-WarnLine "It is still present in CurrentUser\Root; re-run with -Scope User to remove that one too." }
            if ($Scope -eq "User" -and $inMachine) { Write-WarnLine "It is still present in LocalMachine\Root; re-run elevated with -Scope Machine to remove that one too." }
        }
        exit 0
    }

    $already = $inMachine -or $inUser
    if ($already -and -not $Force) {
        Write-Step "Installation"
        Write-Ok "The root is already trusted on this computer - nothing to install."
    } elseif ($DryRun) {
        Write-Step "Installation"
        Write-WarnLine ("Dry run: it would be added to the " + $Scope + " Trusted Root store.")
    } else {
        Write-Step ("Adding the root to the " + $Scope + " Trusted Root store")
        if ($Scope -eq "User") {
            Write-WarnLine "Windows will show a 'Security Warning' prompt now - choose Yes to continue."
        }
        $store = Get-Store $Scope
        $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
        try {
            $store.Add($cert)
        } finally {
            $store.Close()
        }
        Write-Ok "Installed."
    }

    if ($SetFirefoxEnterpriseRoots) {
        Write-Step "Firefox enterprise roots policy"
        if ($Scope -ne "Machine") {
            Write-WarnLine "-SetFirefoxEnterpriseRoots needs the machine scope (it writes to HKLM); skipped."
        } elseif ($DryRun) {
            Write-WarnLine "Dry run: the policy was not written."
        } else {
            $key = "HKLM:\SOFTWARE\Policies\Mozilla\Firefox\Certificates"
            New-Item -Path $key -Force | Out-Null
            New-ItemProperty -Path $key -Name "ImportEnterpriseRoots" -Value 1 -PropertyType DWord -Force | Out-Null
            Write-Ok "Firefox will now use the Windows trust store."
        }
    }

    $base = $ServerBase
    if (-not $base) { $base = "https://" + $Server }

    Write-Step ("Verifying against " + $Server)
    if ($DryRun) { Write-WarnLine "Dry run: verification is informational only (the root is not installed yet)." }
    $trust = Get-ServerTrust -HostName $Server -TlsPort $Port -Base $base

    if (-not $trust.Handshake) {
        if ($DryRun) {
            Write-WarnLine ("Could not reach " + $Server + " for verification: " + $trust.Problem)
            Write-Info "Dry run: nothing was changed - the certificate file itself validated fine."
            exit 0
        }
        Write-Err ("Could not open a TLS connection to " + $Server + ": " + $trust.Problem)
        Write-Info "The root may still be installed correctly - check the network or the hostname and re-run."
        exit 1
    }

    Write-Info ("Server certificate issuer : " + $trust.Issuer)
    if ($trust.ChainOk) {
        Write-Ok "The server's chain now ends in a trusted root on this machine."
    } elseif ($DryRun) {
        Write-WarnLine "The chain is not trusted yet - expected, because a dry run installs nothing."
    } else {
        Write-Err "The chain still does not build to a trusted root."
        Write-Info "If this is a client that must trust a DIFFERENT root, re-run with that root's .cer."
        exit 1
    }
    if ($DryRun -and -not $trust.ChainOk) { exit 0 }

    if ($trust.Fingerprint) {
        Write-Ok ("Server fingerprint (extension binding): " + $trust.Fingerprint)
    } elseif ($trust.Problem) {
        Write-WarnLine ("TLS is trusted, but the fingerprint request failed: " + $trust.Problem)
    }

    Write-Host ""
    Write-Host "---------------------------------------------------" -ForegroundColor DarkCyan
    Write-Ok ("DONE - " + $Server + " is trusted on this computer.")
    Write-Host "   Next: close the browser COMPLETELY and open it again" -ForegroundColor White
    Write-Host "   (a tab refresh is not enough), then open the panel." -ForegroundColor White
    Write-Host "---------------------------------------------------" -ForegroundColor DarkCyan
    Write-Host ""
    exit 0
} catch {
    Write-Host ""
    Write-Err ("FAILED: " + $_.Exception.Message)
    Write-Host ""
    Write-Info "Hints:"
    Write-Info " - Run the launcher Run-InstallRootCA.cmd (it elevates for the machine scope)."
    Write-Info " - No admin rights? Use -Scope User."
    Write-Info " - Put the exported <host>-root.cer next to this script, or pass -CerPath / -Url."
    exit 1
}
