@echo off
setlocal enabledelayedexpansion

:: Get version from package.json
for /f "tokens=*" %%i in ('node -e "process.stdout.write(require('./package.json').version)"') do set VERSION=%%i

echo [Vael] Version: %VERSION%

git add -A
git commit -m "release: v%VERSION%"
git tag v%VERSION%
git push
git push --tags

echo [Vael] Creating GitHub release...
gh release create v%VERSION% --title "Vael v%VERSION%" --notes-file CHANGELOG.md

echo [Vael] Done!
pause
