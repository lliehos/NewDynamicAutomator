# Export build/slides.pptx to 1920x1080 PNGs (one per slide) using PowerPoint.
# Persian typography needs Vazirmatn in the session font table; it is added here
# per session (no admin install, no writes outside the repo).
param(
    [string]$Pptx = "$PSScriptRoot\slides.pptx",
    [string]$OutDir = (Join-Path (Split-Path $PSScriptRoot) "render\slides")
)

$ErrorActionPreference = 'Stop'

Add-Type -Namespace Win32 -Name Gdi -MemberDefinition @'
[DllImport("gdi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
public static extern int AddFontResourceW(string lpFileName);
'@

$fontDir = Join-Path (Split-Path $PSScriptRoot) "assets\fonts"
Get-ChildItem $fontDir -Filter *.ttf | ForEach-Object {
    $n = [Win32.Gdi]::AddFontResourceW($_.FullName)
    Write-Host ("font {0} -> {1}" -f $_.Name, $n)
}
Start-Sleep -Milliseconds 300

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Get-ChildItem $OutDir -Filter *.png -ErrorAction SilentlyContinue | Remove-Item -Force

$ppt = New-Object -ComObject PowerPoint.Application
try {
    $pres = $ppt.Presentations.Open($Pptx, $true, $false, $true)   # ReadOnly, Untitled=false, WithWindow=true
    $count = $pres.Slides.Count
    for ($i = 1; $i -le $count; $i++) {
        $path = Join-Path $OutDir ("slide-{0:D2}.png" -f $i)
        $pres.Slides.Item($i).Export($path, "PNG", 1920, 1080)
        Write-Host ("exported {0}" -f (Split-Path $path -Leaf))
    }
    $pres.Close()
}
finally {
    $ppt.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($ppt) | Out-Null
}

$files = Get-ChildItem $OutDir -Filter *.png
Write-Host ("done: {0} slides" -f $files.Count)
