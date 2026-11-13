$ErrorActionPreference='Stop'
$project=Split-Path $PSScriptRoot;$root=Join-Path $project ('.state/companion-startup-'+[guid]::NewGuid().ToString('N'));$app=Join-Path $root 'app';$scripts=Join-Path $app 'scripts';$source=Join-Path $app 'src/companion'
New-Item -ItemType Directory -Path $scripts,$source -Force|Out-Null
Copy-Item -LiteralPath (Join-Path $project 'scripts/start-companion.ps1') -Destination (Join-Path $scripts 'start-companion.ps1')
@'
function Get-CompanionInstallRoot {Split-Path (Split-Path $PSScriptRoot)}
'@|Set-Content -LiteralPath (Join-Path $scripts 'companion-paths.ps1') -Encoding utf8
@'
function Start-ThemeIndependentProcess {
 param($PowerShellPath,$ScriptPath,$WorkingDirectory)
 [IO.File]::WriteAllText($env:CW_START_FIXTURE_MARKER,'ready')
 @{pid=123456}
}
'@|Set-Content -LiteralPath (Join-Path $scripts 'windows-independent.ps1') -Encoding utf8
@'
const fs=require('node:fs'),args=process.argv.slice(2);
fs.appendFileSync(process.env.CW_START_FIXTURE_CALLS,JSON.stringify(args)+'\n');
if(!fs.existsSync(process.env.CW_START_FIXTURE_MARKER))process.exit(2);
if(args[0]!=='wait-ready'||args.length>2||args.length===2&&args[1]!=='--settle-launch')process.exit(2);
console.log(JSON.stringify({ok:true,state:{mode:'integrated',phase:'checking',observed:{connected:false}}}));
'@|Set-Content -LiteralPath (Join-Path $source 'command.cjs') -Encoding utf8
$oldMarker=$env:CW_START_FIXTURE_MARKER;$oldCalls=$env:CW_START_FIXTURE_CALLS
$env:CW_START_FIXTURE_MARKER=Join-Path $root 'worker-ready';$env:CW_START_FIXTURE_CALLS=Join-Path $root 'calls.jsonl';$pwsh=(Get-Process -Id $PID).Path
try{
 foreach($settle in @($false,$true)){
  foreach($file in @($env:CW_START_FIXTURE_MARKER,$env:CW_START_FIXTURE_CALLS)){if(Test-Path -LiteralPath $file){Remove-Item -LiteralPath $file}}
  $parameters=@('-NoProfile','-File',(Join-Path $scripts 'start-companion.ps1'),'-Action','Start','-Integrated','-Quiet');if($settle){$parameters+='-SettleLaunch'}
  $reply=& $pwsh @parameters|ConvertFrom-Json
  if($LASTEXITCODE -ne 0 -or -not $reply.ok){throw 'Owned companion startup failed'}
  $calls=@(Get-Content -LiteralPath $env:CW_START_FIXTURE_CALLS|ForEach-Object {,@(ConvertFrom-Json $_ -NoEnumerate)})
  $raw=@(Get-Content -LiteralPath $env:CW_START_FIXTURE_CALLS)
  if($raw.Count -ne 2){throw 'Startup created duplicate command clients'}
  $expected=if($settle){'["wait-ready","--settle-launch"]'}else{'["wait-ready"]'}
  $initial=if($settle){'["launch","--settle"]'}else{'["status"]'}
  if($raw[0] -ne $initial -or $raw[1] -ne $expected){throw 'Startup arguments were split or settlement was lost'}
 }
 'PASS: ordinary and integrated-settle startup pass exact CLI arguments and create no extra verification client'
}finally{$env:CW_START_FIXTURE_MARKER=$oldMarker;$env:CW_START_FIXTURE_CALLS=$oldCalls}
