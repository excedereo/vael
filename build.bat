@echo off
echo [Vael] Building...
npm run dist
if %errorlevel% neq 0 (
    echo [Vael] Build failed!
    pause
    exit /b %errorlevel%
)
echo [Vael] Build complete! Installer in release\
pause
