@echo off
setlocal EnableExtensions
title Morobot HTTPS certificate setup

set "PS1=%~dp0Install-HttpsCertificate.ps1"
if not exist "%PS1%" (
    echo.
    echo ERROR: Install-HttpsCertificate.ps1 was not found next to this file.
    echo Expected: "%PS1%"
    echo.
    pause
    exit /b 1
)

rem fltmc succeeds only for administrators.
fltmc >nul 2>&1
if %errorlevel% equ 0 goto elevated

rem ---- not elevated: relaunch this same file through UAC ----
echo.
echo Administrator rights are required. A UAC prompt will appear now...
echo.

rem Start-Process rejects a UNC working directory, so only pass it for a local path.
set "HERE=%~dp0"
set "WDARG=-WorkingDirectory '%HERE%'"
if "%HERE:~0,2%"=="\\" set "WDARG="

if "%~1"=="" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' %WDARG% -Verb RunAs"
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -ArgumentList '%*' %WDARG% -Verb RunAs"
)
exit /b

rem ---- elevated: run the certificate setup ----
:elevated
echo.
echo Running: "%PS1%" %*
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
set "RC=%errorlevel%"

echo.
echo ===================================================
if "%RC%"=="0" (
    echo  Finished successfully.  ^(exit code 0^)
) else (
    echo  Finished with exit code %RC%.
)
echo ===================================================
echo.
echo Press any key to close this window.
pause >nul
exit /b %RC%
