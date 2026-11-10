$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/boot-animation.ps1')
$project=Split-Path $PSScriptRoot;$fixtureRoot=Join-Path $project '.state/boot-debounce';$app=Join-Path $fixtureRoot 'app';$assets=Join-Path $app 'assets/boot-animation';$writerDir=Join-Path $app 'src/companion';New-Item -ItemType Directory -Path $assets,$writerDir -Force|Out-Null
$compiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe';$fixtureSource=Join-Path $fixtureRoot 'passive-player.cs'
[IO.File]::WriteAllText($fixtureSource,'class PassivePlayer {static void Main(){System.Threading.Thread.Sleep(1500);}}')
& $compiler /nologo /target:winexe ('/out:'+(Join-Path $assets 'DragonBoot.exe')) $fixtureSource
if($LASTEXITCODE -ne 0){throw 'Fixture compilation failed'}
[IO.File]::WriteAllText((Join-Path $assets 'startup.mp4'),'fixture placeholder - not executed');[IO.File]::WriteAllText((Join-Path $writerDir 'boot-status.cjs'),'process.exit(0)')
$previous=$env:CODEX_WALLPAPER_ROOT;$env:CODEX_WALLPAPER_ROOT=$fixtureRoot
try{
 $last=Join-Path $fixtureRoot 'runtime/boot-animation/last-request.json';if(Test-Path -LiteralPath $last){@{ticks=[DateTime]::UtcNow.AddSeconds(-10).Ticks}|ConvertTo-Json|Set-Content -LiteralPath $last -Encoding utf8}
 $first=Start-WallpaperBootAnimation -ProjectRoot $app;if(-not $first.playerPid){throw 'First request was skipped'}
 $reason=$null;$second=Start-WallpaperBootAnimation -ProjectRoot $app -Reason ([ref]$reason);if($second -or $reason -ne 'already-requested'){throw 'Live player request was not deduplicated'}
 $active=Get-Process -Id $first.playerPid -ErrorAction SilentlyContinue;if($active){[void]$active.WaitForExit(5000)}
 $result=Join-Path $fixtureRoot ('runtime/boot-animation/'+$first.launchId+'.json.result.json');[IO.File]::WriteAllText($result,'{}')
 $reason=$null;$third=Start-WallpaperBootAnimation -ProjectRoot $app -Reason ([ref]$reason);if(-not $third.playerPid -or $reason -ne 'started'){throw 'A completed player suppressed a genuine new cold start'}
 $active=Get-Process -Id $third.playerPid -ErrorAction SilentlyContinue;if($active){[void]$active.WaitForExit(5000)}
 'PASS: live duplicate suppressed; a new cold start is allowed immediately after completion'
}finally{$env:CODEX_WALLPAPER_ROOT=$previous}
