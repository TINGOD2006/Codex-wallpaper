@echo off
setlocal
set "MIKU_ACTION=%~1"
set "MIKU_MODE=%~2"
if not defined MIKU_MODE set "MIKU_MODE=Isolated"
if /i "%MIKU_MODE%"=="Isolated" goto check_action
if /i "%MIKU_MODE%"=="Existing" if /i "%MIKU_ACTION%"=="Start" goto check_action
echo Unsupported mode.
exit /b 2
:check_action
if /i "%MIKU_ACTION%"=="Start" goto find_runtime
if /i "%MIKU_ACTION%"=="Disable" goto find_runtime
echo Unsupported action.
exit /b 2
:find_runtime
set "MIKU_PWSH="
for /f "delims=" %%P in ('where pwsh.exe 2^>nul') do if not defined MIKU_PWSH set "MIKU_PWSH=%%P"
if not defined MIKU_PWSH if exist "%ProgramFiles%\PowerShell\7\pwsh.exe" set "MIKU_PWSH=%ProgramFiles%\PowerShell\7\pwsh.exe"
if not defined MIKU_PWSH if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe" set "MIKU_PWSH=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe"
if not defined MIKU_PWSH (
  echo PowerShell 7.4 or newer is required.
  pause
  exit /b 1
)
if /i "%MIKU_ACTION%"=="Start" goto start_existing
"%MIKU_PWSH%" -NoProfile -File "%~dp0..\Theme.ps1" -Action "%MIKU_ACTION%" -Mode Existing
goto check_result
:start_existing
"%MIKU_PWSH%" -NoProfile -File "%~dp0start-independent.ps1"
:check_result
if errorlevel 1 (
  echo Theme operation failed. See the message above.
  pause
  exit /b 1
)
exit /b 0
