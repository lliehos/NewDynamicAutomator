@echo off
rem Simple launcher: NO self-elevation, so antivirus heuristics stay quiet.
rem Right-click this file and choose "Run as administrator".
cd /d "%~dp0"

if not exist "%~dp0Install-HttpsCertificate.ps1" (
    echo ERROR: Install-HttpsCertificate.ps1 was not found next to this file.
    pause
    exit /b 1
)

echo Running the certificate setup...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-HttpsCertificate.ps1" %*
set "RC=%errorlevel%"

echo.
echo Exit code: %RC%
echo.
echo Press any key to close this window.
pause >nul
exit /b %RC%
