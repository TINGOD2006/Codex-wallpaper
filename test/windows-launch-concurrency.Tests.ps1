$ErrorActionPreference='Stop'
$project=Split-Path $PSScriptRoot;$root=Join-Path $project ('.state/entry-concurrency-'+[guid]::NewGuid().ToString('N'));$app=Join-Path $root 'app';$scripts=Join-Path $app 'scripts';$source=Join-Path $app 'src/companion';$assets=Join-Path $root 'data/entry-assets'
New-Item -ItemType Directory -Path $scripts,$source,$assets -Force|Out-Null
Copy-Item -LiteralPath (Join-Path $project 'scripts/launch-wallpaper.ps1') -Destination (Join-Path $scripts 'launch-wallpaper.ps1')
Copy-Item -LiteralPath (Join-Path $project 'scripts/start-companion.ps1') -Destination (Join-Path $scripts 'start-companion.ps1')
@'
function Get-CompanionInstallRoot {Split-Path (Split-Path $PSScriptRoot)}
'@|Set-Content -LiteralPath (Join-Path $scripts 'companion-paths.ps1') -Encoding utf8
@'
param([scriptblock]$OnColdStart,[scriptblock]$OnExistingWindow,[switch]$ExistingOnly,[switch]$UseHostHint)
if($ExistingOnly){Add-Content -LiteralPath $env:CW_CONCURRENT_ACTIVATIONS -Value 'activate';return}
if($OnColdStart){& $OnColdStart 'cold-start'}
[IO.File]::WriteAllText($env:CW_CONCURRENT_NATIVE,'one native launch')
'@|Set-Content -LiteralPath (Join-Path $scripts 'ensure-codex-visible.ps1') -Encoding utf8
@'
function Start-WallpaperBootAnimation {param($ProjectRoot,[ref]$Reason)Add-Content -LiteralPath $env:CW_CONCURRENT_ANIMATIONS -Value 'one animation';return $null}
function Set-WallpaperBootFailure {param($Context)}
'@|Set-Content -LiteralPath (Join-Path $scripts 'boot-animation.ps1') -Encoding utf8
@'
const fs=require('node:fs');fs.appendFileSync(process.env.CW_CONCURRENT_CLIENTS,'one client\n');fs.writeFileSync(process.env.CW_CONCURRENT_READY,'ready');
const timer=setInterval(()=>{if(fs.existsSync(process.env.CW_CONCURRENT_RELEASE)){clearInterval(timer);console.log(JSON.stringify({ok:true,state:{mode:'integrated',phase:'active',desired:{enabled:true,wallpaperEnabled:true},observed:{applied:true,connected:true,appVersion:'fixture'}}}))}},100);setTimeout(()=>{clearInterval(timer);process.exit(3)},45000).unref();
'@|Set-Content -LiteralPath (Join-Path $source 'command.cjs') -Encoding utf8
foreach($name in @('install-wallpaper-entry.ps1','install-codex-taskbar-entry.ps1','install-codex-user-shortcuts.ps1')){[IO.File]::WriteAllText((Join-Path $scripts $name),'# Owned fixture')}
@{appVersion='fixture'}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $assets 'entry-refreshed') -Encoding utf8
(Get-Item -LiteralPath (Join-Path $assets 'entry-refreshed')).LastWriteTimeUtc=[DateTime]::UtcNow.AddMinutes(1)
$names=@('CW_CONCURRENT_ACTIVATIONS','CW_CONCURRENT_NATIVE','CW_CONCURRENT_ANIMATIONS','CW_CONCURRENT_CLIENTS','CW_CONCURRENT_READY','CW_CONCURRENT_RELEASE');$old=@{}
foreach($name in $names){$old[$name]=[Environment]::GetEnvironmentVariable($name);[Environment]::SetEnvironmentVariable($name,(Join-Path $root $name))}
$pwsh=(Get-Process -Id $PID).Path;$first=$null;$second=$null
try{
 $arguments=@('-NoProfile','-File',('"'+(Join-Path $scripts 'launch-wallpaper.ps1')+'"'),'-Quiet')
 $first=Start-Process -FilePath $pwsh -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $root 'first.stdout') -RedirectStandardError (Join-Path $root 'first.stderr')
 $null=$first.Handle
 for($n=0;$n -lt 80 -and -not(Test-Path -LiteralPath $env:CW_CONCURRENT_READY);$n++){Start-Sleep -Milliseconds 100}
 if(-not(Test-Path -LiteralPath $env:CW_CONCURRENT_READY)){throw 'First fixture never reached background initialization'}
 $timer=[Diagnostics.Stopwatch]::StartNew()
 $second=Start-Process -FilePath $pwsh -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $root 'second.stdout') -RedirectStandardError (Join-Path $root 'second.stderr')
 $null=$second.Handle;$done=$second.WaitForExit(10000);$second.Refresh()
 if(-not $done -or $second.ExitCode -ne 0 -or $first.HasExited){throw 'Repeated click blocked on the ongoing wallpaper launch'}
 $duplicateMs=$timer.ElapsedMilliseconds
 if(-not(Test-Path -LiteralPath $env:CW_CONCURRENT_ACTIVATIONS)){throw 'Repeated click was ignored instead of activating the existing window'}
 $reply=Get-Content -LiteralPath (Join-Path $root 'second.stdout') -Raw|ConvertFrom-Json;if(-not $reply.alreadyStarting){throw 'Repeated click created another bootstrap'}
 [IO.File]::WriteAllText($env:CW_CONCURRENT_RELEASE,'release');$done=$first.WaitForExit(10000);$first.Refresh()
 if(-not $done -or $first.ExitCode -ne 0){throw 'Primary fixture failed'}
 if(@(Get-Content -LiteralPath $env:CW_CONCURRENT_CLIENTS).Count -ne 1 -or @(Get-Content -LiteralPath $env:CW_CONCURRENT_ANIMATIONS).Count -ne 1){throw 'Repeated click duplicated animation or wallpaper work'}
 @{pass=$true;duplicateClickMs=$duplicateMs;existingWindowActivated=$true;nativeLaunches=1;animations=1;wallpaperClients=1}|ConvertTo-Json
}finally{foreach($process in @($first,$second)){if($process -and -not $process.HasExited){$process.Kill()}};foreach($name in $names){[Environment]::SetEnvironmentVariable($name,$old[$name])}}
