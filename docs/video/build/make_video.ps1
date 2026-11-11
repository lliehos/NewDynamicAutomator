# Compose the final MP4: per-slide Ken Burns segments -> concat -> narration -> subtitles.
param(
    [string]$Ffmpeg = "C:\Program Files\KMPlayer 64X\LAVFilters64\ffmpeg.exe",
    [string]$OutFile = (Join-Path (Split-Path $PSScriptRoot) "Webautomator-Tutorial-FA.mp4"),
    [int]$Fps = 30,
    [switch]$KeepSegments,
    [switch]$ReuseSegments
)

$ErrorActionPreference = 'Stop'
$videoDir = Split-Path $PSScriptRoot
$slideDir = Join-Path $videoDir "render\slides"
$audioDir = Join-Path $videoDir "audio"
$segDir = Join-Path $videoDir "render\segments"
New-Item -ItemType Directory -Force -Path $segDir | Out-Null

$timings = [IO.File]::ReadAllText((Join-Path $PSScriptRoot "timings.json"), [Text.Encoding]::UTF8) | ConvertFrom-Json
$beats = $timings.beats
Write-Host ("composing {0} segments, total {1:N1}s" -f $beats.Count, $timings.total)

$vlist = Join-Path $segDir "video.txt"
$alist = Join-Path $segDir "audio.txt"
if (Test-Path $vlist) { Remove-Item $vlist }
if (Test-Path $alist) { Remove-Item $alist }

function Run-Ffmpeg([string[]]$Arguments) {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $log = (& $Ffmpeg -hide_banner -y @Arguments 2>&1 | Out-String)
    }
    finally {
        $ErrorActionPreference = $prev
    }
    if ($LASTEXITCODE -ne 0) {
        Write-Host ($log | Select-Object -Last 12)
        throw "ffmpeg failed"
    }
    return $log
}

$i = 0
foreach ($b in $beats) {
    $i++
    $D = [double]$b.segment
    $frames = [math]::Max(2, [int]($D * $Fps))
    $t = "on/$frames"
    switch ($b.zoom) {
        "out" { $z = "1.06-0.06*$t"; $x = "iw/2-(iw/zoom/2)"; $y = "ih/2-(ih/zoom/2)" }
        "pan" { $z = "1.05"; $x = "(iw-iw/zoom)*(1-$t)"; $y = "ih/2-(ih/zoom/2)" }
        default { $z = "1+0.06*$t"; $x = "iw/2-(iw/zoom/2)"; $y = "ih/2-(ih/zoom/2)" }
    }
    $fadeOut = [math]::Max(0.2, $D - 0.45)
    $slide = Join-Path $slideDir ("slide-{0:D2}.png" -f $i)
    $seg = Join-Path $segDir ("seg-{0:D2}.mp4" -f $i)
    $wav = Join-Path $segDir ("seg-{0:D2}.wav" -f $i)
    if ($ReuseSegments -and (Test-Path $seg) -and (Test-Path $wav)) {
        Write-Host ("{0,2}/{1} {2,-22} {3,5:N2}s (reused)" -f $i, $beats.Count, $b.id, $D)
        Add-Content -Path $vlist -Value ("file '{0}'" -f ($seg -replace '\\', '/')) -Encoding ASCII
        Add-Content -Path $alist -Value ("file '{0}'" -f ($wav -replace '\\', '/')) -Encoding ASCII
        continue
    }
    if (-not (Test-Path $slide)) { throw "missing slide $slide" }

    $vf = "scale=2880:1620:flags=lanczos,zoompan=z='$z':x='$x':y='$y':d=1:s=1920x1080:fps=$Fps," +
          "fade=t=in:st=0:d=0.40,fade=t=out:st=$([math]::Round($fadeOut,2)):d=0.45,format=yuv420p"
    Run-Ffmpeg @("-loop", "1", "-framerate", "$Fps", "-i", $slide, "-t", "$D",
        "-vf", $vf, "-c:v", "libx264", "-preset", "medium", "-crf", "19",
        "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", "$Fps", $seg) | Out-Null

    $mp3 = Join-Path $audioDir ("{0}.mp3" -f $b.id)
    $delay = [int]([double]$b.lead * 1000)
    $af = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo," +
          "adelay=${delay}|${delay},apad,atrim=0:$D,asetpts=N/SR/TB"
    Run-Ffmpeg @("-i", $mp3, "-af", $af, "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", $wav) | Out-Null

    Add-Content -Path $vlist -Value ("file '{0}'" -f ($seg -replace '\\', '/')) -Encoding ASCII
    Add-Content -Path $alist -Value ("file '{0}'" -f ($wav -replace '\\', '/')) -Encoding ASCII
    Write-Host ("{0,2}/{1} {2,-22} {3,5:N2}s" -f $i, $beats.Count, $b.id, $D)
}

$videoOnly = Join-Path $segDir "video-only.mp4"
Run-Ffmpeg @("-f", "concat", "-safe", "0", "-i", $vlist, "-c", "copy", "-movflags", "+faststart", $videoOnly) | Out-Null

# narration: concat all padded wavs, then normalise loudness
$narr = Join-Path $segDir "narration.wav"
Run-Ffmpeg @("-f", "concat", "-safe", "0", "-i", $alist, "-c:a", "pcm_s16le",
    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11,aformat=sample_fmts=s16:sample_rates=48000:channel_layouts=stereo", $narr) | Out-Null

$srt = Join-Path $videoDir "Webautomator-Tutorial-FA.srt"
$args = @("-i", $videoOnly, "-i", $narr)
if (Test-Path $srt) { $args += @("-i", $srt, "-map", "0:v", "-map", "1:a", "-map", "2:s", "-c:s", "mov_text",
        "-metadata:s:s:0", "language=fas") }
else { $args += @("-map", "0:v", "-map", "1:a") }
$args += @("-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-movflags", "+faststart", "-shortest", $OutFile)
Run-Ffmpeg $args | Out-Null

if (-not $KeepSegments) { Remove-Item (Join-Path $segDir "seg-*.wav") -Force -ErrorAction SilentlyContinue }

$info = (& $Ffmpeg -hide_banner -i $OutFile 2>&1 | Out-String)
if ($info -match 'Duration: (\d+):(\d+):(\d+\.\d+)') {
    $secs = ([int]$Matches[1]) * 3600 + ([int]$Matches[2]) * 60 + [double]::Parse($Matches[3], [Globalization.CultureInfo]::InvariantCulture)
    Write-Host ("done: {0}  ({1:N1}s / {2:N1} min, {3:N1} MB)" -f $OutFile, $secs, ($secs / 60), ((Get-Item $OutFile).Length / 1MB))
}
