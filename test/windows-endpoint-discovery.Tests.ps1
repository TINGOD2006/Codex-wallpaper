$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/windows-session.ps1')
$script:socketRows=@(
 [pscustomobject]@{LocalAddress='127.0.0.1';LocalPort=4567;RemoteAddress='0.0.0.0';RemotePort=0;OwningProcess=1234;State=$null},
 [pscustomobject]@{LocalAddress='127.0.0.1';LocalPort=49999;RemoteAddress='127.0.0.1';RemotePort=443;OwningProcess=1234;State='Established'},
 [pscustomobject]@{LocalAddress='127.0.0.1';LocalPort=5555;RemoteAddress='0.0.0.0';RemotePort=0;OwningProcess=9999;State='Listen'}
)
function Get-ThemeNativeListeners {return $script:socketRows}
function Get-NetTCPConnection {
 param($State,$LocalPort,$OwningProcess,$RemotePort,$ErrorAction)
 $rows=$script:socketRows
 if($PSBoundParameters.ContainsKey('State')){$rows=@($rows|Where-Object State -eq $State)}
 if($PSBoundParameters.ContainsKey('LocalPort')){$rows=@($rows|Where-Object LocalPort -eq $LocalPort)}
 if($PSBoundParameters.ContainsKey('OwningProcess')){$rows=@($rows|Where-Object OwningProcess -eq $OwningProcess)}
 if($PSBoundParameters.ContainsKey('RemotePort')){$rows=@($rows|Where-Object RemotePort -eq $RemotePort)}
 return $rows
}
$found=@(Get-ThemeBoundEndpoints -OwningProcess 1234)
if($found.Count -ne 1 -or $found[0].LocalPort -ne 4567){throw 'Unclassified valid bound endpoint lost or active connection accepted'}
$created=[datetime]'2026-10-30T01:00:00Z';$identity=@{pid=1234;startTime=$created.ToUniversalTime().Ticks.ToString();appPath='C:\Official\ChatGPT.exe';mode='Existing';port=4567}
$process=[pscustomobject]@{ProcessId=1234;CreationDate=$created;ExecutablePath=$identity.appPath;CommandLine='ChatGPT.exe --remote-debugging-port=0'}
if(-not(Test-ThemeIdentity $identity $process $found -RequirePort)){throw 'Validated endpoint with unknown State rejected'}
$script:socketRows+=([pscustomobject]@{LocalAddress='127.0.0.1';LocalPort=4567;RemoteAddress='0.0.0.0';RemotePort=0;OwningProcess=9999;State='Listen'})
if(Test-ThemeIdentity $identity $process @(Get-ThemeBoundEndpoints -LocalPort 4567) -RequirePort){throw 'Ambiguous endpoint ownership accepted'}
function Get-ThemeNativeListeners {throw 'Owned native-provider failure'}
$fallback=@(Get-ThemeBoundEndpoints -OwningProcess 1234)
if($fallback.Count -ne 1 -or $fallback[0].LocalPort -ne 4567){throw 'Native failure lost the checked provider fallback'}
Write-Output 'PASS: unknown socket State retained, active/foreign sockets excluded, ambiguous port ownership rejected'
