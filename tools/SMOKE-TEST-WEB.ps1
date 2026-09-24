# Morobot web smoke test (HTTPS dev cert). Run while Morobot.Web is up.
param(
  [string]$BaseUrl = "https://localhost:7201",
  [string]$AdminUser = "admin",
  [string]$AdminPassword = "Admin123!"
)

$ErrorActionPreference = "Stop"
$runDir = Join-Path $PSScriptRoot ".." "_run" | Resolve-Path -ErrorAction SilentlyContinue
if (-not $runDir) {
  $runDir = New-Item -ItemType Directory -Force -Path (Join-Path $PSScriptRoot ".." "_run") | Select-Object -ExpandProperty FullName
}
$cookie = Join-Path $runDir "smoke-cookies.txt"
$loginHtml = Join-Path $runDir "login.html"

function Get-Status($path, [switch]$UseCookie) {
  $args = @("-sk", "-o", "NUL", "-w", "%{http_code}")
  if ($UseCookie) { $args += @("-b", $cookie) }
  $code = & curl.exe @args "$BaseUrl$path"
  [pscustomobject]@{ Path = $path; Status = $code }
}

Write-Host "Public routes..."
@("/", "/Home/SetupGuide") | ForEach-Object { Get-Status $_ } | Format-Table -AutoSize

& curl.exe -sk -c $cookie -b $cookie "$BaseUrl/Panel/Account/Login" -o $loginHtml | Out-Null
$raw = Get-Content $loginHtml -Raw
$m = [regex]::Match($raw, 'name="__RequestVerificationToken" type="hidden" value="([^"]+)"')
if (-not $m.Success) { throw "Antiforgery token not found on login page." }
$token = $m.Groups[1].Value

Write-Host "Logging in as $AdminUser..."
& curl.exe -sk -c $cookie -b $cookie -X POST "$BaseUrl/Panel/Account/Login" `
  --data-urlencode "userName=$AdminUser" `
  --data-urlencode "password=$AdminPassword" `
  --data-urlencode "returnUrl=/Admin/Home" `
  --data-urlencode "__RequestVerificationToken=$token" -o NUL -w "Login HTTP: %{http_code}`n"

Write-Host "Admin routes (expect 200)..."
@(
  "/Admin/Home", "/Admin/License", "/Admin/Users", "/Admin/Plans",
  "/Admin/Processes", "/Admin/Settings", "/Admin/Branding"
) | ForEach-Object { Get-Status $_ -UseCookie } | Format-Table -AutoSize

Write-Host "Done."
