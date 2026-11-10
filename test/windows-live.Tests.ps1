$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$entry = Join-Path $projectRoot 'Theme.ps1'
$stateRoot = Join-Path $projectRoot '.state'
function Invoke-Entry {
  param([string[]]$Values)
  $result = & pwsh -NoProfile -File $entry @Values
  if ($LASTEXITCODE -ne 0) { throw "Live entry failed: $($Values -join ' ')" }
  return ($result | Out-String | ConvertFrom-Json)
}
$identity = Get-Content -LiteralPath (Join-Path $stateRoot 'session.json') -Raw | ConvertFrom-Json
if ($identity.mode -ne 'Isolated') { throw 'This test is restricted to the isolated instance' }
$originals = @(Get-CimInstance Win32_Process -Filter "Name = 'ChatGPT.exe'" | Where-Object { $_.ProcessId -ne $identity.pid -and $_.CommandLine -notmatch '--type=' -and $_.ExecutablePath -eq $identity.appPath } | Select-Object ProcessId,CreationDate)
$repeat = Invoke-Entry @('-Action','Start','-Mode','Isolated')
if ($repeat.appPid -ne $identity.pid) { throw 'Repeated Start launched another process' }
$updated = Invoke-Entry @('-Action','Apply','-OverlayOpacity','0.71','-PositionX','95')
$saved = Get-Content -LiteralPath (Join-Path $projectRoot 'config.json') -Raw | ConvertFrom-Json
if ($saved.overlayOpacity -ne 0.71 -or $saved.positionX -ne 95) { throw 'PowerShell configuration update was not saved correctly' }
Invoke-Entry @('-Action','Apply','-OverlayOpacity','0.64','-PositionX','100') | Out-Null
$disabled = Invoke-Entry @('-Action','Disable')
if ($disabled.state -ne 'disabled') { throw 'Disable did not confirm restoration' }
$closed = Invoke-Entry @('-Action','Close')
if (-not $closed.debuggingPortClosed) { throw 'Close did not confirm debugging port cleanup' }
foreach ($original in $originals) {
  $running = Get-CimInstance Win32_Process -Filter "ProcessId = $($original.ProcessId)"
  if ($null -eq $running -or $running.CreationDate -ne $original.CreationDate) { throw 'An original desktop process was affected' }
}
$existingProtection = 'not-tested'
if ($originals.Count) {
  $blocked = & pwsh -NoProfile -File $entry -Action Start -Mode Existing 2>&1
  if ($LASTEXITCODE -eq 0) { throw 'Existing mode should refuse while the original desktop is running' }
  $existingProtection = 'passed'
}
$report = @{repeatedStartReusedProcess=$true;configurationUpdate=$true;disableConfirmed=$true;debuggingPortClosed=$true;originalProcessesUnaffected=$true;existingModeProtection=$existingProtection}
$report | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stateRoot 'windows-live-result.json') -Encoding utf8
$report | ConvertTo-Json
