@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo [VaeliGUI] Building...
call npx vite build
if errorlevel 1 ( echo Build failed! & pause & exit /b 1 )

node electron-build.mjs
if errorlevel 1 ( echo Electron build failed! & pause & exit /b 1 )

echo [VaeliGUI] Launching...
npx electron .
