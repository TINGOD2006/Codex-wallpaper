$ErrorActionPreference='Stop'
$project=Split-Path $PSScriptRoot;$fixture=Join-Path $project ('.state/launch-fail-open-'+[guid]::NewGuid().ToString('N'));$app=Join-Path $fixture 'app';$scripts=Join-Path $app 'scripts';$source=Join-Path $app 'src/companion';$assets=Join-Path $fixture 'data/entry-assets'
New-Item -ItemType Directory -Path $scripts,$source,$assets -Force|Out-Null
Copy-Item -LiteralPath (Join-Path $project 'scripts/launch-wallpaper.ps1') -Destination (Join-Path $scripts 'launch-wallpaper.ps1')
@'
param([scriptblock]$OnColdStart,[scriptblock]$OnExistingWindow,[switch]$ExistingOnly,[switch]$UseHostHint)
if($ExistingOnly){Add-Content -LiteralPath $env:CW_FIXTURE_MARKER -Value 'native-activation';return}
if($env:CW_FIXTURE_NATIVE_FAIL -eq '1'){throw 'Owned native launch failure'}
if($OnColdStart){& $OnColdStart 'cold-start'}
Add-Content -LiteralPath $env:CW_FIXTURE_MARKER -Value 'native-invoked'
'@|Set-Content -LiteralPath (Join-Path $scripts 'ensure-codex-visible.ps1') -Encoding utf8
@'
function Start-WallpaperBootAnimation {param($ProjectRoot,[ref]$Reason)return $null}
function Set-WallpaperBootFailure {param($Context)}
'@|Set-Content -LiteralPath (Join-Path $scripts 'boot-animation.ps1') -Encoding utf8
Copy-Item -LiteralPath (Join-Path $project 'scripts/start-companion.ps1') -Destination (Join-Path $scripts 'start-companion.ps1')
@'
const fs=require('node:fs'),args=process.argv.slice(2).join(' ');
fs.appendFileSync(process.env.CW_FIXTURE_MARKER,args+'\n');
if(args==='launch --settle'&&process.env.CW_FIXTURE_MODE==='SERVICE_OFFLINE')process.exit(2);
if(!['launch --settle','wait-ready --settle-launch'].includes(args))process.exit(3);
console.log(fs.readFileSync(process.env.CW_FIXTURE_STATE,'utf8'));
'@|Set-Content -LiteralPath (Join-Path $source 'command.cjs') -Encoding utf8
@'
function Get-CompanionInstallRoot {Split-Path (Split-Path $PSScriptRoot)}
'@|Set-Content -LiteralPath (Join-Path $scripts 'companion-paths.ps1') -Encoding utf8
@'
function Start-ThemeIndependentProcess {
 param($PowerShellPath,$ScriptPath,$WorkingDirectory)
 if([IO.Path]::GetFileName($ScriptPath) -ne 'companion-integrated-worker.ps1'){throw 'Expected integrated worker'}
 Add-Content -LiteralPath $env:CW_FIXTURE_MARKER -Value 'worker-start';@{pid=123456}
}
'@|Set-Content -LiteralPath (Join-Path $scripts 'windows-independent.ps1') -Encoding utf8
foreach($name in @('install-wallpaper-entry.ps1','install-codex-taskbar-entry.ps1','install-codex-user-shortcuts.ps1')){[IO.File]::WriteAllText((Join-Path $scripts $name),'# Owned no-op fixture')}
@{appVersion='fixture'}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $assets 'entry-refreshed') -Encoding utf8
(Get-Item -LiteralPath (Join-Path $assets 'entry-refreshed')).LastWriteTimeUtc=[DateTime]::UtcNow.AddMinutes(1)
$previousState=$env:CW_FIXTURE_STATE;$previousMarker=$env:CW_FIXTURE_MARKER;$previousFail=$env:CW_FIXTURE_NATIVE_FAIL;$previousMode=$env:CW_FIXTURE_MODE
$env:CW_FIXTURE_STATE=Join-Path $fixture 'reply.json';$env:CW_FIXTURE_MARKER=Join-Path $fixture 'native.txt';$pwsh=(Get-Process -Id $PID).Path
$results=@()
try{
 foreach($code in @('HOST_ENDPOINT_PENDING','HOST_UNRESPONSIVE','HOST_TRANSPORT_UNAVAILABLE','HOST_NEEDS_MANAGED_LAUNCH','NODE_MISSING','SERVICE_OFFLINE','NATIVE_FAIL')){
  if(Test-Path -LiteralPath $env:CW_FIXTURE_MARKER){Remove-Item -LiteralPath $env:CW_FIXTURE_MARKER}
  $env:CW_FIXTURE_NATIVE_FAIL=if($code -eq 'NATIVE_FAIL'){'1'}else{'0'}
  $env:CW_FIXTURE_MODE=$code
  @{ok=$true;state=@{mode='integrated';phase='checking';desired=@{enabled=$true;wallpaperEnabled=$true};observed=@{connected=$false;applied=$false;appVersion='fixture'};error=@{code=$code;message='Owned wallpaper failure'}}}|ConvertTo-Json -Depth 6|Set-Content -LiteralPath $env:CW_FIXTURE_STATE -Encoding utf8
  $wrapper=Join-Path $fixture ($code+'.ps1');$launcher=(Join-Path $scripts 'launch-wallpaper.ps1').Replace("'","''")
  $prefix=if($code -eq 'NODE_MISSING'){'function Get-Command {param($Name,$ErrorAction)if($Name -eq ''node''){throw ''Owned missing Node''}}' + "`n"}else{''}
  $quiet=if($code -eq 'NATIVE_FAIL'){' -Quiet'}else{''}
  [IO.File]::WriteAllText($wrapper,$prefix+"& '$launcher'$quiet")
  $child=Start-Process -FilePath $pwsh -ArgumentList @('-NoProfile','-File',('"'+$wrapper+'"')) -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $fixture ($code+'.stdout')) -RedirectStandardError (Join-Path $fixture ($code+'.stderr'))
  if(-not $child.WaitForExit(15000)){$child.Kill();throw ('Owned launcher hung or showed a modal dialog: '+$code)}
  if($code -eq 'NATIVE_FAIL'){if($child.ExitCode -eq 0){throw 'Actual native startup failure was hidden'};continue}
  if($child.ExitCode -ne 0){throw ('Wallpaper failure blocked native launch: '+$code+' '+(Get-Content -LiteralPath (Join-Path $fixture ($code+'.stderr')) -Raw))}
  $calls=@(Get-Content -LiteralPath $env:CW_FIXTURE_MARKER);if($calls -notcontains 'native-invoked' -or $calls -notcontains 'native-activation'){throw ('Original native activation was skipped: '+$code)}
  $record=Get-Content -LiteralPath (Join-Path $fixture 'logs/last-launch.json') -Raw|ConvertFrom-Json;if(-not $record.nativeInvoked){throw 'Native launch evidence missing'}
  if($code -eq 'SERVICE_OFFLINE' -and (($calls -join ',') -ne 'native-invoked,launch --settle,worker-start,wait-ready --settle-launch,native-activation' -or $record.code -eq 'WALLPAPER_BOOTSTRAP_FAILED')){throw 'Cold service startup repeated verification or lost its launch reply'}
  if($code -in @('HOST_ENDPOINT_PENDING','HOST_UNRESPONSIVE') -and $record.result -ne 'pending'){throw 'Transient host state was not reported as pending'}
  $results+=@{case=$code;nativeLaunchContinues=$true;noModal=$true;exitCode=$child.ExitCode}
 }
 @{pass=$true;nativeErrorsRemainErrors=$true;cases=$results}|ConvertTo-Json -Depth 4
}finally{$env:CW_FIXTURE_STATE=$previousState;$env:CW_FIXTURE_MARKER=$previousMarker;$env:CW_FIXTURE_NATIVE_FAIL=$previousFail;$env:CW_FIXTURE_MODE=$previousMode}
