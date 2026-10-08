@echo off
setlocal EnableExtensions
title Webautomator - client root certificate installer

rem One-click launcher for Install-ClientRootCA.ps1.
rem Double-click this file (it asks for admin rights, which the machine-wide store needs).
rem No admin rights on this PC?  Run this instead:  Run-InstallRootCA.cmd -Scope User

set "PS1=%~dp0Install-ClientRootCA.ps1"
if not exist "%PS1%" (
    echo.
    echo ERROR: Install-ClientRootCA.ps1 was not found next to this file.
    echo Expected: "%PS1%"
    echo.
    pause
    exit /b 1
)

set "EXTRA="

rem -Scope User writes to the current Windows profile only and needs no admin rights,
rem so in that case never ask for elevation (that user may not be able to elevate at all).
echo %* | findstr /i /c:"Scope User" >nul
if %errorlevel% equ 0 goto run

rem Machine scope: Firefox keeps its own trust store, so also point it at the Windows store.
rem It is a policy value, so an operator can still change it later.
echo %* | findstr /i /c:"SetFirefoxEnterpriseRoots" >nul
if %errorlevel% neq 0 set "EXTRA=-SetFirefoxEnterpriseRoots"

rem -DryRun changes nothing at all, so it runs unelevated too.
echo %* | findstr /i /c:"DryRun" >nul
if %errorlevel% equ 0 goto run

rem fltmc succeeds only for administrators.
fltmc >nul 2>&1
if %errorlevel% equ 0 goto run

rem ---- not elevated: relaunch this same file through UAC ----
echo.
echo Administrator rights are required to trust the certificate for every user.
echo A UAC prompt will appear now.
echo If you cannot elevate, close this window and run instead:
echo     %~nx0 -Scope User
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

:run
echo.
echo Running: "%PS1%" %* %EXTRA%
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %* %EXTRA%
set "RC=%errorlevel%"

echo.
echo ===================================================
if "%RC%"=="0" (
    echo  Finished successfully.  ^(exit code 0^)
) else if "%RC%"=="2" (
    echo  Administrator rights are required ^(exit code 2^) - see the notes above.
) else (
    echo  Finished with exit code %RC%.
)
echo ===================================================
echo.
echo Press any key to close this window.
pause >nul
exit /b %RC%
