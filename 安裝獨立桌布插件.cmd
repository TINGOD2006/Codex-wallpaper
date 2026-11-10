@echo off
setlocal
where pwsh.exe >nul 2>nul
if errorlevel 1 (echo PowerShell 7.4 or newer is required. & pause & exit /b 1)
node "%~dp0scripts\build-companion.cjs"
if errorlevel 1 (echo Use the installer ZIP, or run npm ci before building this source package. & pause & exit /b 1)
pwsh.exe -NoProfile -File "%~dp0scripts\start-install.ps1" -SourceRoot "%~dp0dist\companion\app" -LegacyRoot "%~dp0.state\wallpaper" -StartManager
if errorlevel 1 pause
