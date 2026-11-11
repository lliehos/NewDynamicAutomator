# Synthesize the Persian narration for every beat and record exact durations.
# Produces: audio/<beat-id>.mp3, audio/<beat-id>.json (word timings), build/timings.json
param(
    [string]$ScriptFile = (Join-Path (Split-Path $PSScriptRoot) "script.json"),
    [string]$AudioDir = (Join-Path (Split-Path $PSScriptRoot) "audio"),
    [string]$PythonExe = "C:\Python\python.exe",
    [string]$NodeExe = "C:\Program Files\nodejs\node.exe",
    [string]$Ffmpeg = "C:\Program Files\KMPlayer 64X\LAVFilters64\ffmpeg.exe"
)

$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $AudioDir | Out-Null

$json = [IO.File]::ReadAllText($ScriptFile, [Text.Encoding]::UTF8) | ConvertFrom-Json
$voice = $json.meta.voice
$rate = $json.meta.rate
$lead = [double]$json.meta.lead
$tail = [double]$json.meta.tail

$tts = Join-Path $PSScriptRoot 'tts.mjs'
$gecPy = Join-Path $PSScriptRoot 'gec.py'

# token is valid for a 5-minute window; refresh well before it expires
$tokenAt = [datetime]::MinValue
$gec = $null; $muid = $null

function Get-FreshToken {
    $parts = (& $PythonExe $gecPy).Trim() -split '\s+'
    $script:gec = $parts[0]
    $script:muid = $parts[1]
    $script:tokenAt = Get-Date
}

function Get-Mp3Duration([string]$path) {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = (& $Ffmpeg -hide_banner -i $path 2>&1 | Out-String)
    }
    finally {
        $ErrorActionPreference = $prev
    }
    if ($out -match 'Duration: (\d+):(\d+):(\d+\.\d+)') {
        return ([int]$Matches[1]) * 3600 + ([int]$Matches[2]) * 60 + [double]::Parse($Matches[3], [Globalization.CultureInfo]::InvariantCulture)
    }
    return 0.0
}

$timings = @()
$i = 0
foreach ($beat in $json.beats) {
    $i++
    if (($null -eq $gec) -or (((Get-Date) - $tokenAt).TotalMinutes -gt 3)) { Get-FreshToken }

    $txtFile = Join-Path $AudioDir ("{0}.txt" -f $beat.id)
    $mp3 = Join-Path $AudioDir ("{0}.mp3" -f $beat.id)
    $meta = Join-Path $AudioDir ("{0}.json" -f $beat.id)
    [IO.File]::WriteAllText($txtFile, $beat.narration, (New-Object Text.UTF8Encoding($false)))

    $ok = $false
    for ($attempt = 1; $attempt -le 3 -and -not $ok; $attempt++) {
        if ($attempt -gt 1) { Get-FreshToken; Start-Sleep -Seconds 2 }
        $result = & $NodeExe $tts --text-file $txtFile --out $mp3 --voice $voice --rate $rate --gec $gec --muid $muid --meta $meta 2>&1
        if ($LASTEXITCODE -eq 0 -and (Test-Path $mp3) -and ((Get-Item $mp3).Length -gt 2000)) { $ok = $true }
        else { Write-Warning ("$($beat.id) attempt $attempt failed: " + ($result | Select-Object -Last 1)) }
    }
    if (-not $ok) { throw "narration failed for $($beat.id)" }

    $dur = Get-Mp3Duration $mp3
    # Edge TTS leaves ~0.9s of silence at the end of every clip: cut it so the
    # pacing stays tight (speech end is the last word boundary).
    if (Test-Path $meta) {
        $md = [IO.File]::ReadAllText($meta, [Text.Encoding]::UTF8) | ConvertFrom-Json
        if ($md.words -and $md.words.Count -gt 0) {
            $wordsEnd = 0.0
            foreach ($w in $md.words) {
                $e = ([double]$w.Offset + [double]$w.Duration) / 10000000.0
                if ($e -gt $wordsEnd) { $wordsEnd = $e }
            }
            $trimmed = $wordsEnd + 0.15
            if ($trimmed -lt $dur) { $dur = [math]::Round($trimmed, 3) }
        }
    }
    $seg = [math]::Round($lead + $dur + $tail, 3)
    $timings += [pscustomobject]@{
        id      = $beat.id
        kind    = $beat.kind
        audio   = [math]::Round($dur, 3)
        lead    = $lead
        tail    = $tail
        segment = $seg
        zoom    = $(if ($beat.zoom) { $beat.zoom } else { "in" })
        chars   = $beat.narration.Length
    }
    Write-Host ("{0,2}. {1,-22} audio {2,6:N2}s  segment {3,6:N2}s" -f $i, $beat.id, $dur, $seg)
}

$total = ($timings | Measure-Object -Property segment -Sum).Sum
$outFile = Join-Path $PSScriptRoot 'timings.json'
$payload = [pscustomobject]@{ total = [math]::Round($total, 3); beats = $timings }
$payload | ConvertTo-Json -Depth 5 | Set-Content -Path $outFile -Encoding UTF8
Write-Host ("total video: {0:N1}s ({1:N1} min)" -f $total, ($total / 60))
