@echo off
setlocal enabledelayedexpansion
title Guess5.io Dashboard
color 0A

REM Change to the dashboard directory (where this batch file is located)
cd /d "%~dp0"

echo.
echo ========================================
echo   Guess5.io Operations Dashboard
echo ========================================
echo.

echo [INFO] Checking for Node.js...
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found. Install from https://nodejs.org/
    pause
    exit /b 1
)
for /f "delims=" %%v in ('node --version') do echo [INFO] Node.js version: %%v
for /f "delims=" %%v in ('npm --version') do echo [INFO] npm version: %%v

echo.
where pnpm >nul 2>nul
if errorlevel 1 (
    echo [INFO] Installing pnpm (first run only)...
    npm install -g pnpm
    set "PATH=%PATH%;%APPDATA%\npm"
    where pnpm >nul 2>nul
    if errorlevel 1 (
        echo [ERROR] pnpm still not available. Run "npm install -g pnpm" manually.
        pause
        exit /b 1
    )
)
for /f "delims=" %%v in ('pnpm --version') do echo [INFO] pnpm version: %%v

echo.
if not exist ".env.local" (
    echo [ERROR] .env.local missing. Copy env.example.txt and fill it out.
    pause
    exit /b 1
)
if not exist "start-dashboard.js" (
    echo [ERROR] start-dashboard.js missing.
    pause
    exit /b 1
)

echo [INFO] Launching local dashboard...
echo.
echo ========================================
echo   Dashboard will open automatically
echo   URL: http://localhost:5173
echo ========================================
echo.
echo Tip: Bookmark http://localhost:5173 in your browser
echo      for quick access in the future!
echo.
echo (Browser will open automatically in 5 seconds)
echo (Press Ctrl+C to stop the dashboard)
echo.

node start-dashboard.js
set "EXIT_CODE=!ERRORLEVEL!"

echo.
if "!EXIT_CODE!"=="0" (
    echo [SUCCESS] Dashboard exited normally.
) else (
    echo [ERROR] Dashboard exited with code !EXIT_CODE!. Review messages above.
)

echo.
echo Dashboard stopped. Press any key to close this window...
pause >nul

endlocal
exit /b !EXIT_CODE!

