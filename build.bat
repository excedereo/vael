@echo off
cd /d "%~dp0"

:: Load .env
for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
    if "%%a"=="GH_TOKEN" set GH_TOKEN=%%b
)

if "%GH_TOKEN%"=="" (
    echo [Vael] ERROR: GH_TOKEN not found in .env
    pause
    exit /b 1
)

echo [Vael] Building and publishing...
npm run dist && npx electron-builder --publish always

if %errorlevel% neq 0 (
    echo [Vael] Build failed!
    pause
    exit /b %errorlevel%
)

echo [Vael] Done!
pause
