$ErrorActionPreference='Stop'
$project=Split-Path $PSScriptRoot;$root=Join-Path $project '.state/boot-cold-integration';$app=Join-Path $root 'app';$assets=Join-Path $app 'assets/boot-animation';$writer=Join-Path $app 'src/companion';New-Item -ItemType Directory -Path $assets,$writer -Force|Out-Null
$compiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe';$exe=Join-Path $app 'ChatGPT.exe'
& $compiler /nologo /target:winexe /reference:System.dll /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll ('/out:'+$exe) (Join-Path $project 'test/fixtures/boot-window.cs')
if($LASTEXITCODE -ne 0){throw 'Fixture compile failed'}
foreach($name in @('DragonBoot.exe','startup.mp4')){Copy-Item -LiteralPath (Join-Path $project ('assets/boot-animation/'+$name)) -Destination (Join-Path $assets $name) -Force}
$config=Get-Content -LiteralPath (Join-Path $project 'assets/boot-animation/launcher.json') -Raw|ConvertFrom-Json;$config.ProcessNames=@('ChatGPT');$config.ProcessPathContains='.state';$config.Volume=0;$config|ConvertTo-Json -Depth 6|Set-Content -LiteralPath (Join-Path $assets 'launcher.json') -Encoding utf8
# Readiness comes from the owned host fixture; the real feeder has separate tests.
[IO.File]::WriteAllText((Join-Path $writer 'boot-status.cjs'),'process.exit(0)')
function Get-AppxPackage {param([string]$Name)if($Name -eq 'OpenAI.Codex'){[pscustomobject]@{InstallLocation=$root;Version=[version]'99.1.2.3';PackageFamilyName='ColdAnimationFixture_test'}}}
function Invoke-CodexNativeActivation {param($Package)if($Package.packageFamily -ne 'ColdAnimationFixture_test'){throw 'Unexpected activation target'}}
$context=[pscustomobject]@{animation=$null;hostProcess=$null;callbacks=0}
function Start-Process {
 param([string]$FilePath,[string[]]$ArgumentList,[string]$WorkingDirectory,[string]$WindowStyle,[switch]$PassThru)
 $options=@{FilePath=$FilePath;ArgumentList=$ArgumentList;PassThru=$true};if($WorkingDirectory){$options.WorkingDirectory=$WorkingDirectory};if($WindowStyle){$options.WindowStyle=$WindowStyle}
 if($FilePath -eq $exe){$options.ArgumentList=@(('"'+$context.animation.statePath+'"'),$context.animation.launchId,'0')}
 $child=Microsoft.PowerShell.Management\Start-Process @options
 if($FilePath -eq $exe){$context.hostProcess=$child}
 return $child
}
$previous=$env:CODEX_WALLPAPER_ROOT;$env:CODEX_WALLPAPER_ROOT=$root
. (Join-Path $project 'scripts/boot-animation.ps1')
try{
 & (Join-Path $project 'scripts/ensure-codex-visible.ps1') -OnColdStart {$context.callbacks++;$context.animation=Start-WallpaperBootAnimation -ProjectRoot $app}
 if(-not $context.animation.playerPid -or -not $context.hostProcess){throw 'Cold entry failed to start player and owned host'}
 $player=Get-Process -Id $context.animation.playerPid
 if(-not $player.WaitForExit(35000)){throw 'Cold entry player hung'}
 $result=Get-Content -LiteralPath ($context.animation.statePath+'.result.json') -Raw|ConvertFrom-Json
 if(-not $result.mediaOpened -or -not $result.ready -or $result.elapsedMs -lt 10000){throw 'Cold entry did not play and hand off the animation'}
 & (Join-Path $project 'scripts/ensure-codex-visible.ps1') -OnColdStart {$context.callbacks++}
 if($context.callbacks -ne 1 -or $context.hostProcess.HasExited){throw 'Hot entry replayed or replaced the host'}
 @{pass=$true;coldEntryStartedPlayer=$true;mediaOpened=$result.mediaOpened;ready=$result.ready;elapsedMs=$result.elapsedMs;hotEntrySkipped=$true}|ConvertTo-Json
}finally{if($context.hostProcess -and -not $context.hostProcess.HasExited){[void]$context.hostProcess.CloseMainWindow();[void]$context.hostProcess.WaitForExit(5000)};$env:CODEX_WALLPAPER_ROOT=$previous}
