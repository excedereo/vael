@echo off
cd /d "%~dp0"

echo [VaeliGUI] Starting Vite dev server...
start "VaeliGUI - Vite" cmd /k "npx vite"

echo [VaeliGUI] Waiting for Vite on localhost:5173...
curl -s --retry 20 --retry-delay 1 --retry-connrefused http://localhost:5173 >nul 2>&1
echo [VaeliGUI] --- building electron ---

echo [VaeliGUI] Building Electron...
node electron-build.mjs
if errorlevel 1 (
  echo [VaeliGUI] Electron build failed!
  pause
  exit /b 1
)

echo [VaeliGUI] Launching app...
set VITE_DEV_SERVER_URL=http://localhost:5173
npx electron .

echo [VaeliGUI] Electron closed.
pause
