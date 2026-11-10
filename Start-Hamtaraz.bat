@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Hamtaraz - TypeScript Launcher

rem ============================================================
rem Hamtaraz TypeScript v1.0.1-ts.4 - Windows launcher
rem Requires Node.js 22.16.0 or newer and npm.
rem Keep this file in the project root (next to package.json).
rem ============================================================

cd /d "%~dp0"
set "HAMTARAZ_ROOT=%~dp0"
set "PORT=8080"

if not exist "package.json" (
    echo [ERROR] package.json was not found.
    echo Place this launcher in the hamtaraz-typescript project root.
    pause
    exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js was not found.
    echo Install Node.js 22.16.0 or newer, then run this launcher again.
    echo https://nodejs.org/
    pause
    exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm was not found. Reinstall Node.js with npm included.
    pause
    exit /b 1
)

node -e "const [major,minor]=process.versions.node.split('.').map(Number); process.exit(major > 22 || (major === 22 && minor >= 16) ? 0 : 1)"
if errorlevel 1 (
    for /f "delims=" %%V in ('node -p "process.versions.node"') do set "NODE_VERSION=%%V"
    echo [ERROR] Node.js 22.16.0 or newer is required. Detected: %NODE_VERSION%
    pause
    exit /b 1
)

for /f "delims=" %%V in ('node -p "process.versions.node"') do set "NODE_VERSION=%%V"
echo.
echo  ==========================================
echo       HAMTARAZ - RECONCILIATION SERVICE
echo  ==========================================
echo  Node.js: %NODE_VERSION%
echo  URL:     http://localhost:%PORT%
echo.
if not exist "public\assets\fonts\BLOTUS.TTF" echo [WARNING] B Lotus not found. Place it at public\assets\fonts\BLOTUS.TTF

if not exist "node_modules\typescript\bin\tsc" goto INSTALL_DEPENDENCIES
if not exist "node_modules\exceljs\package.json" goto INSTALL_DEPENDENCIES
if not exist "node_modules\mustache\package.json" goto INSTALL_DEPENDENCIES
goto BUILD_PROJECT

:INSTALL_DEPENDENCIES
echo [1/3] Installing project dependencies...
call npm install --no-audit --no-fund
if errorlevel 1 (
    echo.
    echo [ERROR] Dependency installation failed.
    echo Check your internet connection and npm configuration.
    pause
    exit /b 1
)

:BUILD_PROJECT
echo.
echo [2/3] Building the TypeScript application...
call npm run build
if errorlevel 1 (
    echo.
    echo [ERROR] Build failed. Review the messages above.
    pause
    exit /b 1
)

echo.
echo [3/3] Starting Hamtaraz...
start "Hamtaraz TypeScript Server" /D "%~dp0" cmd /k "set PORT=%PORT%&& npm run start:build"

echo Waiting for the server to become available...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=%PORT%; $deadline=(Get-Date).AddSeconds(25); do { $c=New-Object System.Net.Sockets.TcpClient; try { $c.Connect('127.0.0.1',$p); $c.Close(); exit 0 } catch { Start-Sleep -Milliseconds 500 } } while ((Get-Date) -lt $deadline); exit 1"
if errorlevel 1 (
    echo [WARNING] The server did not respond on port %PORT% within 25 seconds.
    echo Check the Hamtaraz Server window for startup errors.
    pause
    exit /b 1
)

start "" "http://localhost:%PORT%"
echo.
echo Hamtaraz is running. Keep the server window open.
echo Close the separate Hamtaraz Server window to stop the application.
echo.
exit /b 0
