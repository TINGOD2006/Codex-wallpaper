$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$fixture = Join-Path $projectRoot ('.state\independent-check-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $fixture -Force | Out-Null
$workerPath = Join-Path $fixture 'worker.ps1'
@'
$ErrorActionPreference = 'Stop'
$me = Get-CimInstance Win32_Process -Filter "ProcessId = $PID"
@{pid=$PID;sessionId=$me.SessionId} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'ready.json')
for($i=0;$i -lt 200;$i++) {
  if(Test-Path -LiteralPath (Join-Path $PSScriptRoot 'release')) {
    'finished after parent exit' | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'finished')
    exit 0
  }
  Start-Sleep -Milliseconds 100
}
exit 2
'@ | Set-Content -LiteralPath $workerPath -Encoding utf8
$parentScript = @'
$ErrorActionPreference = 'Stop'
. '__HELPER__'
$identity = Start-ThemeIndependentProcess -PowerShellPath (Get-Process -Id $PID).Path -ScriptPath (Join-Path $PSScriptRoot 'worker.ps1') -WorkingDirectory $PSScriptRoot
$identity.launcherParentPid=$PID
$identity | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'identity.json')
'@
$parentScript.Replace('__HELPER__',(Join-Path $projectRoot 'scripts\windows-independent.ps1').Replace("'","''")) | Set-Content -LiteralPath (Join-Path $fixture 'parent.ps1') -Encoding utf8
$pwshPath = (Get-Process -Id $PID).Path
try {
  & $pwshPath -NoProfile -File (Join-Path $fixture 'parent.ps1')
  if ($LASTEXITCODE -ne 0) {throw 'Independent spawn failed'}
  $identity = Get-Content -LiteralPath (Join-Path $fixture 'identity.json') -Raw | ConvertFrom-Json
  if (Get-CimInstance Win32_Process -Filter "ProcessId = $($identity.launcherParentPid)") {throw 'Parent process has not exited'}
  $worker = Get-CimInstance Win32_Process -Filter "ProcessId = $($identity.pid)"
  if (-not $worker -or $worker.CreationDate.ToUniversalTime().Ticks.ToString() -ne [string]$identity.startTime) {throw 'Independent worker did not survive parent exit'}
  if ($identity.parentPid -eq $identity.launcherParentPid) {throw 'Worker is still attached to launcher parent'}
  'continue' | Set-Content -LiteralPath (Join-Path $fixture 'release')
  for ($i=0;$i -lt 50;$i++) {
    if(Test-Path -LiteralPath (Join-Path $fixture 'finished')) {break}
    Start-Sleep -Milliseconds 100
  }
  if(-not (Test-Path -LiteralPath (Join-Path $fixture 'finished'))) {throw 'Worker did not complete work after its parent exited'}
  Write-Output 'PASS: same desktop session; parent exits; independent worker survives and completes work. No app or OS startup setting changed.'
} finally {
  'stop' | Set-Content -LiteralPath (Join-Path $fixture 'release')
}
