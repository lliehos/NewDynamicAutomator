#Requires -Version 5.1
<#
.SYNOPSIS
    End-to-end HTTPS certificate setup for an IIS site: issue, bind, verify and
    optionally push the root certificate to client machines. Runs fully offline.

.DESCRIPTION
    The script performs every step needed to make https://<HostName> trusted:

      1. Locate the IIS site that owns the HTTPS binding.
      2. Reuse an existing valid certificate, unless -Force is given.
      3. Issue a certificate:
           - Mode Auto (default): try the internal CA (AD CS) first, then fall back
             to a self-signed internal root + server certificate.
           - Mode Ca: internal CA only.
           - Mode SelfSigned: internal root + server certificate only.
      4. Trust the chain root in this server's LocalMachine\Root store.
      5. Export <host>-root.cer and <host>-server.cer for distribution.
      6. Create/enable the IIS HTTPS binding (SNI) and register the certificate
         in HTTP.sys, then recycle the application pool.
      7. Verify over LOOPBACK ONLY (127.0.0.1) so no firewall rule is involved.
      8. Optionally install the root certificate into Trusted Root on remote
         client machines (PowerShell remoting), and optionally set the Firefox
         "ImportEnterpriseRoots" policy so Firefox uses the Windows store.
      9. Optionally re-verify each client with a real TLS handshake.

    Every network step is best effort: a blocked port or an offline client
    produces a warning, never a failure.

.NOTES
    Run elevated. If the file was copied from an untrusted source, run:
        Unblock-File -Path .\Install-HttpsCertificate.ps1

    Remote distribution requires WinRM enabled on the clients and local admin
    rights there. When remoting is not available, distribute <host>-root.cer
    through Group Policy instead (see the summary printed at the end).

.PARAMETER HostName
    Certificate hostname (SAN). Default: automator.krtax.ir

.PARAMETER Mode
    Auto | Ca | SelfSigned. Default: Auto

.PARAMETER SiteName
    IIS site name. Auto-detected from the HTTPS binding when omitted.

.PARAMETER CaTemplate
    AD CS certificate template name. Default: WebServer

.PARAMETER OutDir
    Folder for the exported .cer files. Default: C:\certs\webautomator

.PARAMETER RootCertPath
    Use an already exported root .cer for client distribution instead of the
    one produced by this run.

.PARAMETER Years
    Lifetime of the self-signed certificate, in years. Default: 3

.PARAMETER Force
    Issue a new certificate even when a valid one already exists.

.PARAMETER SkipVerify
    Skip the loopback verification steps.

.PARAMETER DistributeRoot
    Install the root certificate into Trusted Root on the target clients.

.PARAMETER Computers
    Explicit list of target computer names for -DistributeRoot.

.PARAMETER ComputersFile
    Text file with one computer name per line ('#' starts a comment).

.PARAMETER Ou
    Active Directory OU to enumerate computers from (requires RSAT).

.PARAMETER Credential
    Credential used for the remote connections. Defaults to the current user.

.PARAMETER SetFirefoxEnterpriseRoots
    Also set HKLM\SOFTWARE\Policies\Mozilla\Firefox\Certificates\ImportEnterpriseRoots=1
    on the target clients so Firefox reuses the Windows certificate store.

.PARAMETER VerifyRemotes
    After distribution, open a real TLS connection from each client to the host.

.PARAMETER LogPath
    Write a transcript of the run to this file.

.EXAMPLE
    .\Install-HttpsCertificate.ps1

.EXAMPLE
    .\Install-HttpsCertificate.ps1 -Mode SelfSigned -SiteName Automator -Force

.EXAMPLE
    .\Install-HttpsCertificate.ps1 -DistributeRoot -ComputersFile .\clients.txt -SetFirefoxEnterpriseRoots -VerifyRemotes

.EXAMPLE
    .\Install-HttpsCertificate.ps1 -DistributeRoot -Ou "OU=Clients,DC=corp,DC=local" -Credential (Get-Credential)
