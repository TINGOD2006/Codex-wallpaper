$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\scripts\windows-session.ps1')
$created = [datetime]'2026-10-27T05:00:00Z'
$identity = @{pid=1234;startTime=$created.ToUniversalTime().Ticks.ToString();appPath='C:\Official\ChatGPT.exe';mode='Isolated';profilePath='C:\Theme\.state\isolated\profile';port=4567}
$fakeProcess = [pscustomobject]@{ProcessId=1234;CreationDate=$created;ExecutablePath='C:\Official\ChatGPT.exe';CommandLine='"C:\Official\ChatGPT.exe" --remote-debugging-port=0 "--user-data-dir=C:\Theme\.state\isolated\profile"'}
$listener = [pscustomobject]@{LocalAddress='127.0.0.1';LocalPort=4567;OwningProcess=1234;RemoteAddress='0.0.0.0';RemotePort=0}
if (-not (Test-ThemeIdentity $identity $fakeProcess @($listener) -RequirePort)) { throw 'Valid identity rejected' }
$cases = @(
  @{field='ProcessId';value=9999},
  @{field='ExecutablePath';value='C:\Other\ChatGPT.exe'},
  @{field='CreationDate';value=$created.AddMinutes(1)},
  @{field='CommandLine';value='"C:\Official\ChatGPT.exe"'}
)
foreach ($case in $cases) {
  $wrong = $fakeProcess.PSObject.Copy()
  $wrong.($case.field) = $case.value
  if (Test-ThemeIdentity $identity $wrong @($listener) -RequirePort) { throw "Accepted wrong $($case.field)" }
}
foreach ($wrongListener in @(
  [pscustomobject]@{LocalAddress='0.0.0.0';LocalPort=4567;OwningProcess=1234},
  [pscustomobject]@{LocalAddress='127.0.0.1';LocalPort=4567;OwningProcess=9999},
  [pscustomobject]@{LocalAddress='127.0.0.1';LocalPort=9999;OwningProcess=1234}
)) {
  if (Test-ThemeIdentity $identity $fakeProcess @($wrongListener) -RequirePort) { throw 'Accepted incorrect listener' }
}
Write-Output 'PASS: valid identity plus 7 incorrect identity/listener cases'
