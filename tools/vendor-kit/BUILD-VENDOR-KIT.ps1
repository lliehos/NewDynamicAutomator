# Webautomator Vendor Kit — builds a zip for internal staff (tools + docs)
# Usage: .\BUILD-VENDOR-KIT.ps1 [-Version 1.0.0]
param(
  [string]$Version = "1.0.0"
)

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$out = Join-Path $repo "dist\vendor-kit-$Version"
$zip = Join-Path $repo "dist\webautomator-vendor-kit-v$Version.zip"

if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Path $out | Out-Null

Write-Host "Publishing Webautomator.LicenseTool..."
dotnet publish (Join-Path $repo "src\Webautomator.LicenseTool\Webautomator.LicenseTool.csproj") -c Release -o (Join-Path $out "LicenseTool") | Out-Null

Write-Host "Publishing Webautomator.VendorStudio..."
dotnet publish (Join-Path $repo "src\Webautomator.VendorStudio\Webautomator.VendorStudio.csproj") -c Release -o (Join-Path $out "VendorStudio") | Out-Null

$docs = Join-Path $out "docs"
New-Item -ItemType Directory -Path $docs | Out-Null
Copy-Item (Join-Path $repo "docs\vendor-ops-guide.md") $docs -Force
Copy-Item (Join-Path $repo "docs\setup-guide.md") $docs -Force
Copy-Item (Join-Path $repo "docs\doc-versions.json") $docs -Force
Copy-Item (Join-Path $repo "docs\marketing\webautomator-brochure.html") (Join-Path $docs "webautomator-brochure.html") -Force

New-Item -ItemType Directory -Path (Join-Path $out "license-keys") | Out-Null
Copy-Item (Join-Path $repo "tools\license-keys\.gitkeep") (Join-Path $out "license-keys\.gitkeep") -Force -ErrorAction SilentlyContinue
@"
کلید خصوصی را اینجا قرار دهید (webautomator-private.pem) — هرگز داخل بسته مشتری نباشد.
"@ | Set-Content (Join-Path $out "license-keys\README.txt") -Encoding UTF8

Copy-Item (Join-Path $PSScriptRoot "README.txt") (Join-Path $out "START-HERE.txt") -Force

if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $out "*") -DestinationPath $zip
Write-Host "Created: $zip"