#>
[CmdletBinding()]
param(
    [string]$HostName = "automator.krtax.ir",
    [ValidateSet("Auto", "Ca", "SelfSigned")]
    [string]$Mode = "Auto",
    [string]$SiteName,
    [string]$CaTemplate = "WebServer",
    [string]$OutDir = "C:\certs\webautomator",
    [string]$RootCertPath,
    [int]$Years = 3,
    [switch]$Force,
    [switch]$SkipVerify,
    [switch]$DistributeRoot,
    [string[]]$Computers,
    [string]$ComputersFile,
    [string]$Ou,
    [System.Management.Automation.PSCredential]$Credential,
    [switch]$SetFirefoxEnterpriseRoots,
    [switch]$VerifyRemotes,
    [string]$LogPath
)

$ErrorActionPreference = "Stop"
$Script:StepNo = 0
$Script:TranscriptStarted = $false

function Write-Step([string]$Text) {
    $Script:StepNo++
    Write-Host ""
    Write-Host ("[{0}] {1}" -f $Script:StepNo, $Text) -ForegroundColor Cyan
}
function Write-Ok([string]$Text) { Write-Host ("    OK  " + $Text) -ForegroundColor Green }
function Write-WarnLine([string]$Text) { Write-Host ("    !!  " + $Text) -ForegroundColor Yellow }
function Write-Info([string]$Text) { Write-Host ("        " + $Text) -ForegroundColor Gray }

function Assert-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "This script must run elevated (Run as administrator)."
    }
}

# --- certificate helpers -----------------------------------------------------

function Test-CertHasDns {
    param(
        [System.Security.Cryptography.X509Certificates.X509Certificate2]$Cert,
        [string]$Dns
    )
    foreach ($ext in $Cert.Extensions) {
        if ($ext.Oid.Value -ne "2.5.29.17") { continue }   # Subject Alternative Name
        if ($ext.Format($false) -match [regex]::Escape($Dns)) { return $true }
    }
    return $false
}

function Find-HostCertificate {
    param([string]$Dns, [int]$MinValidDays)
    $cutoff = (Get-Date).AddDays($MinValidDays)
    $candidates = Get-ChildItem Cert:\LocalMachine\My |
        Where-Object { $_.HasPrivateKey -and $_.NotAfter -gt $cutoff }
    $candidates = $candidates | Where-Object { Test-CertHasDns -Cert $_ -Dns $Dns }
    return ($candidates | Sort-Object NotAfter -Descending | Select-Object -First 1)
}

function New-CertificateFromCa {
    param([string]$Dns, [string]$Template)
    if (-not (Get-Command Get-Certificate -ErrorAction SilentlyContinue)) {
        throw "Cmdlet 'Get-Certificate' is not available (PKI module missing)."
    }
    $result = Get-Certificate -Template $Template -DnsName $Dns -CertStoreLocation Cert:\LocalMachine\My
    if (-not $result -or -not $result.Certificate) {
        $status = if ($result) { $result.Status } else { "unknown" }
        throw "The CA did not issue the certificate (status: $status). The template may require manager approval."
    }
    return $result.Certificate
}

