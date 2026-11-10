$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/renderer-process.ps1')
$created=[datetime]'2026-11-01T00:00:00Z'
$identity=@{pid=1234;startTime=$created.ToUniversalTime().Ticks.ToString();executable='C:\Edge\msedge.exe';profile='C:\Wallpaper\profile';port=4567}
$process=[pscustomobject]@{ProcessId=1234;CreationDate=$created;ExecutablePath=$identity.executable;CommandLine='"C:\Edge\msedge.exe" --headless=new --remote-debugging-address=127.0.0.1 --remote-debugging-port=0 "--user-data-dir=C:\Wallpaper\profile" about:blank'}
$listener=[pscustomobject]@{LocalAddress='127.0.0.1';LocalPort=4567;OwningProcess=1234;RemoteAddress='0.0.0.0';RemotePort=0}
if(-not (Test-RendererIdentity $identity $process @($listener) -RequirePort)){throw 'Valid owner rejected'}
foreach($command in @(($process.CommandLine.Replace('profile"','profile-other"')),($process.CommandLine+' "--user-data-dir=C:\Wallpaper\profile-other"'),($process.CommandLine+' --type=renderer'),($process.CommandLine.Replace('127.0.0.1','0.0.0.0')))){$wrong=$process.PSObject.Copy();$wrong.CommandLine=$command;if(Test-RendererIdentity $identity $wrong @($listener) -RequirePort){throw 'Foreign command accepted'}}
$wrong=$process.PSObject.Copy();$wrong.CreationDate=$created.AddSeconds(1);if(Test-RendererIdentity $identity $wrong @($listener) -RequirePort){throw 'Reused PID accepted'}
$wrongListener=$listener.PSObject.Copy();$wrongListener.OwningProcess=999;if(Test-RendererIdentity $identity $process @($wrongListener) -RequirePort){throw 'Foreign endpoint accepted'}
'PASS: exact renderer process/profile/endpoint ownership'