function New-SelfSignedCertificatePair {
    param([string]$Dns, [int]$Years)

    # Clients only have to trust this root, not the leaf.
    $root = New-SelfSignedCertificate `
        -Subject "CN=Internal Root CA" `
        -CertStoreLocation Cert:\LocalMachine\My `
        -KeyAlgorithm RSA -KeyLength 2048 `
        -KeyUsage CertSign, CRLSign, DigitalSignature `
        -TextExtension @("2.5.29.19={text}CA=true&pathlength=1") `
        -NotAfter (Get-Date).AddYears(10) `
        -FriendlyName "Internal Root CA"

    # SAN is mandatory for Chrome; EKU serverAuth keeps other verifiers happy.
    $leaf = New-SelfSignedCertificate `
        -DnsName $Dns `
        -CertStoreLocation Cert:\LocalMachine\My `
        -KeyAlgorithm RSA -KeyLength 2048 `
        -KeyUsage DigitalSignature, KeyEncipherment `
        -Signer $root `
        -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.1") `
        -NotAfter (Get-Date).AddYears($Years) `
        -FriendlyName ("HTTPS {0}" -f $Dns)

    return @{ Leaf = $leaf; Root = $root }
}

function Add-RootToLocalTrust {
    param([System.Security.Cryptography.X509Certificates.X509Certificate2]$Root)
    if (Test-Path ("Cert:\LocalMachine\Root\{0}" -f $Root.Thumbprint)) { return $false }
    $tmp = Join-Path $env:TEMP ("{0}.cer" -f $Root.Thumbprint)
    Export-Certificate -Cert $Root -FilePath $tmp | Out-Null
    Import-Certificate -FilePath $tmp -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    return $true
}

# --- IIS helpers -------------------------------------------------------------

function Get-IisSiteByBinding {
    param([string]$Dns)
    foreach ($site in Get-Website) {
        foreach ($b in $site.Bindings.Collection) {
            if ($b.bindingInformation -like "*:443:$Dns") { return $site.Name }
        }
    }
    return $null
}

function Set-IisHttpsBinding {
    param([string]$Site, [string]$Dns, [string]$Thumbprint)

    $existing = Get-WebBinding -Name $Site -Protocol https -Port 443 -HostHeader $Dns -ErrorAction SilentlyContinue
    if (-not $existing) {
        try {
            New-WebBinding -Name $Site -Protocol https -Port 443 -HostHeader $Dns -SslFlags 1 | Out-Null
        }
        catch {
            New-WebBinding -Name $Site -Protocol https -Port 443 -HostHeader $Dns | Out-Null
        }
        Write-Ok "Created the HTTPS binding for $Dns (SNI)."
    }
    else {
        try {
            if ($existing.SslFlags -ne 1) {
                Set-WebBinding -Name $Site -Protocol https -Port 443 -HostHeader $Dns -SslFlags 1
                Write-Info "Enabled SNI on the existing binding."
            }
        }
        catch { Write-WarnLine "Could not set SslFlags; continuing." }
    }

    $nsHost = "{0}:443" -f $Dns
    $appid = "{4dc3e181-e14b-4a21-b022-59fc669b0914}"

    netsh http show sslcert hostnameport=$nsHost 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        netsh http update sslcert hostnameport=$nsHost certhash=$Thumbprint appid=$appid certstorename=MY | Out-Null
    }
    else {
        netsh http add sslcert hostnameport=$nsHost certhash=$Thumbprint appid=$appid certstorename=MY | Out-Null
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to register the certificate in HTTP.sys (netsh). Check 'netsh http show sslcert'."
    }
    Write-Ok "Certificate bound to $nsHost in HTTP.sys."

    # Local, locale-independent confirmation of the actual binding.
    $show = (netsh http show sslcert hostnameport=$nsHost 2>&1 | Out-String)
    if ($show -match [regex]::Escape($Thumbprint)) {
        Write-Ok "HTTP.sys reports the expected thumbprint."
    }
    else {
        Write-WarnLine "HTTP.sys output does not list the new thumbprint; verify manually."
    }
}

function Restart-SiteAppPool {
    param([string]$Site)
    try {
        $pool = (Get-Item ("IIS:\Sites\{0}" -f $Site)).applicationPool
        if ($pool -and (Test-Path ("IIS:\AppPools\{0}" -f $pool))) {
            Restart-WebAppPool -Name $pool
            Write-Ok "Restarted application pool '$pool'."
        }
    }
    catch { Write-WarnLine ("Could not restart the app pool: " + $_.Exception.Message) }
}

# --- loopback verification (no firewall rules involved) ----------------------

function Open-LoopbackTls {
    param([string]$Dns, [int]$TimeoutMs = 10000)
    $tcp = New-Object System.Net.Sockets.TcpClient
    $iar = $tcp.BeginConnect("127.0.0.1", 443, $null, $null)
    if (-not $iar.AsyncWaitHandle.WaitOne($TimeoutMs)) {
        $tcp.Close()
        throw "Timed out connecting to 127.0.0.1:443."
    }
    $tcp.EndConnect($iar)
    # Default callback: full chain validation against $Dns (no bypass). The socket is
    # loopback, but SNI and hostname checks still use the real DNS name.
    $ssl = New-Object System.Net.Security.SslStream($tcp.GetStream(), $false)
    $ssl.AuthenticateAsClient($Dns)
    return @{ Tcp = $tcp; Ssl = $ssl }
}

function Test-LoopbackTls {
    param([string]$Dns)
    $conn = $null
    try {
        $conn = Open-LoopbackTls -Dns $Dns
        $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($conn.Ssl.RemoteCertificate)
        return @{ Ok = $true; Error = ""; Subject = $cert.Subject; Expires = $cert.NotAfter }
    }
    catch {
        return @{ Ok = $false; Error = $_.Exception.Message; Subject = ""; Expires = $null }
    }
    finally {
        if ($conn) { if ($conn.Ssl) { $conn.Ssl.Dispose() }; if ($conn.Tcp) { $conn.Tcp.Close() } }
    }
}

function Invoke-LoopbackGet {
    param([string]$Dns, [string]$Path)
    $conn = $null
    try {
        $conn = Open-LoopbackTls -Dns $Dns
        $request = "GET $Path HTTP/1.1`r`nHost: $Dns`r`nConnection: close`r`nAccept: */*`r`n`r`n"
        $bytes = [System.Text.Encoding]::ASCII.GetBytes($request)
        $conn.Ssl.Write($bytes, 0, $bytes.Length)
        $conn.Ssl.Flush()
        $reader = New-Object System.IO.StreamReader($conn.Ssl, [System.Text.Encoding]::UTF8)
        $raw = $reader.ReadToEnd()
        $body = $raw
        $split = $raw.IndexOf("`r`n`r`n")
        if ($split -ge 0) { $body = $raw.Substring($split + 4) }
        return @{ Ok = $true; Body = $body.Trim() }
    }
    catch {
        return @{ Ok = $false; Body = $_.Exception.Message }
    }
    finally {
        if ($conn) { if ($conn.Ssl) { $conn.Ssl.Dispose() }; if ($conn.Tcp) { $conn.Tcp.Close() } }
    }
}

# --- client distribution -----------------------------------------------------

function Resolve-TargetComputers {
    param([string[]]$List, [string]$File, [string]$SearchBase)
    $targets = New-Object System.Collections.Generic.List[string]
    if ($List) {
        foreach ($item in $List) { if ($item) { $targets.Add($item.Trim()) } }
    }
    if ($File) {
        if (-not (Test-Path $File)) { throw "Computers file not found: $File" }
        foreach ($line in (Get-Content -Path $File)) {
            $name = "$line".Trim()
            if (-not $name -or $name.StartsWith("#")) { continue }
            $targets.Add($name)
        }
    }
    if ($SearchBase) {
        if (Get-Command Get-ADComputer -ErrorAction SilentlyContinue) {
            $fromAd = Get-ADComputer -SearchBase $SearchBase -Filter * | Select-Object -ExpandProperty DNSHostName
            foreach ($name in $fromAd) { if ($name) { $targets.Add($name) } }
        }
        else {
            Write-WarnLine "-Ou ignored: Get-ADComputer is not available (RSAT not installed)."
        }
    }
    return ($targets | Select-Object -Unique)
}

function Install-RootCertificateRemote {
    param(
        [string[]]$Targets,
        [byte[]]$CertificateBytes,
        [System.Management.Automation.PSCredential]$Cred,
        [bool]$FirefoxPolicy
    )
    $results = New-Object System.Collections.Generic.List[object]
    foreach ($target in $Targets) {
        Write-Info ("-> " + $target)
        try {
            $invoke = @{ ComputerName = $target; ArgumentList = @($CertificateBytes, $FirefoxPolicy); ErrorAction = "Stop" }
            if ($Cred) { $invoke.Credential = $Cred }
            $out = Invoke-Command @invoke -ScriptBlock {
                param([byte[]]$Bytes, [bool]$SetFirefox)
                $cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($Bytes)
                $store = New-Object System.Security.Cryptography.X509Certificates.X509Store("Root", "LocalMachine")
                $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
                $already = $false
                foreach ($existing in $store.Certificates) {
                    if ($existing.Thumbprint -eq $cert.Thumbprint) { $already = $true; break }
                }
                if (-not $already) { $store.Add($cert) }
                $store.Close()
                if ($SetFirefox) {
                    $key = "HKLM:\SOFTWARE\Policies\Mozilla\Firefox\Certificates"
                    New-Item -Path $key -Force | Out-Null
                    New-ItemProperty -Path $key -Name "ImportEnterpriseRoots" -Value 1 -PropertyType DWord -Force | Out-Null
                }
                return @{ Thumbprint = $cert.Thumbprint; AlreadyPresent = $already }
            }
            $result = @($out)[-1]
            $detail = if ($result.AlreadyPresent) { "already trusted" } else { "installed" }
            $results.Add([pscustomobject]@{ Computer = $target; Ok = $true; Detail = $detail })
            Write-Ok ("{0}: {1}" -f $target, $detail)
        }
        catch {
            $results.Add([pscustomobject]@{ Computer = $target; Ok = $false; Detail = $_.Exception.Message })
            Write-WarnLine ("{0}: FAILED - {1}" -f $target, $_.Exception.Message)
        }
    }
    return $results
}

function Test-RemoteTrust {
    param(
        [string[]]$Targets,
        [string]$Dns,
        [System.Management.Automation.PSCredential]$Cred
    )
    foreach ($target in $Targets) {
        try {
            $invoke = @{ ComputerName = $target; ArgumentList = @($Dns); ErrorAction = "Stop" }
            if ($Cred) { $invoke.Credential = $Cred }
            $out = Invoke-Command @invoke -ScriptBlock {
                param([string]$Host)
                $tcp = $null
                $ssl = $null
                try {
                    $tcp = New-Object System.Net.Sockets.TcpClient
                    $iar = $tcp.BeginConnect($Host, 443, $null, $null)
                    if (-not $iar.AsyncWaitHandle.WaitOne(8000)) { return @{ Ok = $false; Error = "connect timeout" } }
                    $tcp.EndConnect($iar)
                    $ssl = New-Object System.Net.Security.SslStream($tcp.GetStream(), $false)
                    $ssl.AuthenticateAsClient($Host)
                    return @{ Ok = $true; Error = "" }
                }
                catch { return @{ Ok = $false; Error = $_.Exception.Message } }
                finally { if ($ssl) { $ssl.Dispose() }; if ($tcp) { $tcp.Close() } }
            }
            $result = @($out)[-1]
            if ($result.Ok) { Write-Ok ("{0}: TLS to {1} validates" -f $target, $Dns) }
            else { Write-WarnLine ("{0}: {1}" -f $target, $result.Error) }
        }
        catch {
            Write-WarnLine ("{0}: FAILED - {1}" -f $target, $_.Exception.Message)
        }
    }
}

# --- main --------------------------------------------------------------------

try {
    if ($LogPath) {
        try {
            $logDir = Split-Path -Parent $LogPath
            if ($logDir) { New-Item -ItemType Directory -Force -Path $logDir | Out-Null }
            Start-Transcript -Path $LogPath -Append | Out-Null
            $Script:TranscriptStarted = $true
        }
        catch { Write-WarnLine ("Could not start the transcript: " + $_.Exception.Message) }
    }

    Assert-Admin

    Write-Host ""
    Write-Host "===================================================" -ForegroundColor DarkCyan
    Write-Host " HTTPS certificate setup" -ForegroundColor White
    Write-Host (" Host: {0}   |   Mode: {1}" -f $HostName, $Mode) -ForegroundColor DarkGray
    Write-Host "===================================================" -ForegroundColor DarkCyan

    Import-Module WebAdministration -ErrorAction Stop
    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

    Write-Step "Locating the IIS site"
    if (-not $SiteName) {
        $SiteName = Get-IisSiteByBinding -Dns $HostName
        if (-not $SiteName) {
            Write-Host "No site has an HTTPS binding for '$HostName'. Existing sites:" -ForegroundColor Red
            Get-Website | Select-Object Name, State, PhysicalPath | Format-Table -AutoSize | Out-String | Write-Host
            throw "Pass the site name explicitly with -SiteName."
        }
    }
    Write-Ok ("IIS site: " + $SiteName)

    Write-Step "Checking for an existing valid certificate"
    $cert = $null
    if (-not $Force) {
        $existing = Find-HostCertificate -Dns $HostName -MinValidDays 30
        if ($existing) {
            $cert = $existing
            Write-Ok ("Reusing the existing certificate (expires {0:yyyy-MM-dd})." -f $existing.NotAfter)
            Write-Info "Use -Force to issue a fresh one anyway."
        }
    }
    if (-not $cert) { Write-Info "No valid certificate found; a new one will be issued." }

    Write-Step "Issuing the certificate"
    if (-not $cert) {
        if ($Mode -eq "Ca" -or $Mode -eq "Auto") {
            try {
                Write-Info ("Requesting from the internal CA (template: {0})..." -f $CaTemplate)
                $cert = New-CertificateFromCa -Dns $HostName -Template $CaTemplate
                Write-Ok ("Issued by the internal CA (expires {0:yyyy-MM-dd})." -f $cert.NotAfter)
            }
            catch {
                $caMessage = $_.Exception.Message
                Write-WarnLine ("Internal CA unavailable: " + $caMessage)
                if ($caMessage -match "TEMPLATE_DENIED|0x80094012|enroll for this type of certificate") {
                    $machineAccount = "{0}\{1}$" -f $env:USERDOMAIN, $env:COMPUTERNAME
                    Write-Info ("The template '" + $CaTemplate + "' grants no Enroll permission to this account.")
                    Write-Info "Ask the CA administrator to grant Read + Enroll on that template to:"
                    Write-Info ("    " + $machineAccount)
                    Write-Info "Then re-run this script with: -Mode Ca -Force"
                }
                if ($Mode -eq "Ca") { throw "Cannot enroll from the internal CA (see the hint above)." }
                Write-Info "Falling back to SelfSigned."
            }
        }
        if (-not $cert) {
            $pair = New-SelfSignedCertificatePair -Dns $HostName -Years $Years
            $cert = $pair.Leaf
            Write-Ok ("Created an internal root and a server certificate (expires {0:yyyy-MM-dd})." -f $cert.NotAfter)
        }
    }
    Write-Info ("Thumbprint: " + $cert.Thumbprint)

    Write-Step "Checking the chain root in the local Trusted Root store"
    $chain = New-Object System.Security.Cryptography.X509Certificates.X509Chain
    [void]$chain.Build($cert)
    $chainRoot = $cert
    if ($chain.ChainElements.Count -gt 0) {
        $chainRoot = $chain.ChainElements[$chain.ChainElements.Count - 1].Certificate
    }
    if (Test-Path ("Cert:\LocalMachine\Root\{0}" -f $chainRoot.Thumbprint)) {
        Write-Ok ("Root already trusted: " + $chainRoot.Subject)
    }
    elseif (Add-RootToLocalTrust -Root $chainRoot) {
        Write-WarnLine ("Added the root '" + $chainRoot.Subject + "' to this server's Trusted Root store.")
    }
    Write-Info ("Root thumbprint: " + $chainRoot.Thumbprint)

    Write-Step "Exporting public files for clients"
    $rootCer = Join-Path $OutDir ("{0}-root.cer" -f $HostName)
    $serverCer = Join-Path $OutDir ("{0}-server.cer" -f $HostName)
    Export-Certificate -Cert $chainRoot -FilePath $rootCer -Force | Out-Null
    Export-Certificate -Cert $cert -FilePath $serverCer -Force | Out-Null
    Write-Ok ("Root for distribution: " + $rootCer)

    Write-Step "Binding the certificate to IIS"
    Set-IisHttpsBinding -Site $SiteName -Dns $HostName -Thumbprint $cert.Thumbprint
    Restart-SiteAppPool -Site $SiteName

    if ($SkipVerify) {
        Write-Step "Server verification skipped (-SkipVerify)"
    }
    else {
        Write-Step "Server verification (loopback only, no outbound traffic)"
        $tls = Test-LoopbackTls -Dns $HostName
        if ($tls.Ok) {
            Write-Ok ("TLS is valid on 127.0.0.1 - Subject: " + $tls.Subject)
            Write-Ok ("Expires: {0:yyyy-MM-dd}" -f $tls.Expires)
        }
        else {
            Write-WarnLine ("Loopback TLS check failed: " + $tls.Error)
            Write-Info "If the site is stopped or does not listen on 127.0.0.1, this is expected."
            Write-Info "The binding itself was already confirmed through HTTP.sys above."
        }

        $probe = Invoke-LoopbackGet -Dns $HostName -Path "/extension/fingerprint"
        if ($probe.Ok -and $probe.Body -match "fingerprint") {
            Write-Ok "Extension endpoint responded:"
            Write-Info $probe.Body
        }
        else {
            Write-WarnLine ("Extension endpoint check failed: " + $probe.Body)
        }
    }

    $distributeSource = if ($RootCertPath) { $RootCertPath } else { $rootCer }
    if ($RootCertPath -and -not (Test-Path $distributeSource)) {
        Write-WarnLine ("-RootCertPath not found: " + $distributeSource)
    }

    if ($DistributeRoot) {
        Write-Step "Distributing the root certificate to clients"
        $targets = @(Resolve-TargetComputers -List $Computers -File $ComputersFile -SearchBase $Ou)
        if ($targets.Count -eq 0) {
            Write-WarnLine "No target computers supplied; nothing to distribute."
            Write-Info "Pass -Computers srv1,srv2 or -ComputersFile .\clients.txt or -Ou 'OU=Clients,DC=corp,DC=local'."
        }
        elseif (-not (Test-Path $distributeSource)) {
            Write-WarnLine ("Root file not found: " + $distributeSource)
        }
        else {
            Write-Info ("Targets ({0}): {1}" -f $targets.Count, ($targets -join ", "))
            $rootBytes = [System.IO.File]::ReadAllBytes($distributeSource)
            $null = Install-RootCertificateRemote -Targets $targets -CertificateBytes $rootBytes -Cred $Credential -FirefoxPolicy $SetFirefoxEnterpriseRoots.IsPresent
        }
    }

    if ($VerifyRemotes) {
        Write-Step "Verifying clients"
        $targets = @(Resolve-TargetComputers -List $Computers -File $ComputersFile -SearchBase $Ou)
        if ($targets.Count -eq 0) {
            Write-WarnLine "No target computers supplied; nothing to verify."
        }
        else {
            Test-RemoteTrust -Targets $targets -Dns $HostName -Cred $Credential
        }
    }

    Write-Host ""
    Write-Host "===================================================" -ForegroundColor DarkCyan
    Write-Host " Done" -ForegroundColor Green
    Write-Host "===================================================" -ForegroundColor DarkCyan
    Write-Host ""
    Write-Host "Certificate" -ForegroundColor White
    Write-Host ("  Subject   : " + $cert.Subject)
    Write-Host ("  Expires   : {0:yyyy-MM-dd}" -f $cert.NotAfter)
    Write-Host ("  Thumbprint: " + $cert.Thumbprint)
    Write-Host ("  Root      : " + $distributeSource)
    Write-Host ""
    Write-Host "Client trust" -ForegroundColor White
    Write-Host "  If the certificate came from your domain CA, domain clients already trust the root." -ForegroundColor Gray
    Write-Host "  Otherwise install the root on every client with one of these:" -ForegroundColor Gray
    Write-Host "    A) This script:  -DistributeRoot -ComputersFile .\clients.txt -VerifyRemotes" -ForegroundColor DarkGray
    Write-Host "    B) GPO: Computer Configuration > Policies > Windows Settings > Security Settings" -ForegroundColor DarkGray
    Write-Host "       > Public Key Policies > Trusted Root Certification Authorities > Import" -ForegroundColor DarkGray
    Write-Host "    C) Per client, elevated:" -ForegroundColor DarkGray
    Write-Host ("       Import-Certificate -FilePath '{0}' -CertStoreLocation Cert:\LocalMachine\Root" -f $distributeSource) -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  Firefox reuses the Windows store when this policy is set on the client:" -ForegroundColor Gray
    Write-Host "    HKLM\SOFTWARE\Policies\Mozilla\Firefox\Certificates\ImportEnterpriseRoots = 1" -ForegroundColor DarkGray
    Write-Host "    (add -SetFirefoxEnterpriseRoots to set it during -DistributeRoot)" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  No republish and no extension reinstall is needed; just hard-refresh the panel." -ForegroundColor Gray
    Write-Host ""
    exit 0
}
catch {
    Write-Host ""
    Write-Host ("ERROR: " + $_.Exception.Message) -ForegroundColor Red
    Write-Host ""
    Write-Host "Hints:" -ForegroundColor Yellow
    Write-Host "  - Run the script elevated (Run as administrator)." -ForegroundColor Gray
    Write-Host "  - If the IIS site was not detected, pass -SiteName (the list is printed above)." -ForegroundColor Gray
    Write-Host "  - To inspect current bindings: netsh http show sslcert" -ForegroundColor Gray
    Write-Host "  - If the file was blocked after copying: Unblock-File -Path .\Install-HttpsCertificate.ps1" -ForegroundColor Gray
    exit 1
}
finally {
    if ($Script:TranscriptStarted) {
        try { Stop-Transcript | Out-Null } catch { }
    }
}
